# Voice model recommendation

Status: **Chatterbox Telugu fine-tune selected for the app integration** — the only candidate verified end-to-end on CPU for Telugu + Hindi. **Caveat:** synthesis is measured with the adapter's built-in `conds.pt` conditioning, not the user's voice. Speaker similarity remains unverified until the user supplies their consented 20–30 s Telugu recording + exact transcript; run `run_benchmark.py chatterbox_telugu --reference-audio … --reference-transcript-file …` then.

## Why this candidate

- **Only verified Telugu path.** OpenVoice V2 has no Telugu/Hindi MeloTTS base; base Chatterbox V3's language list omits `te`. The `shankarpandala/chatterbox-telugu` adapter (rev `d4341468…`) adds the `te` language token plus a 2,521-token vocab, and produced non-silent Telugu, Hindi and English WAVs on CPU.
- **CPU-feasible.** Cold load ~25–68 s once per process, ~0.9–1.7 GiB resident, peak ~2.2–2.4 GiB while generating. Synthesis runs ~17–27× real-time on a 12-thread CPU — a ~4 s clip takes ~70–110 s.
- **License posture usable with attribution.** Chatterbox code + base weights MIT; Telugu adapter CC-BY-4.0 → ship an attribution notice. `pykakasi` (GPL-3.0) is only needed for Japanese text normalization — omit it from a minimal production runtime or accept GPL review.
- **Private HTTP service is straightforward.** One warm Python process behind the Node API (`infra/voice-service/`), reference audio + text in, WAV out, no transcript needed at synthesis time, `language_id` selects the output language.

## Operational consequences

- Synchronous `/brands/:id/voice/speak` is justified: one inference slot, 240 s timeout, 6 req/min cap. Typical single-sentence latency ~30–110 s — the UI must be honest about that wait.
- **Kill Bill per-sentence cloning is technically wired but likely impractical on CPU** (~1–2 min per sentence chunk). It falls back to the fixed `/voice/speak` automatically on failure; consider keeping Kill Bill on the fast default voice unless the service runs on a GPU/bigger CPU.
- IndicF5 (also te+hi, likely different latency profile) stays conditional on gated access + license audit. Fish Speech remains excluded. VoxCPM2 was not worth testing further — no verified Telugu.

## Still required before calling voice cloning "done"

1. User's own Telugu WAV (20–30 s) + exact transcript → similarity/intelligibility check.
2. Human listening review of the three probe WAVs.
3. Legal sign-off on CC-BY-4.0 attribution text + `pykakasi` omission.