# Voice cloning CPU bake-off

This directory contains an isolated feasibility harness only. It does not modify CatGPT application behavior. Do not copy voice recordings, model weights, or generated audio into tracked files.

## Current machine/runtime

Benchmark runs must use CPU even if another machine has an available GPU. This workstation currently has a CPU-only PyTorch build (`2.13.0+cpu`), 12 logical CPUs, and 11.7 GiB RAM. The run report must repeat the actual runtime details and confirm CUDA is unavailable to the benchmark process.

## Selected revisions

- OpenVoice source: `myshell-ai/OpenVoice` commit `74a1d147b17a8c3092dd5430504bd83ef6c7eb23`.
- OpenVoice V2 checkpoint repository: `myshell-ai/OpenVoiceV2` revision `f36e7edfe1684461a8343844af60babc2efbb727`.
- Chatterbox source: `resemble-ai/chatterbox` commit `5de7a54aa4e5e2baadb0182dde554908b48b85c2`.
- Chatterbox Multilingual V3 weights: `ResembleAI/chatterbox` revision `5bb1f6ee58e50c3b8d408bc82a6d3740c2db6e18`.
- Telugu Chatterbox fine-tune weights: `shankarpandala/chatterbox-telugu` revision `d4341468c1738ea669ef096baccecc68cc8ba9f3` (model-card license CC-BY-4.0; attribution required). It reuses the pinned Chatterbox source and bundles the base acoustic weights.
- Conditional Telugu candidate: `AI4Bharat/IndicF5` source commit `13f7c4d627cc10111aea8fe9c0039462cacacdc7`, model revision `ba85abedf18dc479a447eaa0eccbd76ab78a47d5` (gated; do not download until the user accepts the model terms and local auth works).
- OpenVoice base speech models: English `myshell-ai/MeloTTS-English` revision `bb4fb7346d566d277ba8c8c7dbfdf6786139b8ef`, French `myshell-ai/MeloTTS-French` revision `1e9bf590262392d8bffb679b0a3b0c16b0f9fdaf`, Japanese `myshell-ai/MeloTTS-Japanese` revision `367f8795464b531b4e97c1515bddfc1243e60891`.
- OpenVoice text-model weights: `google-bert/bert-base-uncased` revision `86b5e0934494bd15c9632b12f734a8a67f723594`, `dbmdz/bert-base-french-europeana-cased` revision `b895c3cf291f7bf4c15639078a6bee0b3e272c5b`, and `tohoku-nlp/bert-base-japanese-v3` revision `65243d6e5629b969c77309f217bd7b1a79d43c7e`.
- OpenVoice watermark: `wavmark/wavmark` commit `6ab3bf7ce0679e5b5cfeff3a62e8df9cd2024b37`; weights `M4869/WavMark` revision `0ad3c7b74f641bddb61f6b85cdf2de0d93a5bfef`.

**Required output languages are Telugu and Hindi.** OpenVoice/MeloTTS and base Chatterbox do not list Telugu; they will be measured only as baselines, not treated as satisfying the Telugu requirement. The Chatterbox Telugu fine-tune and IndicF5 are being considered for the target. IndicF5 remains gated and its complete code/data license audit is pending.

Do not silently change these pins. A proposed pin change requires rechecking license, API behavior, and benchmark results.

## Isolated CPU environments

Python 3.11.3 is installed. Create separate environments so the legacy MeloTTS `transformers==4.27.4` and Chatterbox `transformers==5.2.0` requirements cannot conflict. Use the CPU wheel index and pinned requirement files:

```powershell
python -m venv infra/voice-bakeoff/.venv-openvoice
.\infra\voice-bakeoff\.venv-openvoice\Scripts\python.exe -m pip install --extra-index-url https://download.pytorch.org/whl/cpu -r infra/voice-bakeoff/requirements-openvoice.txt
.\infra\voice-bakeoff\.venv-openvoice\Scripts\python.exe -m pip install --no-deps "git+https://github.com/myshell-ai/OpenVoice.git@74a1d147b17a8c3092dd5430504bd83ef6c7eb23" "git+https://github.com/myshell-ai/MeloTTS.git@209145371cff8fc3bd60d7be902ea69cbdb7965a"

python -m venv infra/voice-bakeoff/.venv-chatterbox
.\infra\voice-bakeoff\.venv-chatterbox\Scripts\python.exe -m pip install --extra-index-url https://download.pytorch.org/whl/cpu -r infra/voice-bakeoff/requirements-chatterbox.txt
.\infra\voice-bakeoff\.venv-chatterbox\Scripts\python.exe -m pip install --no-deps "git+https://github.com/resemble-ai/Perth.git@ff1c8ac55a976971245cdd53c18d6131ca00d993" "git+https://github.com/resemble-ai/chatterbox.git@5de7a54aa4e5e2baadb0182dde554908b48b85c2"
```

The isolated environments and pinned source installs are set up. Chatterbox model-load preflights pass and its `pip check` reports no broken requirements. OpenVoice source imports and pinned CPU model-load preflights pass, but `pip check` reports omitted optional/demo/training packages and the upstream NumPy `1.22.0` pin mismatch; see BENCHMARK.md and LICENSES.md. `requirements-openvoice-lock.txt` and `requirements-chatterbox-lock.txt` record the resolved environments. OpenVoice uses NumPy `1.23.5` because the upstream `1.22.0` pin has no Python 3.11 wheel. Model snapshots are materialized under ignored `.local/hf/` to avoid Windows symlink-privilege failures; keep all local caches and model files untracked.

Model-load-only checks do not use a reference recording:

```powershell
.\infra\voice-bakeoff\.venv-openvoice\Scripts\python.exe infra\voice-bakeoff\preflight_openvoice.py
.\infra\voice-bakeoff\.venv-openvoice\Scripts\python.exe infra\voice-bakeoff\preflight_openvoice.py --local-only
.\infra\voice-bakeoff\.venv-chatterbox\Scripts\python.exe infra\voice-bakeoff\preflight_model.py chatterbox
.\infra\voice-bakeoff\.venv-chatterbox\Scripts\python.exe infra\voice-bakeoff\preflight_model.py chatterbox_telugu
```

Run synthesis after a WAV recording and separate exact-transcript text file are supplied:

```powershell
.\infra\voice-bakeoff\.venv-openvoice\Scripts\python.exe infra\voice-bakeoff\run_benchmark.py openvoice --reference-audio <local-wav-path> --reference-transcript-file <local-text-path>
.\infra\voice-bakeoff\.venv-chatterbox\Scripts\python.exe infra\voice-bakeoff\run_benchmark.py chatterbox --reference-audio <local-wav-path> --reference-transcript-file <local-text-path>
.\infra\voice-bakeoff\.venv-chatterbox\Scripts\python.exe infra\voice-bakeoff\run_benchmark.py chatterbox_telugu --reference-audio <local-wav-path> --reference-transcript-file <local-text-path>
```

## Reference recording needed

The harness requires a user-provided, consented 20–30 second recording of the user's own voice and its exact Telugu transcript. The benchmark loads it locally; no hosted inference API receives the recording. Use clean mono WAV if possible. Keep the sample and transcript outside tracked files (or under ignored `.local/`) and do not print their path or transcript into benchmark reports. IndicF5 uses the transcript as a model input; the Chatterbox models condition on the audio and do not take the transcript.

No reference sample was found in the repository or Downloads at the last check. Until the user supplies it, do not generate sample outputs or quality/latency claims; do not substitute another person's voice.

## Benchmark protocol

The comparison target is Telugu and Hindi; English is the optional reference baseline. Chatterbox Telugu and IndicF5 (if authorized) are the Telugu-capable candidates. The original OpenVoice and base Chatterbox candidates are baselines only and must be reported as unsuitable for Telugu if they cannot generate it through their verified native text stack. The benchmark has fixed Telugu/Hindi test prompts solely for reproducibility; production language metadata must be discovered from the selected model adapter, not hard-coded in the web app.

Measure separately:

1. Process baseline and model load duration / idle RSS.
2. Voice-conditioning or reference-embedding duration and RSS peak.
3. Per-language synthesis duration and peak RSS, with the voice conditionals reused if the model supports this.
4. Output sample rate/format and generated audio duration.

Use identical reference audio and equivalent test sentences for both candidates. A human listener should rate intelligibility, speaker similarity, pronunciation, and stability; machine timings do not establish voice quality.

The fixed language set and prompt strings in this benchmark are only reproducible test fixtures. The later CatGPT feature must not hard-code a default cloned voice or a separate language list in the web UI: the selected model adapter must report supported languages and supply the corresponding recording prompt metadata, and the API must synthesize from the active brand's saved voice sample/conditioning.

## API contract and serving

The pinned Chatterbox API supports `ChatterboxMultilingualTTS.from_local(checkpoint_dir, device="cpu", t3_model="v3")`, `prepare_conditionals(reference_wav)`, then `generate(text, language_id=..., audio_prompt_path=None)`. Reference conditioning is reusable in memory; the call does not take a transcript. The output is a Torch waveform tensor at `model.sr`; Chatterbox applies its Perth watermark. The pinned Chatterbox Telugu adapter uses the same API with `t3_model="t3_mtl_te.safetensors"` and `language_id="te"`; its metadata/license must be checked before use.

The pinned OpenVoice V2 API uses `ToneColorConverter.extract_se(reference_audio)` to derive the target voice embedding (no transcript argument). This avoids the repo's optional Whisper/VAD extractor, whose non-VAD path hardcodes CUDA. For each output language, MeloTTS synthesizes a base voice, and `ToneColorConverter.convert(audio_src_path, src_se, tgt_se, output_path, message="@MyShell")` transfers the reference tone color. The target embedding can be reused while the process lives. Its current MeloTTS base stack does not list Telugu or Hindi, so it is a comparison baseline rather than a verified solution for the Telugu requirement.

IndicF5 (conditional) takes target text, reference audio, and the exact reference transcript; it returns 24 kHz audio and lists Telugu/Hindi among 11 Indic languages. Its HF repository is gated and requires accepting access terms; no access token should be pasted into this chat. The source repo has no separate LICENSE file, although the model card declares MIT and the model author has affirmed commercial use. Dataset/code provenance and CPU dependencies still need review; do not include it in a recommendation until these checks are complete. Neither IndicF5 nor a Telugu adapter currently has an internal CatGPT service implementation.

If/when a bake-off selects a model, a single model-loaded Python process behind a private authenticated-network boundary is the likely serving shape; no service is added in this phase.

## Phase gate

Do not start database or application work until the CPU benchmark, license audit, and tested Telugu/Hindi support are complete. The user authorized automatic continuation after a successful Phase 1 recommendation, so proceed to Phase 2 only if a candidate meets the required languages and its commercial/license chain is clear; stop and ask if gated access or any license/provenance remains unresolved. VoxCPM2 does not list Telugu and is not a candidate for the required Telugu output.
