from __future__ import annotations

import argparse
import gc
import json
import os
from pathlib import Path

os.environ["CUDA_VISIBLE_DEVICES"] = ""
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

from run_benchmark import (
    LANGUAGES,
    PINS,
    RssSampler,
    current_rss_mb,
    load_hf_snapshot,
)


def measure(fn):
    with RssSampler() as rss:
        import time

        started = time.perf_counter()
        result = fn()
        elapsed = time.perf_counter() - started
    return result, elapsed, rss.peak / (1024 * 1024)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("candidate", choices=("chatterbox", "chatterbox_telugu"))
    parser.add_argument("--languages", nargs="+", default=None)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--threads", type=int, default=8)
    args = parser.parse_args()

    import torch
    import torchaudio
    import chatterbox.mtl_tts as mtl_tts

    if torch.cuda.is_available():
        raise RuntimeError("CPU-only PyTorch is required")
    torch.set_num_threads(args.threads)
    args.output_dir.mkdir(parents=True, exist_ok=True)

    if args.candidate == "chatterbox_telugu":
        repo_id = "shankarpandala/chatterbox-telugu"
        t3_model = "t3_mtl_te.safetensors"
        patterns = [
            "config.json",
            "ve.pt",
            "t3_mtl_te.safetensors",
            "s3gen.pt",
            "grapheme_mtl_merged_expanded_v1.json",
            "conds.pt",
            "Cangjie5_TC.json",
        ]
        default_languages = ["te", "hi", "en"]
    else:
        repo_id = "ResembleAI/chatterbox"
        t3_model = "v3"
        patterns = [
            "ve.pt",
            "t3_mtl23ls_v3.safetensors",
            "s3gen.pt",
            "grapheme_mtl_merged_expanded_v1.json",
            "conds.pt",
            "Cangjie5_TC.json",
        ]
        default_languages = ["hi", "en", "fr"]

    checkpoint_dir = load_hf_snapshot(
        repo_id, PINS[args.candidate]["weights"], patterns, local_only=True
    )
    if args.candidate == "chatterbox_telugu":
        config = json.loads((checkpoint_dir / "config.json").read_text(encoding="utf-8"))
        mtl_tts.SUPPORTED_LANGUAGES[config["language"]] = config["language_name"]
        vocab = int(config["vocab_size"])
        mtl_tts.T3Config.multilingual = classmethod(
            lambda cls: cls(text_tokens_dict_size=vocab)
        )

    model, load_s, load_peak = measure(
        lambda: mtl_tts.ChatterboxMultilingualTTS.from_local(
            checkpoint_dir, device="cpu", t3_model=t3_model
        )
    )
    idle_mb = current_rss_mb()

    results = []
    for lang in args.languages or default_languages:
        text, _ = LANGUAGES[lang]
        wav, synth_s, synth_peak = measure(
            lambda: model.generate(text, language_id=lang)
        )
        wav_t = wav if isinstance(wav, torch.Tensor) else torch.from_numpy(wav)
        wav_t = wav_t.reshape(1, -1)
        out = args.output_dir / f"probe-{args.candidate}-{lang}.wav"
        torchaudio.save(str(out), wav_t, model.sr)
        results.append(
            {
                "language": lang,
                "synthesis_s": round(synth_s, 2),
                "peak_rss_mb": round(synth_peak, 1),
                "audio_s": round(wav_t.shape[-1] / model.sr, 2),
                "rtf": round(synth_s / max(wav_t.shape[-1] / model.sr, 0.01), 2),
                "file": out.name,
            }
        )
        del wav
        gc.collect()

    print(
        json.dumps(
            {
                "candidate": args.candidate,
                "weights_revision": PINS[args.candidate]["weights"],
                "torch": torch.__version__,
                "cuda": torch.cuda.is_available(),
                "load_s": round(load_s, 2),
                "load_peak_mb": round(load_peak, 1),
                "idle_after_load_mb": round(idle_mb, 1),
                "sample_rate": model.sr,
                "conditioning": "built-in conds.pt (not user voice)",
                "results": results,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
