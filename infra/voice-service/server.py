"""Internal-only voice-clone service for CatGPT (Phase 4).

Wraps the pinned Chatterbox Telugu adapter behind a tiny private HTTP API so
the Node API never touches model files directly. Binds localhost by default;
optionally requires a shared-secret header. CPU-only, model kept warm.

Endpoints:
    GET  /health      -> status, loaded flag, language list (adapter-reported)
    POST /probe       -> multipart wav -> { duration_s, sample_rate } (enrollment check)
    POST /synthesize  -> multipart wav + text + language -> audio/wav bytes

Never exposed to browsers: the Node API is the only client and enforces its
own auth/consent/ownership rules.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import sys
import threading
import tempfile
import time
from collections import OrderedDict
from pathlib import Path

os.environ.setdefault("CUDA_VISIBLE_DEVICES", "")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

SERVICE_DIR = Path(__file__).resolve().parent
BAKEOFF_DIR = SERVICE_DIR.parent / "voice-bakeoff"
sys.path.insert(0, str(BAKEOFF_DIR))

import soundfile as sf  # noqa: E402
import torch  # noqa: E402
import uvicorn  # noqa: E402
from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile  # noqa: E402
from fastapi.responses import Response  # noqa: E402

from run_benchmark import PINS, load_hf_snapshot  # noqa: E402
import chatterbox.mtl_tts as mtl_tts  # noqa: E402

MODEL_REPO = os.environ.get("CHATTERBOX_REPO", "shankarpandala/chatterbox-telugu")
MODEL_REV = os.environ.get("CHATTERBOX_REVISION", PINS["chatterbox_telugu"]["weights"])
T3_MODEL = os.environ.get("CHATTERBOX_T3_MODEL", "t3_mtl_te.safetensors")
SERVICE_TOKEN = os.environ.get("VOICE_SERVICE_TOKEN") or None
TORCH_THREADS = int(os.environ.get("VOICE_SERVICE_THREADS", "8"))
MAX_TEXT_CHARS = 1500
COND_CACHE_MAX = 4
MIN_SECONDS = 3.0
MAX_SECONDS = 120.0

ALLOW_PATTERNS = [
    "config.json",
    "ve.pt",
    "t3_mtl_te.safetensors",
    "s3gen.pt",
    "grapheme_mtl_merged_expanded_v1.json",
    "conds.pt",
    "Cangjie5_TC.json",
]

app = FastAPI(title="catgpt-voice", docs_url=None, redoc_url=None)
_state: dict = {"model": None, "loading": False, "error": None}
_load_lock = threading.Lock()
_infer_lock = threading.Lock()  # CPU-bound: serialize synthesis
_conds_cache: OrderedDict[str, object] = OrderedDict()


def _auth(request: Request) -> None:
    if SERVICE_TOKEN and request.headers.get("x-voice-key") != SERVICE_TOKEN:
        raise HTTPException(401, "unauthorized")


def _ensure_loaded() -> None:
    if _state["model"] is not None or _state["loading"]:
        return
    with _load_lock:
        if _state["model"] is not None or _state["loading"]:
            return
        _state["loading"] = True
        _state["error"] = None  # clear any stale failure before retrying
        try:
            torch.set_num_threads(TORCH_THREADS)
            ckpt = load_hf_snapshot(
                MODEL_REPO, MODEL_REV, ALLOW_PATTERNS, local_only=False
            )
            config = json.loads((ckpt / "config.json").read_text(encoding="utf-8"))
            mtl_tts.SUPPORTED_LANGUAGES[config["language"]] = config["language_name"]
            vocab = int(config["vocab_size"])
            mtl_tts.T3Config.multilingual = classmethod(
                lambda cls: cls(text_tokens_dict_size=vocab)
            )
            _state["model"] = mtl_tts.ChatterboxMultilingualTTS.from_local(
                ckpt, device="cpu", t3_model=T3_MODEL
            )
        except Exception as exc:  # noqa: BLE001
            _state["error"] = type(exc).__name__
        finally:
            _state["loading"] = False


def _decode_wav(raw: bytes) -> tuple:
    try:
        data, sr = sf.read(io.BytesIO(raw), dtype="float32", always_2d=True)
    except Exception:  # noqa: BLE001
        raise HTTPException(415, "unsupported or corrupt audio")
    seconds = data.shape[0] / float(sr)
    if seconds < MIN_SECONDS or seconds > MAX_SECONDS:
        raise HTTPException(
            400, f"reference must be {MIN_SECONDS:.0f}–{MAX_SECONDS:.0f}s of speech"
        )
    return data, sr


@app.get("/health")
def health() -> dict:
    model = _state["model"]
    return {
        "status": "ok" if model is not None else ("loading" if _state["loading"] else "idle"),
        "model_loaded": model is not None,
        "load_error": _state["error"],
        "sample_rate": getattr(model, "sr", 24000),
        "languages": sorted(mtl_tts.SUPPORTED_LANGUAGES.keys()),
    }


@app.post("/probe")
async def probe(file: UploadFile = File(...), _: None = Depends(_auth)) -> dict:
    raw = await file.read()
    data, sr = _decode_wav(raw)
    return {
        "duration_s": round(data.shape[0] / float(sr), 2),
        "sample_rate": int(sr),
        "channels": int(data.shape[1]),
    }


@app.post("/synthesize")
async def synthesize(
    request: Request,
    file: UploadFile = File(...),
    text: str = Form(...),
    language: str = Form(...),
    _: None = Depends(_auth),
) -> Response:
    text = text.strip()
    if not text or len(text) > MAX_TEXT_CHARS:
        raise HTTPException(400, "invalid text")
    language = language.lower()
    raw = await file.read()
    _decode_wav(raw)

    if not _infer_lock.acquire(blocking=False):
        raise HTTPException(429, "voice service busy")
    try:
        # Load first — the adapter registers "te" into SUPPORTED_LANGUAGES
        # only when its config is read during model load.
        _ensure_loaded()
        model = _state["model"]
        if model is None:
            if _state["error"]:
                raise HTTPException(503, "model failed to load")
            raise HTTPException(503, "model not ready")
        if language not in mtl_tts.SUPPORTED_LANGUAGES:
            raise HTTPException(400, "unsupported language")

        # prepare_conditionals needs a real path; keep it inside a temp dir.
        with tempfile.TemporaryDirectory(prefix="voice-svc-") as tmp:
            ref_path = Path(tmp) / "reference.wav"
            ref_path.write_bytes(raw)

            key = hashlib.sha256(raw).hexdigest()
            started = time.perf_counter()
            cached = _conds_cache.get(key)
            if cached is None:
                model.prepare_conditionals(str(ref_path))
                _conds_cache[key] = model.conds
                while len(_conds_cache) > COND_CACHE_MAX:
                    _conds_cache.popitem(last=False)
            else:
                model.conds = cached
                _conds_cache.move_to_end(key)

            # Upstream quirk: T3 sampling can emit speech tokens outside the
            # flow decoder's range ("out-of-range special tokens" → IndexError).
            # It's stochastic (temperature sampling), so a bounded retry is the
            # correct mitigation — do NOT clamp tokens (that corrupts audio).
            wav = None
            last_exc: Exception | None = None
            for _attempt in range(3):
                try:
                    wav = model.generate(text, language_id=language)
                    break
                except IndexError as exc:
                    last_exc = exc
                    continue
            if wav is None:
                raise HTTPException(502, "synthesis sampling failed; retry") from last_exc
        elapsed = time.perf_counter() - started

        wav_t = wav if isinstance(wav, torch.Tensor) else torch.from_numpy(wav)
        buf = io.BytesIO()
        sf.write(
            buf,
            wav_t.reshape(-1).cpu().numpy(),
            model.sr,
            format="WAV",
            subtype="PCM_16",
        )
        return Response(
            content=buf.getvalue(),
            media_type="audio/wav",
            headers={"X-Synthesis-Seconds": f"{elapsed:.2f}"},
        )
    finally:
        _infer_lock.release()


if __name__ == "__main__":
    host = os.environ.get("VOICE_SERVICE_HOST", "127.0.0.1")
    port = int(os.environ.get("VOICE_SERVICE_PORT", "8765"))
    uvicorn.run(app, host=host, port=port, log_level="warning")
