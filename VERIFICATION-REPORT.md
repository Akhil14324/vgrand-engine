# Brand Voice Cloning — Verification Report

Verification date: 2026-09-25. This is a verification report, not a claim that every acceptance item passed. Live HTTP tests used the local API at `http://127.0.0.1:4000`, the internal model service at `http://127.0.0.1:8765`, real JWTs issued by the configured remote Supabase project for two test identities, prepared synthetic WAV references, the local PostgreSQL database, and the remote project's private Supabase Storage bucket. No real person's voice was used. Test outputs below are measured observations; code review and human-only checks are labeled separately.

## 1. REQUIREMENTS TRACEABILITY

- **PASS — Self-hosted model only.** Searched the feature code and working diff for `api.fish.audio`, `FISH_AUDIO`, and Fish Audio API-key naming; no matches. Command: `grep -RinE 'api\.fish\.audio|FISH_AUDIO|fish[_-]?audio[_-]?(api[_-]?)?key' apps/api/src apps/web packages infra/voice-service infra/voice-bakeoff --exclude-dir=.local --exclude-dir=.venv-chatterbox; test $? -eq 1` → no output, exit 0. Service uses local Chatterbox; `infra/voice-service/server.py:140-218` accepts an audio/text/language request and runs inference locally.

- **FAIL — Runtime model revision is not reported.** Recommended candidate in `infra/voice-bakeoff/RECOMMENDATION.md:3,7` is the Chatterbox Telugu adapter. Exact pins: source code `resemble-ai/chatterbox` revision `5de7a54aa4e5e2baadb0182dde554908b48b85c2`, weight repo `shankarpandala/chatterbox-telugu` revision `d4341468c1738ea669ef096baccecc68cc8ba9f3` (`infra/voice-bakeoff/run_benchmark.py:24-36`; `infra/voice-bakeoff/LICENSES.md:25-27`). The service defaults to that repo/revision and loads with `device="cpu"` (`infra/voice-service/server.py:44-46,84-96`); its current environment had no `CHATTERBOX_REPO`, `CHATTERBOX_REVISION`, or `CHATTERBOX_T3_MODEL` override. Live `GET /health` returned `{"status":"ok","model_loaded":true,"load_error":null,"sample_rate":24000,"languages":[...,"hi",...,"te",...]}`. However, `/health` does **not** return repo, revision, checkpoint hash, or loaded artifact path. Thus the configured default is pinned, but the strict requested proof that the *running service reports/matches* the exact revision is not available from the running service. No revision endpoint was added in this verification pass.

- **PASS — One voice per brand and replacement.** `packages/db/prisma/schema.prisma:70-74` defines `BrandVoice.brandId String @unique` and a cascading Brand FK. `pnpm --filter @catgpt/db exec prisma migrate status` → `12 migrations found; Database schema is up to date.` Live first upload: `HTTP 201`, voice id prefix `4902183e`; second `POST /brands/:id/voice` to the same brand: `HTTP 200`, same voice id prefix `4902183e`. Another real run likewise returned `201 id=ed6f6791…` then `200 id=ed6f6791…`. The route uses Prisma `upsert` on `brandId` (`apps/api/src/routes/brand-voice.ts:226-269`).

- **PASS — Owner-only management via direct API.** Two distinct Supabase-authenticated test users were used. For user B calling user A's brand directly: `GET voice → 404`, `POST voice → 404`, `POST speak → 404`, `DELETE voice → 404`, and `GET sample → 404`. A workspace member could `GET /brands/:id → 200` but `GET /brands/:id/voice → 404`. The routes call `findManageableBrand` before voice access (`apps/api/src/routes/brand-voice.ts:190-213,226,332-334,351-354,374-376`); manageable policy is in `apps/api/src/lib/brand.ts` (the helper checks personal ownership/workspace ownership, not mere accessible membership). Missing and unauthorized brands share 404 behavior.

- **PASS — Enrollment and output languages include Telugu, Hindi, and English.** `BRAND_VOICE_SCRIPTS` keys are now `te`, `hi`, `en` (`apps/api/src/lib/brand.ts:20-34`). After adding the English script, a live owner-authenticated `GET /brands/:id/voice/script?language=en` returned `200`, 350 characters beginning `Hello! This is my own voice...`; existing live te/hi probes and synthesis are documented above. The adapter runtime reports `en`, `hi`, `te`; the bake-off produced a non-silent English probe. This proves the language route/model path, not English speaker-similarity quality from an English reference.

- **PASS (service-level) — Same Telugu reference synthesized Telugu, English, and Hindi.** Direct internal-service requests using the same generated Telugu reference WAV returned HTTP 200 for `te` (81.39 s, 44,204 bytes), `en` (63.10 s, 71,084 bytes), and `hi` (29.24 s, 49,964 bytes). All output WAVs were 24 kHz and non-silent (RMS 0.1823, 0.1581, and 0.1885 respectively). The live API path reads the same saved `voice.storageKey` and forwards the requested `language` (`apps/api/src/routes/brand-voice.ts:374-456`). This validates language switching while keeping the same conditioning input; it does not establish that the synthetic reference sounds like the user's voice. The Read Aloud browser click itself still needs human verification.

- **PASS — Consent cannot be omitted or set false.** Direct multipart upload with omitted `consent` → `400 {"message":"explicit consent is required to save a voice"}`; `consent=false` → `400`. A successful test upload returned `201`. Direct database query on that saved row returned `consentType=authorized_voice`, `timestamp_stored=t`, `actor_stored=t`; route sets `consentType`, `consentedAt`, and `attestedById=req.userId` (`apps/api/src/routes/brand-voice.ts:244-258,290-315`). UI initializes consent to false and disables record until checked (`apps/web/components/voice-section.tsx:104-109,346-380`).

- **FAIL — Consent metadata is exposed in the client DTO.** This violates the prior privacy boundary that consent data should not be returned to clients. The actual upload DTO keys included `consentType`, `consentedAt`, and `attestedById` (as well as normal voice metadata). `toBrandVoiceDto` explicitly serializes them (`apps/api/src/routes/brand-voice.ts:69-100`; duplicate mapper in `apps/api/src/lib/brand.ts:49-66`). They are correctly stored in the DB, but should not be in the client DTO. Not changed in this verification pass.

- **PASS — Private recording storage is separate from public image storage.** A programmatic comparison of the `storeImage` function and `storeFile` alias against `HEAD` returned `storeImage identical: True` and `storeFile alias identical: True`; `git diff apps/api/src/services/storage.ts` shows the existing public store body unchanged, with only the import list extended and private helpers appended. Local API test: guessed `/uploads/brand-voices/...` → `404`; traversal attempt → `403`. Storage bucket API reports `brand-voice-samples` with `public:false`. For a test-saved object, a constructed Supabase `/object/public/brand-voice-samples/...` URL returned `400`. The upload response had no `storageKey`, signed URL, filesystem path, public URL, or sample bytes. Private key creation/read/delete are server-side only (`apps/api/src/services/storage.ts` additions; use sites in `apps/api/src/routes/brand-voice.ts:279-280,332-344,445-456`).

- **PASS — Raw sample playback uses the authenticated sample endpoint.** Search for `readPrivateObject` in API source found the raw read in `GET /brands/:id/voice/sample` and the internal server-to-model-service synthesis read; no other client playback route was found. Direct requests to `GET /brands/:id/voice/sample`: no bearer token → `401`; owner → `200 audio/wav`, 345,644 bytes, `Cache-Control: private, no-store`; unrelated user/workspace member → `404`. Route: `apps/api/src/routes/brand-voice.ts:332-344`.

- **PASS — Voice delete and brand cascade delete remove storage objects, not only rows.** Owner `DELETE /brands/:id/voice` → `204`; subsequent owner `GET /brands/:id/voice` → `200 {"voice":null,...}`; direct private bucket list for that brand prefix → `200 []`. Separately, created a test workspace brand, uploaded a voice (`201`), confirmed private object list count `1`, attempted direct public URL (`400`), deleted the brand (`204`), then directly listed the exact private bucket prefix → `200 []`. Brand cleanup is in `apps/api/src/routes/brands.ts:125-146`; voice deletion in `apps/api/src/routes/brand-voice.ts:351-368`.

- **FAIL — Raw internal model exception detail was observed in service logs during a failed synthesis attempt.** Before the retry adjustment noted in §6, Uvicorn logged `ERROR:chatterbox.models.s3gen.flow:7940.0>6561` and an `IndexError: index out of range in self` traceback. The Node API response and persisted `lastSynthesisError` were sanitized, but this shows internal service logs can contain model exception detail. Current service retries this specific `IndexError` up to three times (`infra/voice-service/server.py:186-200`); other uncaught exception logging has not been exhaustively tested. No sample bytes, storage key, or user text appeared in the captured traceback.

## 2. MULTI-USER / MULTI-BRAND ISOLATION

Two distinct Supabase users each had a brand and a sample uploaded directly through the API. The references were synthetic WAVs generated locally by the model; this verifies object/brand isolation, not identity or human-speaker likeness.

- **PASS — User A cannot operate on User B's voice by guessing the brand ID.** Direct requests from the non-owner returned `GET voice=404`, `POST voice=404`, `POST speak=404`, `DELETE voice=404`, `GET sample=404`. Workspace-member brand access returned `200` while voice retrieval returned `404`. Evidence and route lines are in §1 owner-only result.

- **PASS — Different brand reference samples produced structurally different output.** Same Telugu test text/language: SHA-256 prefixes from the returned WAV bytes were `A=a763d65a47a32752`, `B=0ad0ff543e345cf8`; both synthesis calls returned audio. This is only a byte-level distinction, not proof of speaker similarity or perceived quality.

- **PASS after queue change — Concurrent cross-brand requests both succeed without cross-talk.** The earlier unqueued test returned `A→200, B→429`. Added a FIFO with one active synthesis, four queued slots, and a 240 s queue-wait bound (`apps/api/src/routes/brand-voice.ts:31-74,418-497`). Retest used separate synthetic references for users A/B and simultaneous Telugu/English requests: A→`200 MISS`, 35.30 s, 97,964 bytes, SHA prefix `480b20e4411f8efe`; B→`200 MISS`, 59.82 s, 92,204 bytes, SHA prefix `08f8c0fb51340ef8`; the hashes differ and both returned WAVs. Both saved samples were deleted (`204` each), as was the temporary B brand (`204`). The queue is bounded; when all four waiting slots are full or a request waits over 240 s, an error can still occur and the client fallback remains active.

## 3. FAILURE / FALLBACK BEHAVIOR (per-surface decision)

- **PASS (code and service-level language test) — A Telugu recording remains the speaker conditioning reference across output languages.** Read Aloud prefers the generation's stored brand; if older/brandless output has no `metadata.brandId`, it uses the currently active/default brand selection (an explicit brand-mode OFF still selects none). It waits for brand/voice metadata before enabling the button. It counts Telugu, Devanagari, and Latin script characters, validates the chosen `te`/`hi`/`en` language against server-provided `speakLanguages`, and sends that code (`apps/web/components/generation-actions.tsx:252-261,349-384,469-470`). The API independently loads the same brand's stored reference and forwards it with the requested output language (`apps/api/src/routes/brand-voice.ts:374-456`). Using one synthetic Telugu reference, live self-hosted synthesis returned 200 for all three codes (details in §1). This validates the path, not real-speaker likeness.
- **PASS (code) — Removed the extra six-speak/minute route cap that could make Read Aloud fall back after repeated requests.** The global per-user API limiter is 120 requests/minute (`apps/api/src/app.ts:63-70`); synthesis is serialized but now queues up to four requests rather than rejecting the second immediately (`apps/api/src/routes/brand-voice.ts:31-74,418-497`). A rapid no-voice test against an owned brand returned seven consecutive 404s, not a per-route 429; it does not prove a saved-voice browser session.
- **NEEDS-HUMAN — The exact screenshot failure is not confirmed without an authenticated browser/network trace.** A failed cloned API request still falls back to browser speech and shows “default voice” (`generation-actions.tsx:395-402,493-495`). A successful fetch now caches the Blob locally; playback calls `audio.play()` and handles rejection instead of leaving `speaking=true`. If autoplay is blocked, the UI says the saved brand audio is ready to replay, and the next click replays the in-memory Blob synchronously (`:312-345,367-394,496-500`). Successful playback shows “brand voice” (`:339-341,490-492`). The screenshot's exact click/response/autoplay outcome remains unverified; please check the authenticated browser after this change.

- **PASS — API records a sanitized failure and the stored sample remains usable.** Stopped the model-service listener while user A had a ready saved voice. `POST /brands/:id/voice/speak` returned `503 {"statusCode":503,"error":"HttpError","message":"voice synthesis failed"}`. Owner voice DTO after failure showed `status=ready`, `lastSynthesisError="voice service unavailable"`, and a timestamp. This is appropriate: the sample row remains ready; the last synthesis failure is separately recorded. `recordSynthesisFailure` writes a fixed string (`apps/api/src/routes/brand-voice.ts:153-159,457-490`).

- **NEEDS-HUMAN — Read Text shows a visible error and permits retry without default-voice substitution.** Code catches failure into `speakError` (`apps/web/components/voice-section.tsx:230-252`) and renders the error (`:470-472`); Speak remains available after the failed request. No browser was driven, so actual visibility/click-to-retry was not rendered or verified.

- **NEEDS-HUMAN — Chat Read Aloud fallback and success labels need rendered confirmation.** Success sets a short-lived `brand voice` indicator; failure sets `default voice` and calls browser `speechSynthesis` (`apps/web/components/generation-actions.tsx:329-354,442-447`). No authenticated browser test of these rendered states was performed.

- **NEEDS-HUMAN — Kill Bill quietly falls back to `/voice/speak`.** Code selects cloned synthesis only when the selected brand matches and catches failure to call the existing fixed endpoint (`apps/web/components/kill-bill.tsx:135-151`). No microphone/conversation UI session was run; continuity and audio playback need human confirmation.

- **NEEDS-HUMAN — Failure indicator rendered in Brand settings.** The owner DTO after failure contained the sanitized `lastSynthesisError`; Brand settings renders it at `apps/web/components/voice-section.tsx:312-315`. The actual rendered state after a failure was not checked in a browser. Refresh/requery is required to see server-updated state; live query invalidation after failure was not verified.

- **PASS — API recovery without restarting the API.** Restarted only the internal model service. A subsequent API `/speak` returned `200 audio/wav` in 97.7 s; the voice row then returned `lastSynthesisError=null`. This verifies API-level recovery. **NEEDS-HUMAN** for confirming the three UI surfaces recover without browser reload/manual intervention.

## 4. REGRESSION — behavior with no saved voice

- **PASS (source diff) — Existing `/voice/speak` and `/voice/transcribe` implementation is unchanged.** `git diff -- apps/api/src/routes/voice.ts` produced empty output. No pre-feature captured response was available; these endpoints were compared at source level rather than baseline-response level.

- **NEEDS-HUMAN — Read Aloud selection for old/brandless generations needs a browser click-through.** It prefers `generation.metadata.brandId`; if absent it resolves the currently active/default brand from `useBrandMode`. With no active brand (including explicit Brand-mode OFF), it uses browser `speechSynthesis`; with an active brand it tries that owner's saved voice (`apps/web/components/generation-actions.tsx:250-259,295-358`). This intentionally makes the active brand voice available on older replies; no browser network trace was captured.

- **NEEDS-HUMAN — Kill Bill default voice remains unchanged without a saved selected-brand voice.** The code chooses the cloned path only when a ready voice for the selected brand is present, otherwise `fixed()` calls `/voice/speak` (`apps/web/components/kill-bill.tsx:137-150`). No no-voice real conversation was run.

- **NEEDS-HUMAN — Brand assets/documents and visual behavior.** `brand-view.tsx` diff adds `VoiceSection` between existing `AssetsSection` and `DocumentsSection`, plus a safe-area wrapper class change; their section implementations were not edited. No browser spot-check was performed, so visual/functionality is not asserted. Chat history/image-generation service files have no diff, but no end-to-end image-generation or chat-persistence regression run was performed.

## 5. THINGS THAT CANNOT BE MECHANICALLY VERIFIED — NEEDS-HUMAN FOLLOW-UPS

- **NEEDS-HUMAN — Recheck the screenshot's Telugu Read Aloud path.** With the saved voice's brand active, open a Telugu generation (also test an older reply whose metadata lacks `brandId`) and click Read aloud. Confirm a `POST /brands/:id/voice/speak` succeeds, the temporary `brand voice` label appears, and audio plays. If the browser blocks the delayed first play, confirm the “Saved brand audio is ready” prompt appears and the next click plays it. If it still shows “default voice,” report only the request status/response message from DevTools; do not share authorization headers or tokens.
- **NEEDS-HUMAN — Real in-browser recording flow.** Use HTTPS on a real phone/browser; open an owner-managed Brand → Brand voice, select Telugu, Hindi, or English, check consent, tap Start recording, accept the microphone prompt, read the displayed script, Stop, preview the audio, Save, then reload and use Hear sample. Repeat in iOS Safari and Android Chrome; verify MIME fallback, permission-denied message, object-URL cleanup, replace and delete.
- **NEEDS-HUMAN — Speaker similarity and subjective audio quality.** The reference files were synthetic TTS, not a user's voice. Hash/waveform differences only prove different bytes. Record a consented 20–30-second voice sample with exact transcript, play source and cloned Telugu/Hindi outputs, and assess similarity, intelligibility, pronunciation, stability, and unintended repetition. Do not claim equivalence to Fish Audio's hosted product or its larger cloud-only models; no such comparison was run, and Fish S1-mini is not commercially cleared here.
- **NEEDS-HUMAN — Failure/recovery behavior on actual UI surfaces.** With a saved test voice, stop the private model service. Try Brand Read Text and confirm visible error + retry without default playback; try chat Read aloud and confirm browser voice + visible default-voice note; try Kill Bill and confirm `/voice/speak` fallback with conversation continuing. Restart the service and verify each surface recovers without restarting API or reloading the app.
- **NEEDS-HUMAN — Latency feel.** Time raw results are reported in §6; have a person assess whether waiting ~90–136 seconds for a cold short sentence and ~90 seconds for a warm API-level request is acceptable for Read Text and Kill Bill.
- **NEEDS-HUMAN — Regression click-through.** Test a brandless chat, a brand with no saved voice, and an owner brand with voice; verify browser TTS/default Kill Bill behavior, then check Brand assets/documents, chat persistence, and image generation visually and functionally.
- **NEEDS-HUMAN — Cross-language voice quality.** Enrollment and output routes now offer Telugu, Hindi, and English; Read Aloud chooses output language from the reply's writing system. Listen to one saved reference used to synthesize each of the three languages and assess pronunciation, intelligibility, and speaker similarity. English was model-probed but has not had a real English enrollment sample/human quality review.

## 6. PROCESS CHECKS

- **PASS — `pnpm typecheck` (full output):**
  ```text
  > catgpt@0.1.0 typecheck C:\Users\kiran\OneDrive\Desktop\PromptHub
  > turbo typecheck

  • turbo 2.11.3
  • Packages in scope: @catgpt/api, @catgpt/config, @catgpt/db, @catgpt/image-providers, @catgpt/types, @catgpt/web
  • Running typecheck in 6 packages
  • Remote caching disabled
  @catgpt/types:typecheck: cache miss, executing 026093066432f831
  @catgpt/db:typecheck: cache miss, executing 9b7f969e731a57d0
  @catgpt/image-providers:typecheck: cache miss, executing 1c6316f5f0bd9c6b
  @catgpt/web:typecheck: cache miss, executing a0d62da36d35d1ac
  @catgpt/api:typecheck: cache miss, executing d90fbd51afcb2ce0
  @catgpt/db:typecheck:
  @catgpt/db:typecheck: > @catgpt/db@0.1.0 typecheck C:\Users\kiran\OneDrive\Desktop\PromptHub\packages\db
  @catgpt/db:typecheck: > tsc --noEmit
  @catgpt/db:typecheck:
  @catgpt/web:typecheck:
  @catgpt/web:typecheck: > @catgpt/web@0.1.0 typecheck C:\Users\kiran\OneDrive\Desktop\PromptHub\apps\web
  @catgpt/web:typecheck: > tsc --noEmit
  @catgpt/web:typecheck:
  @catgpt/types:typecheck:
  @catgpt/types:typecheck: > @catgpt/types@0.1.0 typecheck C:\Users\kiran\OneDrive\Desktop\PromptHub\packages\types
  @catgpt/types:typecheck: > tsc --noEmit
  @catgpt/types:typecheck:
  @catgpt/api:typecheck:
  @catgpt/api:typecheck: > @catgpt/api@0.1.0 typecheck C:\Users\kiran\OneDrive\Desktop\PromptHub\apps\api
  @catgpt/api:typecheck: > tsc --noEmit
  @catgpt/api:typecheck:
  @catgpt/image-providers:typecheck:
  @catgpt/image-providers:typecheck: > @catgpt/image-providers@0.1.0 typecheck C:\Users\kiran\OneDrive\Desktop\PromptHub\packages\image-providers
  @catgpt/image-providers:typecheck: > tsc --noEmit
  @catgpt/image-providers:typecheck:

  Tasks:    5 successful, 5 total
  Cached:    0 cached, 5 total
  Time:    10.485s
  ```

- **FAIL (resolved by sequential rerun) — Initial parallel `pnpm typecheck` + `pnpm build` overlap.** `@catgpt/web:typecheck` failed with TS6053 for generated `apps/web/.next/types/app/layout.ts`, `app/page.ts`, `cache-life.d.ts`, and `validator.ts` while Next build regenerated `.next/types`. Running `pnpm typecheck` again after the build finished passed 5/5 tasks (full successful output above). This was a build/typecheck file-generation race, not a source type error.
- **FAIL (fixed) — First dynamic-language guard typecheck.** `generation-actions.tsx:316` reported `TS2345: Argument of type 'string' is not assignable to parameter of type 'never'` for the server-reported language array. Added an explicit `string[]` type and reran `pnpm typecheck`; final run passed 5/5 tasks.

- **FAIL — `pnpm lint` is a no-op, not a lint pass.** Full output:
  ```text
  > catgpt@0.1.0 lint C:\Users\kiran\OneDrive\Desktop\PromptHub
  > turbo lint
  • turbo 2.11.3
  • Packages in scope: @catgpt/api, @catgpt/config, @catgpt/db, @catgpt/image-providers, @catgpt/types, @catgpt/web
  • Running lint in 6 packages
  • Remote caching disabled
  WARNING No tasks were executed as part of this run.
  Tasks: 0 successful, 0 total
  Cached: 0 cached, 0 total
  Time: 1.883s
  ```

- **FAIL — `pnpm --filter @catgpt/api test` runs zero tests.** Command output was empty and shell printed `exit=0`; this is not a pass. `apps/api/package.json:6-10` defines only `dev`, `worker`, `start`, and `typecheck`; there is no API test script, no Vitest setup, and no Phase 3 automated test suite. No framework was installed. A temporary API-level verification harness was used for live requests and then removed; it was not a test framework or committed test suite.

- **PASS — `pnpm build`.** `turbo build`: `@catgpt/web` / Next.js 15.5.26 compiled successfully, type checking passed, static generation completed for all 10 pages, `Tasks: 1 successful, 1 total`. Routes included `/`, `/brand`, `/login`, `/workspaces`, and share/join routes.

- **PASS — Migration status.** `pnpm --filter @catgpt/db exec prisma migrate status` reported 12 migrations and `Database schema is up to date!`; only Prisma's existing `package.json#prisma` deprecation warning was emitted.

- **PASS — `git diff --check`.** Exit 0. Git emitted only working-copy LF-to-CRLF warnings for `packages/image-providers/src/flux.ts` and `ideogram.ts`; neither file was changed for voice handling.

- **PASS — Recovered localhost web assets and prevented the dev/build output collision.** Before restart, direct checks returned `GET /`=200, `/_next/static/chunks/main-app.js`=404, and `app-pages-internals.js`=404; the browser console also reported `layout.css`=404. Cause: both Next dev and production build were writing to `.next`; a build while dev stayed running left the dev process with stale asset manifests (`apps/web/package.json:6-10`). `next.config.ts` now uses `.next` for development and `.next-production` for production; `turbo.json` tracks the production output, `.gitignore` ignores it, and dev `PwaRegister` unregisters stale service workers and clears CatGPT caches. Restarted only the web dev server; API stayed running. After a fresh production build, `localhost:3000/` and every referenced dev chunk/css returned 200. A temporary `next start -p 3001` production server also served `/` and all referenced hashed assets with HTTP 200, then was stopped. The fix leaves unrelated working-tree changes untouched.

- **PASS — Changed-file audit (current `git status --short`; no commit/push; scope caveats listed below):**

  Modified tracked files:
  ```text
  .gitignore
  apps/api/.env.example
  apps/api/src/app.ts
  apps/api/src/env.ts
  apps/api/src/lib/brand.ts
  apps/api/src/routes/brands.ts
  apps/api/src/services/storage.ts
  apps/web/app/globals.css
  apps/web/components/brand-view.tsx
  apps/web/components/generation-actions.tsx
  apps/web/components/kill-bill.tsx
  apps/web/components/pwa.tsx
  apps/web/components/studio-shell.tsx
  apps/web/lib/hooks.ts
  apps/web/next-env.d.ts
  apps/web/next.config.ts
  apps/web/tsconfig.json
  packages/db/prisma/schema.prisma
  packages/types/src/index.ts
  turbo.json
  ```

  Other modified tracked paths visible in the final status, not edited during the Read Aloud fix:
  ```text
  apps/api/src/routes/generations.ts
  apps/api/src/services/campaign.ts
  apps/api/src/services/chat.ts
  apps/api/src/services/generation-worker.ts
  apps/web/components/chat-turn.tsx
  apps/web/components/splash.tsx
  packages/image-providers/src/flux.ts
  packages/image-providers/src/ideogram.ts
  packages/image-providers/src/openai.ts
  ```

  New untracked feature/report files:
  ```text
  VERIFICATION-REPORT.md
  apps/api/src/routes/brand-voice.ts
  apps/web/components/voice-section.tsx
  infra/voice-bakeoff/.gitignore
  infra/voice-bakeoff/BENCHMARK.md
  infra/voice-bakeoff/LICENSES.md
  infra/voice-bakeoff/README.md
  infra/voice-bakeoff/preflight_model.py
  infra/voice-bakeoff/preflight_openvoice.py
  infra/voice-bakeoff/requirements-chatterbox-lock.txt
  infra/voice-bakeoff/requirements-chatterbox.txt
  infra/voice-bakeoff/requirements-openvoice-lock.txt
  infra/voice-bakeoff/requirements-openvoice.txt
  infra/voice-bakeoff/run_benchmark.py
  infra/voice-bakeoff/synthesis_probe.py
  infra/voice-bakeoff/RECOMMENDATION.md
  infra/voice-service/.gitignore
  infra/voice-service/README.md
  infra/voice-service/requirements.txt
  infra/voice-service/server.py
  packages/db/prisma/migrations/20260925111517_brand_voice/migration.sql
  ```

  `nul` is also untracked but was already present before this verification and was not touched. `.local` model/audio artifacts are ignored under `infra/voice-bakeoff/.gitignore`; no checkpoints or generated samples appear in `git status`. `apps/api/.env` is ignored/local and contains the local voice-service URL; because it is not tracked, no git diff can establish its original contents. The nine additional tracked paths listed above were present in the final status but were not edited during the Next.js asset fix; their existing diffs were left untouched. No additional untracked paths beyond those listed appeared in the status output. Two test Auth users (`verify-a@voice-test.local`, `verify-b@voice-test.local`) were created in the configured **remote Supabase project** and remain there; direct admin API lookup confirmed both exist. No account deletion was performed. Test brand/workspace scaffolding remains in local PostgreSQL (2 test brands; 0 remaining `BrandVoice` rows for those test users). All synthetic voice rows created by this run were deleted via the voice DELETE route; exact object prefix returned `[]`. A separate remaining private-bucket prefix maps to an existing non-test `Infra` brand; it was not touched. No real person's sample was uploaded.

  Scope assessment: API routes/types/schema/storage, service, UI/hooks/integrations, and benchmark assets are feature-related. Safe-area changes in `globals.css`, `studio-shell.tsx`, and the `brand-view.tsx` wrapper, and recorder MIME handling in Kill Bill are mobile-support changes made during this feature work; they are related but not required for core server-side synthesis. `app.ts` contains the route import/registration needed to mount the new API routes. A duplicate route registration was encountered while starting the API and removed before the successful live run.

### Integration measurements, licensing, and operational limits

- **PASS — Measured integration CPU result (not Phase 1 data):** runtime command checked `torch==2.6.0+cpu`; `torch.cuda.is_available()` returned `False`; service instantiates the model with `device="cpu"` (`server.py:95-96`). Fresh service process, one reference WAV, Telugu request: HTTP `200`, `audio/wav`, 76,844 response bytes, direct `/synthesize` wall time **135.79 s**, service `X-Synthesis-Seconds: 85.36`. Process memory sampled with `psutil`: pre-request service RSS **457.8 MiB** (model unloaded), sampled RSS peak **3,507.6 MiB**, post-request warm idle RSS **2,227.0 MiB**; virtual memory was **2,151.8 MiB** before request, **9,159.2 MiB** peak, **6,440.3 MiB** post-request. `/health` confirmed `model_loaded:true` afterward. The model-load completion time could not be separated: this implementation performs synchronous lazy loading inside synthesis, and health polling did not observe the transition while that event loop was blocked. Do **not** treat `135.79 - 85.36` as a precise load time. API-level integration measured a warm request at **91.3 s** and a post-service-restart recovery request at **97.7 s**. A separate warm direct-service sample previously returned in **34.63 s**. References are synthetic, so these do not establish user-voice quality.
- **PASS — Read Text now saves and reuses private generated audio.** Real API test with the same brand, voice, Telugu text, and language: first request `200`, `X-Voice-Cache: MISS`, `53.201 s`, 128,684 bytes, SHA-256 prefix `a3ad616a3b456074`; second request `200`, `X-Voice-Cache: HIT`, `0.188 s`, same byte length and SHA-256. Private bucket prefix contained exactly one cached object. This is about 283× faster on the repeat in this single measured run; it is not a claim that new text generates 283× faster. Replacing the voice returned `200` and cleared the cache prefix to count 0; deleting the voice returned `204` and both sample and cache prefixes were empty. Cache objects are private under `brand-voice-cache/<brandId>/<sha256>.wav`; the digest covers voice row/sample identity, language, and trimmed text, not plaintext (`apps/api/src/routes/brand-voice.ts:347-368,412-429`). Owner authorization occurs before cache lookup (`:330-352`). Replace/delete and brand-delete paths clear the brand's cached objects (`:234-240,311-318`; `apps/api/src/routes/brands.ts:122-143`); the storage helper only lists validated private prefixes and deletes those objects (`apps/api/src/services/storage.ts:227-285`). The browser keeps up to eight recent blobs and changes the button to “Play saved audio” after success (`apps/web/components/voice-section.tsx:232-283,470-503`). Unique text entries remain in private storage until voice replacement/deletion, so bucket use grows with unique requested text.
- **FAIL — Separate cold model-load duration was not measured.** Only the full cold request wall time and the service's post-load `X-Synthesis-Seconds` were captured; health polling could not observe the transition during blocking model load. No Phase 1 load-time figure is reused as a final-integration measurement.

- **NEEDS-HUMAN — Recommendation, not measurement:** one serialized CPU inference worker is the safe current deployment assumption. Measured peak RSS was about 3.5 GiB for the model process alone; allow additional RAM for API, database, OS, and concurrent services. The host benchmark record reports a 12-logical-CPU, 11.7-GiB machine; this run itself did not remeasure machine inventory. At least 8 GiB available to the service host is a prudent deployment target, not a tested minimum.
- **PASS (configuration evidence only) — Operational configuration:** API uses `VOICE_MODEL_URL`, optional `VOICE_SERVICE_TOKEN`, `PRIVATE_STORAGE_BUCKET` (default `brand-voice-samples`), and `PRIVATE_UPLOAD_DIR` (must remain outside public `UPLOAD_DIR`; see `apps/api/.env.example:47-57`). Internal model service defaults to loopback `127.0.0.1:8765`, can require `x-voice-key`, uses `VOICE_SERVICE_THREADS` default 8, and serializes inference (`infra/voice-service/server.py:47-52,64-68,71-73,155-156,221-224`). API limits: global 120 requests/minute per user; one active synthesis plus up to four queued requests (each queue wait capped at 240 s); 240 s model-service timeout; text max 1,500 chars. Uploads are separately capped at 6/minute, 12 MiB, and 6–90 seconds (`apps/api/src/app.ts:63-70`; `apps/api/src/routes/brand-voice.ts:31-74,171-174,215-224,327-330`). Cached speaks no longer have the old route-specific 6/minute cap. A public model-service endpoint is not appropriate; deploy it on a private network/loopback and configure the shared token when crossing process/host boundaries. Do not use `:latest` model tags.
- **NEEDS-HUMAN — License/notice:** Chatterbox pinned source and base weights are MIT; selected third-party Telugu adapter weights are CC-BY-4.0 and require attribution (`infra/voice-bakeoff/LICENSES.md:25-30`). A proposed attribution is “Telugu adapter by shankarpandala, CC BY 4.0”; confirm exact notice with the adapter card before distribution. The attribution has not been added to product UI/docs, so public distribution is not license-ready. `pykakasi` is GPL-3.0-or-later in the candidate environment; it is not needed by the exercised `te`/`hi` path according to the audit, but the full dependency/license audit remains incomplete and warrants legal review or removal from a minimal runtime. Fish Speech/OpenAudio S1-mini remains excluded absent written commercial authorization; no commercial clearance is asserted.

#### Final human click-through follow-ups

1. On HTTPS mobile Safari and Chrome, enroll a real consented voice using the displayed script, preview/save it, reload, hear sample, replace, and delete.
2. Listen to Telugu and Hindi cloned output made from that real recording; judge likeness, pronunciation, intelligibility, and stability without claiming parity with any hosted Fish Audio product.
3. While model service is stopped, exercise Read Text, chat Read aloud, and Kill Bill; then restart the service and confirm each UI surface recovers.
4. Test a brandless chat and no-voice brand; spot-check assets/documents, persisted chat history, and image generation.
5. Decide whether Telugu/Hindi are sufficient or additional languages are essential; assess whether measured CPU wait times feel acceptable.
6. Confirm whether you want the two remote Supabase test Auth users deleted; they were deliberately left intact pending authorization for that destructive remote action.

## Growth-suite implementation checks

- **PASS — Prisma schema and migrations:** `growth_suite` adds `BrandMascot`, `ApprovalLink`, `CampaignPlan`, and `CampaignPost`; `restore_documentchunk_hnsw` recreates the pgvector index that Prisma cannot see on `Unsupported("vector")`. `prisma migrate deploy` applied the follow-up and `prisma migrate status` reports the database up to date with 17 migrations. Direct DB check confirmed `DocumentChunk_embedding_hnsw_idx` exists.
- **PASS — typecheck:** `pnpm typecheck` completed successfully across all 5 packages.
- **PASS — production build:** `pnpm build` completed successfully; Next.js generated the `/approve/[token]` route.
- **PASS — local dev server remained healthy after build:** `http://localhost:3000/` returned 200 and `main-app.js`, `app-pages-internals.js`, and `layout.css` each returned 200.
- **PASS — public approval-link smoke test:** a temporary completed generation + approval token was created directly in the DB; `GET /approvals/:token` returned the pending public payload, `POST /approvals/:token/respond` returned `changes_requested` with reviewer/comment, and the temporary rows were deleted afterward.
- **PASS — route guards:** unauthenticated `GET /generations/:id/approvals` and `GET /campaigns` returned 401; nonexistent public approval token returned 404.
- **NEEDS-HUMAN — real feature flows:** browser UI clicks, mascot generation/selection, inpaint painting, outpainting, approval-link emails/notifications (not implemented), and scheduled image draft generation were not exercised with real authenticated user flows here. Campaign autopilot schedules internal drafts only; it does not publish to social platforms.
