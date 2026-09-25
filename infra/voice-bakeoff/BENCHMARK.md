# CPU model benchmark

Status: **incomplete**. No user reference recording or transcript has been supplied, so no speaker-conditioning time, synthesis latency, generated audio, or audio-quality result exists. No audio has been sent to a hosted service and no synthesis results are estimated.

The user requires Telugu and Hindi. Original OpenVoice V2 and base Chatterbox Multilingual V3 are comparison baselines, but neither is a verified Telugu solution. The user approved adding the Chatterbox Telugu fine-tune and conditionally checking official IndicF5.

## Machine/runtime

- OS: Windows 10.0.26200
- CPU: Intel64 Family 6 Model 151 Stepping 2
- Logical CPUs: 12
- Physical RAM: 11.7 GiB
- Free disk at initial setup: 70.7 GiB
- Python: 3.11.3
- Chatterbox environment: PyTorch 2.6.0+cpu; `torch.cuda.is_available()` is false.
- OpenVoice environment: PyTorch 2.6.0+cpu, Transformers 4.27.4, librosa 0.9.1, NumPy 1.23.5; CUDA unavailable.
- Benchmark uses 8 CPU threads.

Although `nvidia-smi` reports a host NVIDIA device, all benchmark processes set `CUDA_VISIBLE_DEVICES=""` and use `device="cpu"`. No GPU execution is allowed.

## Pinned candidates

- OpenVoice code `myshell-ai/OpenVoice`: `74a1d147b17a8c3092dd5430504bd83ef6c7eb23`; weights `myshell-ai/OpenVoiceV2`: `f36e7edfe1684461a8343844af60babc2efbb727`.
- Chatterbox code `resemble-ai/chatterbox`: `5de7a54aa4e5e2baadb0182dde554908b48b85c2`; base Multilingual V3 weights `ResembleAI/chatterbox`: `5bb1f6ee58e50c3b8d408bc82a6d3740c2db6e18`.
- Chatterbox Telugu fine-tune weights `shankarpandala/chatterbox-telugu`: `d4341468c1738ea669ef096baccecc68cc8ba9f3`; uses the pinned Chatterbox code with `t3_mtl_te.safetensors`; its model-card license is CC-BY-4.0.
- Conditional IndicF5: source `AI4Bharat/IndicF5` commit `13f7c4d627cc10111aea8fe9c0039462cacacdc7`; weights `ai4bharat/IndicF5` revision `ba85abedf18dc479a447eaa0eccbd76ab78a47d5`. It is gated; do not download until the user accepts its terms and local authentication is available.
- OpenVoice MeloTTS/BERT/watermark revisions and model/dependency hashes are listed in LICENSES.md.

## Required reference recording and test targets

- Required input: user's own clean Telugu sample, 20–30 seconds, plus its exact Telugu transcript in a separate UTF-8 file. Keep both local and ignored; never write the transcript or sample path into result JSON.
- IndicF5 requires reference audio and transcript. Chatterbox base/fine-tune and OpenVoice reference-embedding extraction do not consume the transcript.
- Required output test set: Telugu and Hindi; English may be a comparison baseline. Fixed benchmark prompts are test fixtures only. The future app must query selected-model language metadata dynamically.
- OpenVoice/MeloTTS native base languages do not include Telugu or Hindi. Its EN/FR/JP stacks were loaded as baseline checks; do not count it as meeting the required languages.

No reference sample was found in the repository, Downloads, or `.local/` at the last check. Do not substitute another speaker or claim voice likeness without the user's sample.

## Results

| Candidate | Telugu/Hindi fit | Model-load preflight | Post-load RSS | Conditioning | Peak RSS | Output tests | Audio/quality notes |
|---|---|---:|---:|---:|---:|---|---|
| OpenVoice V2 | No verified native Telugu/Hindi MeloTTS base | Converter 0.65–1.98 s; Melo EN/FR/JP 1.08–1.69 s each | Converter 728.8–744.0 MiB; Melo after load 742.0–1076.2 MiB | Pending sample | 719.6–744.0 MiB converter; 934.0–1079.8 MiB per Melo load | EN/FR/JP speech pending; HI/TE unsupported by verified base stack | CPU models load; no speech synthesized |
| Chatterbox Multilingual V3 | Hindi yes; Telugu absent from base language list | 47.53–74.93 s (3 model-load preflights) | 1190.4–2017.5 MiB | Pending sample | 2885.6–3927.3 MiB during load | English/Hindi pending; Telugu unsupported | CPU load only; no speech synthesized |
| Chatterbox Telugu fine-tune | Telugu adapter plus base Hindi metadata loaded | 24.57–68.14 s (4 model-load preflights) | 912.4–1744.6 MiB | **Synthesis probe ran with built-in `conds.pt` speaker conditioning — not the user's voice** | 2224.2–2400.9 MiB during synthesis | **te/hi/en WAVs generated; see synthesis probe below** | Real audio emitted (RMS 0.14–0.16, 24 kHz); speaker similarity still unverified — needs the user's sample |
| IndicF5 (conditional) | Telugu and Hindi listed | Blocked on gated access/license review | — | Pending sample and transcript | — | Not tested | Not downloaded |

## Chatterbox Telugu synthesis probe (real CPU numbers)

Command:

```powershell
infra\voice-bakeoff\.venv-chatterbox\Scripts\python.exe `
  infra\voice-bakeoff\synthesis_probe.py chatterbox_telugu `
  --output-dir infra\voice-bakeoff\.local\probe
```

Uses the adapter's built-in `conds.pt` conditioning (the model's bundled reference voice) — speaker cloning against the user's recording is still untested and awaits the sample. Outputs land in the ignored `.local/probe/` directory.

| Language | Wall-clock synthesis | Peak RSS | Audio produced | RTF (synthesis ÷ audio) | Output sanity |
|---|---:|---:|---:|---:|---|
| Telugu (`te`) | 112.20 s | 2331.2 MiB | 4.20 s | 26.7× | non-silent, RMS 0.164, peak 1.00 |
| Hindi (`hi`) | 72.05 s | 2224.2 MiB | 4.32 s | 16.7× | non-silent, RMS 0.155, peak 0.98 |
| English (`en`) | 65.36 s | 2400.9 MiB | 2.92 s | 22.4× | non-silent, RMS 0.143, peak 0.84 |

Model load in the same run: 68.14 s, 916.9 MiB idle RSS after load, 2049.6 MiB peak during load. T3 sampling runs at ~4–5 tokens/s on this CPU; a typical spoken sentence (roughly 100–300 speech tokens) therefore takes ~30–90 s per chunk. **Feasible for on-demand "Read Text"/"Read Aloud", marginal for sentence-by-sentence hands-free chat** — see RECOMMENDATION.md.

The model-load figures remain load-only measurements with significant run-to-run variation; RSS is absolute process memory sampled during load and synthesis.

## OpenVoice preflight commands/results

The OpenVoice preflight loads the tone-color converter, pinned WavMark, BERT assets, and MeloTTS CPU models without using a reference recording. The first call downloaded the pinned artifacts into ignored `infra/voice-bakeoff/.local/hf`; the second reused those local copies. The exact generated SHA-256 inventory is in LICENSES.md.

| Exact command | Converter load / peak / after RSS | BERT asset setup / peak | MeloTTS model load seconds (EN / FR / JP) | Result |
|---|---|---|---|---|
| `.venv-openvoice/Scripts/python.exe infra/voice-bakeoff/preflight_openvoice.py` | 1.98 s / 744.0 MiB / 744.0 MiB | 55.37 s / 789.4 MiB | 1.69 / 1.28 / 1.60 | CPU loads passed |
| `.venv-openvoice/Scripts/python.exe infra/voice-bakeoff/preflight_openvoice.py --local-only` | 0.65 s / 719.6 MiB / 728.8 MiB | 6.99 s / 1013.8 MiB | 1.58 / 1.30 / 1.08 | Cached CPU loads passed |

Both runs reported Python 3.11.3, PyTorch 2.6.0+cpu, CUDA unavailable, and 8 threads. Neither call ran reference extraction, synthesis, or output listening.

## Chatterbox preflight commands/results

The script measures `from_local()` only; cached snapshot access is outside the timed model-load interval. Each output listed pinned source and weight revisions, Python 3.11.3, PyTorch 2.6.0+cpu, `cuda_available=false`, `torch_device=cpu`, 8 threads, and 24,000 Hz model sample rate.

| Candidate | Exact command | Load seconds | RSS before (MiB) | Peak during load (MiB) | RSS after load (MiB) |
|---|---|---:|---:|---:|---:|
| Base V3 | `.venv-chatterbox/Scripts/python.exe infra/voice-bakeoff/preflight_model.py chatterbox` | 70.44 | 29.0 | 3927.3 | 1199.6 |
| Base V3 | `.venv-chatterbox/Scripts/python.exe infra/voice-bakeoff/preflight_model.py chatterbox --local-only` | 47.53 | 442.6 | 2885.6 | 1190.4 |
| Telugu fine-tune | `.venv-chatterbox/Scripts/python.exe infra/voice-bakeoff/preflight_model.py chatterbox_telugu --local-only` | 52.27 | 443.0 | 3277.2 | 1540.7 |
| Telugu fine-tune | same command | 36.90 | 442.9 | 3485.9 | 1744.6 |
| Telugu fine-tune | same command | 24.57 | 442.6 | 3420.3 | 912.4 |

The Telugu adapter preflight reads `vocab_size=2521` and its language code/name from the pinned adapter `config.json`. Pinned Chatterbox source defaults to a 2454-token multilingual T3; without the benchmark-only configuration shim, loading the fine-tune fails due the text embedding/head size mismatch. The shim changes only the isolated runner, preserves base Chatterbox defaults, and does not modify installed packages or application code. The loaded model reports Telugu and Hindi support. This verifies model loading and metadata compatibility, not successful speech synthesis.

## Human evaluation

Three probe WAVs exist at `infra/voice-bakeoff/.local/probe/probe-chatterbox_telugu-{te,hi,en}.wav` (built-in voice, not the user's). They are confirmed non-silent but **have not been listened to** — pronunciation, intelligibility and stability review is still pending. Speaker similarity cannot be assessed until the user's consented Telugu sample + transcript arrive. Ask a fluent Telugu/Hindi speaker to listen to the probe files in the meantime.

## Reproducibility and remaining checks

- Chatterbox CPU requirements/source installed; `pip check` passes. `requirements-chatterbox-lock.txt` records the resolved environment.
- OpenVoice source/runtime imports and pinned CPU model-load preflights passed after adding pinned `fugashi`/`loguru` dependencies and storing HF files under ignored `.local/hf` to avoid Windows symlink-privilege failures.
- OpenVoice `pip check` is not clean: source package metadata reports omitted optional/demo/training packages and an upstream NumPy 1.22.0 requirement that has no Python 3.11 wheel; the benchmark uses NumPy 1.23.5. See LICENSES.md. Tested OpenVoice synthesis/conditioning may still expose missing inference dependencies.
- Chatterbox base/Telugu synthesis and OpenVoice conditioning/output have not been benchmarked.
- IndicF5 remains gated and has not been downloaded. No HF token has been requested in chat.
- Full dependency/license verification remains incomplete; see LICENSES.md. The user must provide the Telugu recording/transcript before audio conditioning or synthesis runs.
- Do not proceed to application phases until synthesis results and unresolved licenses are reviewed. The user separately authorized automatic continuation only after a successful, license-cleared Phase 1 recommendation.
