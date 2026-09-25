from __future__ import annotations

import argparse
import gc
import hashlib
import json
import os
import platform
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

os.environ["CUDA_VISIBLE_DEVICES"] = ""
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

LANGUAGES = {
    "en": ("Hello, this short recording tests clear and natural speech today.", "EN"),
    "fr": ("Bonjour, cette phrase teste une voix claire et naturelle aujourd'hui.", "FR"),
    "ja": ("こんにちは。短い文章で、声の自然さと聞き取りやすさを確認します。", "JP"),
    "hi": ("नमस्ते, यह छोटा वाक्य आवाज़ की स्पष्टता और स्वाभाविकता जाँचता है।", "HI"),
    "te": ("నమస్కారం, ఈ చిన్న వాక్యం స్వర స్పష్టతను మరియు సహజత్వాన్ని పరీక్షిస్తుంది.", "TE"),
}
PINS = {
    "openvoice": {
        "source": "74a1d147b17a8c3092dd5430504bd83ef6c7eb23",
        "weights": "f36e7edfe1684461a8343844af60babc2efbb727",
    },
    "chatterbox": {
        "source": "5de7a54aa4e5e2baadb0182dde554908b48b85c2",
        "weights": "5bb1f6ee58e50c3b8d408bc82a6d3740c2db6e18",
    },
    "chatterbox_telugu": {
        "source": "5de7a54aa4e5e2baadb0182dde554908b48b85c2",
        "weights": "d4341468c1738ea669ef096baccecc68cc8ba9f3",
    },
    "indicf5": {
        "source": "13f7c4d627cc10111aea8fe9c0039462cacacdc7",
        "weights": "ba85abedf18dc479a447eaa0eccbd76ab78a47d5",
    },
}
MELO_PINS = {
    "EN": "bb4fb7346d566d277ba8c8c7dbfdf6786139b8ef",
    "FR": "1e9bf590262392d8bffb679b0a3b0c16b0f9fdaf",
    "JP": "367f8795464b531b4e97c1515bddfc1243e60891",
}
WAVMARK_PIN = "0ad3c7b74f641bddb61f6b85cdf2de0d93a5bfef"
BERT_PINS = {
    "bert-base-uncased": ("google-bert/bert-base-uncased", "86b5e0934494bd15c9632b12f734a8a67f723594"),
    "dbmdz/bert-base-french-europeana-cased": (
        "dbmdz/bert-base-french-europeana-cased",
        "b895c3cf291f7bf4c15639078a6bee0b3e272c5b",
    ),
    "tohoku-nlp/bert-base-japanese-v3": (
        "tohoku-nlp/bert-base-japanese-v3",
        "65243d6e5629b969c77309f217bd7b1a79d43c7e",
    ),
}


class RssSampler:
    def __init__(self, interval: float = 0.05):
        self.interval = interval
        self.peak = 0
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def __enter__(self):
        import psutil

        process = psutil.Process(os.getpid())
        self.peak = process.memory_info().rss

        def sample():
            while not self._stop.wait(self.interval):
                try:
                    self.peak = max(self.peak, process.memory_info().rss)
                except psutil.Error:
                    return

        self._thread = threading.Thread(target=sample, daemon=True)
        self._thread.start()
        return self

    def __exit__(self, *_):
        self._stop.set()
        if self._thread:
            self._thread.join()


def measure(fn):
    with RssSampler() as rss:
        started = time.perf_counter()
        result = fn()
        elapsed = time.perf_counter() - started
    return result, elapsed, rss.peak / (1024 * 1024)


def current_rss_mb():
    import psutil

    return psutil.Process(os.getpid()).memory_info().rss / (1024 * 1024)


def prepare_reference(path: Path):
    import soundfile as sf

    info = sf.info(path)
    duration = info.frames / info.samplerate
    if not 20 <= duration <= 30:
        raise ValueError("Reference recording must be 20–30 seconds")
    if info.channels > 2:
        raise ValueError("Reference recording must be mono or stereo")
    return {
        "duration_s": round(duration, 3),
        "samplerate_hz": info.samplerate,
        "channels": info.channels,
        "format": info.format,
        "subtype": info.subtype,
    }


def load_hf_snapshot(
    repo_id: str,
    revision: str,
    allow_patterns: list[str],
    local_only: bool = False,
) -> Path:
    from huggingface_hub import snapshot_download

    local_dir = Path(__file__).resolve().parent / ".local" / "hf" / repo_id.replace("/", "--") / revision
    return Path(
        snapshot_download(
            repo_id=repo_id,
            revision=revision,
            allow_patterns=allow_patterns,
            local_dir=str(local_dir),
            local_files_only=local_only,
        )
    )


def weight_hashes(root: Path):
    hashes = {}
    for path in sorted(root.rglob("*")):
        if path.is_file() and path.suffix.lower() in {".pt", ".pth", ".safetensors", ".bin", ".pkl"}:
            digest = hashlib.sha256()
            with path.open("rb") as stream:
                for block in iter(lambda: stream.read(1024 * 1024), b""):
                    digest.update(block)
            hashes[path.relative_to(root).as_posix()] = digest.hexdigest()
    return hashes


def configure_pinned_melo_text_models():
    import importlib
    import sys
    import types
    import transformers

    snapshots = {
        model_id: load_hf_snapshot(
            repo_id,
            revision,
            ["config.json", "tokenizer.json", "tokenizer_config.json", "special_tokens_map.json", "vocab.txt", "pytorch_model.bin", "model.safetensors"],
        )
        for model_id, (repo_id, revision) in BERT_PINS.items()
    }
    original_tokenizer = transformers.AutoTokenizer.from_pretrained
    original_model = transformers.AutoModelForMaskedLM.from_pretrained

    def resolve(model_id):
        if model_id not in snapshots:
            raise RuntimeError(f"Unpinned MeloTTS text model requested: {model_id}")
        return str(snapshots[model_id])

    transformers.AutoTokenizer.from_pretrained = classmethod(
        lambda cls, model_id, *args, **kwargs: original_tokenizer(
            resolve(model_id), *args, local_files_only=True, **kwargs
        )
    )
    transformers.AutoModelForMaskedLM.from_pretrained = classmethod(
        lambda cls, model_id, *args, **kwargs: original_model(
            resolve(model_id), *args, local_files_only=True, **kwargs
        )
    )

    english = importlib.import_module("melo.text.english")
    french = importlib.import_module("melo.text.french")
    japanese = importlib.import_module("melo.text.japanese")
    cleaner = types.ModuleType("melo.text.cleaner")
    modules = {"EN": english, "FR": french, "JP": japanese}

    def clean_text(text, language):
        module = modules[language]
        normalized = module.text_normalize(text)
        phones, tones, word2ph = module.g2p(normalized)
        return normalized, phones, tones, word2ph

    cleaner.clean_text = clean_text
    sys.modules["melo.text.cleaner"] = cleaner
    text_package = importlib.import_module("melo.text")

    def get_bert(text, word2ph, language, device):
        modules = {"EN": "english_bert", "FR": "french_bert", "JP": "japanese_bert"}
        if language not in modules:
            raise RuntimeError(f"Language not pinned for this benchmark: {language}")
        module = importlib.import_module(f"melo.text.{modules[language]}")
        if language == "JP":
            return module.get_bert_feature(text, word2ph, device=device)
        return module.get_bert_feature(text, word2ph, device=device)

    text_package.get_bert = get_bert
    return snapshots


def benchmark_chatterbox(reference: Path, output_dir: Path, threads: int, variant: str):
    import torch
    import torchaudio
    import chatterbox.mtl_tts as mtl_tts

    if torch.cuda.is_available():
        raise RuntimeError("CUDA is visible; this benchmark must run CPU-only")
    torch.set_num_threads(threads)
    output_dir.mkdir(parents=True, exist_ok=True)

    if variant == "chatterbox_telugu":
        repo_id = "shankarpandala/chatterbox-telugu"
        revision = PINS[variant]["weights"]
        t3_model = "t3_mtl_te.safetensors"
        languages = None
        candidate = "Chatterbox Telugu fine-tune"
        prefix = "chatterbox-telugu"
        weight_patterns = [
            "ve.pt",
            "t3_mtl_te.safetensors",
            "config.json",
            "s3gen.pt",
            "grapheme_mtl_merged_expanded_v1.json",
            "conds.pt",
            "Cangjie5_TC.json",
        ]
    else:
        repo_id = "ResembleAI/chatterbox"
        revision = PINS["chatterbox"]["weights"]
        t3_model = "v3"
        languages = ("en", "fr", "hi")
        candidate = "Chatterbox Multilingual V3"
        prefix = "chatterbox"
        weight_patterns = [
            "ve.pt",
            "t3_mtl23ls_v3.safetensors",
            "s3gen.pt",
            "grapheme_mtl_merged_expanded_v1.json",
            "conds.pt",
            "Cangjie5_TC.json",
        ]

    checkpoint_dir, download_s, download_peak = measure(
        lambda: load_hf_snapshot(repo_id, revision, weight_patterns)
    )
    if variant == "chatterbox_telugu":
        adapter_config = json.loads((checkpoint_dir / "config.json").read_text(encoding="utf-8"))
        t3_vocab_size = int(adapter_config["vocab_size"])
        language_code = adapter_config["language"]
        mtl_tts.SUPPORTED_LANGUAGES[language_code] = adapter_config["language_name"]
        languages = (language_code, "hi")
        mtl_tts.T3Config.multilingual = classmethod(
            lambda cls: cls(text_tokens_dict_size=t3_vocab_size)
        )
    else:
        t3_vocab_size = None
    model, load_s, load_peak = measure(
        lambda: mtl_tts.ChatterboxMultilingualTTS.from_local(
            checkpoint_dir, device="cpu", t3_model=t3_model
        )
    )
    if str(model.device) != "cpu":
        raise RuntimeError("Chatterbox did not load on CPU")
    idle_after_model_load_mb = current_rss_mb()

    _, conditioning_s, conditioning_peak = measure(
        lambda: model.prepare_conditionals(str(reference), exaggeration=0.5)
    )
    idle_after_conditioning_mb = current_rss_mb()
    results = []
    for language in languages:
        text, _ = LANGUAGES[language]
        output = output_dir / f"{prefix}-{language}.wav"
        waveform, synthesis_s, synthesis_peak = measure(
            lambda: model.generate(
                text,
                language_id=language,
                exaggeration=0.5,
                cfg_weight=0.5,
                temperature=0.8,
            )
        )
        torchaudio.save(str(output), waveform.cpu(), model.sr)
        results.append(
            {
                "language": language,
                "text": text,
                "word_count": len(text.split()) if language != "ja" else None,
                "character_count": len(text),
                "synthesis_s": round(synthesis_s, 3),
                "peak_rss_mb": round(synthesis_peak, 1),
                "output_duration_s": round(waveform.shape[-1] / model.sr, 3),
                "sample_rate_hz": model.sr,
                "output_file": output.name,
            }
        )

    return {
        "candidate": candidate,
        "source_revision": PINS["chatterbox"]["source"],
        "weights_revision": revision,
        "t3_vocab_size": t3_vocab_size,
        "device": "cpu",
        "threads": threads,
        "weights_download_s": round(download_s, 3),
        "weights_download_peak_rss_mb": round(download_peak, 1),
        "weights_sha256": weight_hashes(checkpoint_dir),
        "model_load_s": round(load_s, 3),
        "model_load_peak_rss_mb": round(load_peak, 1),
        "idle_after_model_load_rss_mb": round(idle_after_model_load_mb, 1),
        "voice_conditioning_s": round(conditioning_s, 3),
        "idle_after_conditioning_rss_mb": round(idle_after_conditioning_mb, 1),
        "conditioning_peak_rss_mb": round(conditioning_peak, 1),
        "supported_languages": sorted(mtl_tts.SUPPORTED_LANGUAGES),
        "required_target_languages": ["hi", "te"],
        "unsupported_required_languages": sorted({"hi", "te"} - set(mtl_tts.SUPPORTED_LANGUAGES)),
        "languages": results,
    }


def benchmark_openvoice(reference: Path, output_dir: Path, threads: int):
    import torch
    from openvoice.api import ToneColorConverter

    if torch.cuda.is_available():
        raise RuntimeError("CUDA is visible; this benchmark must run CPU-only")
    torch.set_num_threads(threads)
    output_dir.mkdir(parents=True, exist_ok=True)

    weights_dir, download_s, download_peak = measure(
        lambda: load_hf_snapshot(
            "myshell-ai/OpenVoiceV2",
            PINS["openvoice"]["weights"],
            ["converter/**", "base_speakers/ses/**"],
        )
    )
    import wavmark

    watermark_filename = "step59000_snr39.99_pesq4.35_BERP_none0.30_mean1.81_std1.81.model.pkl"
    watermark_dir, watermark_download_s, _ = measure(
        lambda: load_hf_snapshot("M4869/WavMark", WAVMARK_PIN, [watermark_filename])
    )
    watermark_weights = watermark_dir / watermark_filename
    default_wavmark_loader = wavmark.load_model
    wavmark.load_model = lambda path="default": default_wavmark_loader(
        str(watermark_weights) if path == "default" else path
    )

    def load_converter():
        converter = ToneColorConverter(
            str(weights_dir / "converter" / "config.json"), device="cpu"
        )
        converter.load_ckpt(str(weights_dir / "converter" / "checkpoint.pth"))
        return converter

    converter, load_s, load_peak = measure(load_converter)
    idle_after_model_load_mb = current_rss_mb()
    target_embedding, conditioning_s, conditioning_peak = measure(
        lambda: converter.extract_se(str(reference))
    )

    idle_after_conditioning_mb = current_rss_mb()
    bert_snapshots, bert_setup_s, bert_setup_peak = measure(configure_pinned_melo_text_models)
    from melo.api import TTS

    melo_snapshots = {}
    results = []
    for language in ("en", "fr", "ja"):
        text, melo_language = LANGUAGES[language]
        melo_repo = {
            "EN": "myshell-ai/MeloTTS-English",
            "FR": "myshell-ai/MeloTTS-French",
            "JP": "myshell-ai/MeloTTS-Japanese",
        }[melo_language]
        config_dir, config_download_s, _ = measure(
            lambda: load_hf_snapshot(
                melo_repo, MELO_PINS[melo_language], ["config.json", "checkpoint.pth"]
            )
        )
        melo_snapshots[melo_language] = config_dir
        model, model_load_s, model_load_peak = measure(
            lambda: TTS(
                language=melo_language,
                device="cpu",
                config_path=str(config_dir / "config.json"),
                ckpt_path=str(config_dir / "checkpoint.pth"),
            )
        )
        speaker_ids = model.hps.data.spk2id
        speaker_key = sorted(speaker_ids)[0]
        speaker_id = speaker_ids[speaker_key]
        embedding_key = speaker_key.lower().replace("_", "-")
        source_embedding = torch.load(
            weights_dir / "base_speakers" / "ses" / f"{embedding_key}.pth",
            map_location="cpu",
            weights_only=True,
        )
        if isinstance(source_embedding, dict):
            source_embedding = next(iter(source_embedding.values()))
        source_path = output_dir / f"openvoice-source-{language}.wav"
        output = output_dir / f"openvoice-{language}.wav"

        def synthesize():
            model.tts_to_file(text, speaker_id, str(source_path), speed=1.0, quiet=True)
            converter.convert(
                audio_src_path=str(source_path),
                src_se=source_embedding,
                tgt_se=target_embedding,
                output_path=str(output),
                message="@MyShell",
            )

        _, synthesis_s, synthesis_peak = measure(synthesize)
        import soundfile as sf

        info = sf.info(output)
        results.append(
            {
                "language": language,
                "text": text,
                "word_count": len(text.split()) if language != "ja" else None,
                "character_count": len(text),
                "base_model_load_s": round(model_load_s, 3),
                "base_weights_download_s": round(config_download_s, 3),
                "base_model_load_peak_rss_mb": round(model_load_peak, 1),
                "synthesis_s": round(synthesis_s, 3),
                "peak_rss_mb": round(synthesis_peak, 1),
                "output_duration_s": round(info.frames / info.samplerate, 3),
                "sample_rate_hz": info.samplerate,
                "output_file": output.name,
            }
        )
        del model
        gc.collect()

    return {
        "candidate": "OpenVoice V2",
        "source_revision": PINS["openvoice"]["source"],
        "weights_revision": PINS["openvoice"]["weights"],
        "device": "cpu",
        "threads": threads,
        "weights_download_s": round(download_s, 3),
        "weights_download_peak_rss_mb": round(download_peak, 1),
        "melo_source_revision": "209145371cff8fc3bd60d7be902ea69cbdb7965a",
        "bert_revisions": BERT_PINS,
        "watermark_source_revision": "6ab3bf7ce0679e5b5cfeff3a62e8df9cd2024b37",
        "watermark_weights_revision": WAVMARK_PIN,
        "watermark_weights_download_s": round(watermark_download_s, 3),
        "watermark_weights_sha256": hashlib.sha256(watermark_weights.read_bytes()).hexdigest(),
        "openvoice_weights_sha256": weight_hashes(weights_dir),
        "melo_weights_sha256": {
            lang: weight_hashes(path) for lang, path in melo_snapshots.items()
        },
        "bert_weights_sha256": {
            model_id: weight_hashes(path) for model_id, path in bert_snapshots.items()
        },
        "converter_load_s": round(load_s, 3),
        "converter_load_peak_rss_mb": round(load_peak, 1),
        "idle_after_model_load_rss_mb": round(idle_after_model_load_mb, 1),
        "voice_conditioning_s": round(conditioning_s, 3),
        "idle_after_conditioning_rss_mb": round(idle_after_conditioning_mb, 1),
        "conditioning_peak_rss_mb": round(conditioning_peak, 1),
        "melo_bert_asset_setup_s": round(bert_setup_s, 3),
        "melo_bert_asset_setup_peak_rss_mb": round(bert_setup_peak, 1),
        "languages": results,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("candidate", choices=("openvoice", "chatterbox", "chatterbox_telugu"))
    parser.add_argument("--reference-audio", required=True, type=Path)
    parser.add_argument("--reference-transcript-file", required=True, type=Path)
    parser.add_argument("--threads", type=int, default=8)
    parser.add_argument("--output-dir", type=Path, default=Path("infra/voice-bakeoff/.local/results"))
    args = parser.parse_args()

    if not args.reference_audio.is_file():
        parser.error("reference audio file does not exist")
    if not args.reference_transcript_file.is_file():
        parser.error("reference transcript file does not exist")
    if not args.reference_transcript_file.read_text(encoding="utf-8").strip():
        parser.error("exact reference transcript is required")
    if args.threads < 1:
        parser.error("threads must be positive")

    reference_metadata = prepare_reference(args.reference_audio)
    import psutil
    import torch

    if torch.cuda.is_available():
        raise RuntimeError("CPU-only PyTorch is required")
    baseline_rss_mb = current_rss_mb()

    started = datetime.now(timezone.utc).isoformat()
    if args.candidate == "openvoice":
        measurements = benchmark_openvoice(args.reference_audio, args.output_dir, args.threads)
    else:
        measurements = benchmark_chatterbox(
            args.reference_audio, args.output_dir, args.threads, args.candidate
        )
    report = {
        "started_at_utc": started,
        "machine": {
            "platform": platform.platform(),
            "processor": platform.processor(),
            "logical_cpus": os.cpu_count(),
            "ram_total_bytes": psutil.virtual_memory().total,
            "python": platform.python_version(),
            "torch": torch.__version__,
        },
        "reference_audio": reference_metadata,
        "baseline_rss_mb": round(baseline_rss_mb, 1),
        "melo_text_model_pins": BERT_PINS,
        "measurements": measurements,
    }
    args.output_dir.mkdir(parents=True, exist_ok=True)
    output = args.output_dir / f"{args.candidate}-results.json"
    output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"Benchmark complete: {output}")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
