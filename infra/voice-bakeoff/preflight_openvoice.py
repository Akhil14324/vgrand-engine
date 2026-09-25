from __future__ import annotations

import argparse
import gc
import json
import os
import time
from pathlib import Path

os.environ["CUDA_VISIBLE_DEVICES"] = ""
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

from run_benchmark import (
    BERT_PINS,
    MELO_PINS,
    PINS,
    WAVMARK_PIN,
    RssSampler,
    configure_pinned_melo_text_models,
    current_rss_mb,
    load_hf_snapshot,
    weight_hashes,
)


def measure(fn):
    with RssSampler() as rss:
        started = time.perf_counter()
        result = fn()
        elapsed = time.perf_counter() - started
    return result, elapsed, rss.peak / (1024 * 1024)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--local-only", action="store_true")
    args = parser.parse_args()

    import torch

    if torch.cuda.is_available():
        raise RuntimeError("CPU-only PyTorch is required")
    torch.set_num_threads(8)

    def snapshot(repo_id, revision, patterns):
        return load_hf_snapshot(
            repo_id, revision, patterns, local_only=args.local_only
        )

    converter_dir, converter_download_s, _ = measure(
        lambda: snapshot(
            "myshell-ai/OpenVoiceV2",
            PINS["openvoice"]["weights"],
            ["converter/**", "base_speakers/ses/**"],
        )
    )
    watermark_filename = "step59000_snr39.99_pesq4.35_BERP_none0.30_mean1.81_std1.81.model.pkl"
    watermark_dir, watermark_download_s, _ = measure(
        lambda: snapshot("M4869/WavMark", WAVMARK_PIN, [watermark_filename])
    )
    watermark_path = watermark_dir / watermark_filename

    import wavmark

    load_wavmark = wavmark.load_model
    wavmark.load_model = lambda path="default": load_wavmark(
        str(watermark_path) if path == "default" else path
    )
    from openvoice.api import ToneColorConverter

    def load_converter():
        converter = ToneColorConverter(
            str(converter_dir / "converter" / "config.json"), device="cpu"
        )
        converter.load_ckpt(str(converter_dir / "converter" / "checkpoint.pth"))
        return converter

    converter, converter_load_s, converter_peak = measure(load_converter)
    idle_after_converter_mb = current_rss_mb()
    bert_snapshots, bert_setup_s, bert_setup_peak = measure(
        configure_pinned_melo_text_models
    )
    from melo.api import TTS

    melo_results = []
    for language, code in (("en", "EN"), ("fr", "FR"), ("ja", "JP")):
        repo_id = {
            "EN": "myshell-ai/MeloTTS-English",
            "FR": "myshell-ai/MeloTTS-French",
            "JP": "myshell-ai/MeloTTS-Japanese",
        }[code]
        model_dir, model_download_s, _ = measure(
            lambda: snapshot(
                repo_id,
                MELO_PINS[code],
                ["config.json", "checkpoint.pth"],
            )
        )
        model, model_load_s, model_peak = measure(
            lambda: TTS(
                language=code,
                device="cpu",
                config_path=str(model_dir / "config.json"),
                ckpt_path=str(model_dir / "checkpoint.pth"),
            )
        )
        melo_results.append(
            {
                "language": language,
                "weights_revision": MELO_PINS[code],
                "weights_sha256": weight_hashes(model_dir),
                "download_s": round(model_download_s, 2),
                "load_s": round(model_load_s, 2),
                "peak_rss_during_load_mb": round(model_peak, 1),
                "rss_after_load_mb": round(current_rss_mb(), 1),
                "device": str(next(model.model.parameters()).device),
            }
        )
        del model
        gc.collect()

    print(
        json.dumps(
            {
                "code_revision": PINS["openvoice"]["source"],
                "weights_revision": PINS["openvoice"]["weights"],
                "python": os.sys.version.split()[0],
                "torch": torch.__version__,
                "cuda_available": torch.cuda.is_available(),
                "threads": torch.get_num_threads(),
                "converter_download_s": round(converter_download_s, 2),
                "converter_weight_sha256": weight_hashes(converter_dir),
                "watermark_download_s": round(watermark_download_s, 2),
                "watermark_sha256": weight_hashes(Path(watermark_path).parent),
                "converter_load_s": round(converter_load_s, 2),
                "converter_peak_rss_mb": round(converter_peak, 1),
                "rss_after_converter_load_mb": round(idle_after_converter_mb, 1),
                "bert_pins": {key: BERT_PINS[key] for key in bert_snapshots},
                "bert_weights_sha256": {
                    model_id: weight_hashes(path)
                    for model_id, path in bert_snapshots.items()
                },
                "bert_setup_s": round(bert_setup_s, 2),
                "bert_setup_peak_rss_mb": round(bert_setup_peak, 1),
                "melo_tts": melo_results,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
