from __future__ import annotations

import argparse
import json
import os
import time
from pathlib import Path

os.environ["CUDA_VISIBLE_DEVICES"] = ""

from run_benchmark import PINS, RssSampler, current_rss_mb, load_hf_snapshot


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("candidate", choices=("chatterbox", "chatterbox_telugu"))
    parser.add_argument("--local-only", action="store_true")
    args = parser.parse_args()

    import torch
    import chatterbox.mtl_tts as mtl_tts

    if torch.cuda.is_available():
        raise RuntimeError("CPU-only PyTorch is required")
    torch.set_num_threads(8)

    if args.candidate == "chatterbox_telugu":
        repo_id = "shankarpandala/chatterbox-telugu"
        revision = PINS[args.candidate]["weights"]
        patterns = [
            "config.json",
            "ve.pt",
            "t3_mtl_te.safetensors",
            "s3gen.pt",
            "grapheme_mtl_merged_expanded_v1.json",
            "conds.pt",
            "Cangjie5_TC.json",
        ]
        t3_model = "t3_mtl_te.safetensors"
    else:
        repo_id = "ResembleAI/chatterbox"
        revision = PINS[args.candidate]["weights"]
        patterns = [
            "ve.pt",
            "t3_mtl23ls_v3.safetensors",
            "s3gen.pt",
            "grapheme_mtl_merged_expanded_v1.json",
            "conds.pt",
            "Cangjie5_TC.json",
        ]
        t3_model = "v3"

    checkpoint_dir = load_hf_snapshot(
        repo_id, revision, patterns, local_only=args.local_only
    )
    vocab_size = None
    if args.candidate == "chatterbox_telugu":
        config = json.loads((checkpoint_dir / "config.json").read_text(encoding="utf-8"))
        vocab_size = int(config["vocab_size"])
        language_code = config["language"]
        mtl_tts.SUPPORTED_LANGUAGES[language_code] = config["language_name"]
        mtl_tts.T3Config.multilingual = classmethod(
            lambda cls: cls(text_tokens_dict_size=vocab_size)
        )

    rss_before = current_rss_mb()
    with RssSampler() as sampler:
        started = time.perf_counter()
        model = mtl_tts.ChatterboxMultilingualTTS.from_local(
            checkpoint_dir, device="cpu", t3_model=t3_model
        )
        load_seconds = time.perf_counter() - started

    print(
        json.dumps(
            {
                "candidate": args.candidate,
                "code_revision": PINS["chatterbox"]["source"],
                "weights_revision": revision,
                "python": os.sys.version.split()[0],
                "torch": torch.__version__,
                "cuda_available": torch.cuda.is_available(),
                "torch_device": model.device,
                "torch_threads": torch.get_num_threads(),
                "vocab_size": vocab_size,
                "supported_languages": sorted(model.get_supported_languages()),
                "load_seconds": round(load_seconds, 2),
                "rss_before_mb": round(rss_before, 1),
                "peak_rss_during_load_mb": round(sampler.peak / (1024 * 1024), 1),
                "rss_after_load_mb": round(current_rss_mb(), 1),
                "sample_rate_hz": model.sr,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
