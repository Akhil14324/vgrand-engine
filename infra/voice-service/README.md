# CatGPT voice model service (internal only)

Serves the pinned Chatterbox Telugu adapter (`shankarpandala/chatterbox-telugu`,
rev `d4341468…`) behind a private HTTP API. The Node API (`VOICE_MODEL_URL`)
is the only client — it enforces auth, consent and per-brand ownership.

- CPU-only, `CUDA_VISIBLE_DEVICES=""`, lazy model load on first request.
- One inference at a time (returns 429 while busy).
- `GET /health`, `POST /probe` (sample validation), `POST /synthesize`
  (multipart: `file` = 16-bit PCM WAV reference, `text`, `language` → WAV).
- Optional shared-secret header `x-voice-key` via `VOICE_SERVICE_TOKEN`.
- Conditionals (voice embeddings) are cached in memory keyed by the sample's
  SHA-256 — samples never hit logs and responses never include storage keys.

## Run locally

```powershell
# Reuse the bake-off venv (chatterbox, torch-cpu, soundfile all pinned):
.\infra\voice-bakeoff\.venv-chatterbox\Scripts\pip.exe install -r infra\voice-service\requirements.txt

$env:VOICE_SERVICE_TOKEN = "dev-secret"
.\infra\voice-bakeoff\.venv-chatterbox\Scripts\python.exe infra\voice-service\server.py
# -> http://127.0.0.1:8765  (set VOICE_MODEL_URL=http://127.0.0.1:8765 on the API)
```

Checkpoint pins come from `infra/voice-bakeoff/run_benchmark.py` (`PINS`).
Do not expose this port publicly — it has no user-level auth of its own.
