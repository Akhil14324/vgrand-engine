# Shorts Factory — decisions log

Module that runs 10 YouTube Shorts channels as a format experiment, built inside
this repo (CatGPT / "Brand Engine"). Each entry says what was decided and why.
Newest phase last.

## Phase 1 — Audit: how the module fits the existing app

**Stack found.** pnpm + Turborepo monorepo, Node 22. API: Fastify 5 (ESM, run
with `tsx`, no build step), Prisma 6 on Postgres (pgvector), optional Redis
(BullMQ). Web: Next.js 15 App Router + Tailwind + React Query + Zustand. Auth:
Supabase JWT (`app.authenticate` preHandler), every row scoped per user. Tests:
vitest in `apps/api`, colocated `*.test.ts`, pure `*-logic.ts` modules.

**Existing pieces reused (not duplicated):**

| Need | Reused from |
| --- | --- |
| ffmpeg process runner, `ffmpeg -i` parser | `services/social/media/video.ts` (`run`, `parseFfmpegInfo`) |
| AES-256-GCM token encryption | `lib/social-crypto.ts` (generalised to take a key) |
| Google OAuth URL / token-refresh shape | `services/social/oauth/google.ts`, `services/social/tokens.ts` patterns |
| Resumable YouTube upload (probe + resume) | logic modelled on `services/social/adapters/youtube.ts` |
| Path C clip providers (Veo / Runway / Kling request + response shapes) | `services/video-gen/providers.ts` (now takes an explicit API key) |
| Error handling, zod body parsing | `lib/errors.ts` (`HttpError`, `parseBody`) |
| UI kit | `components/ui/*`, `CampShell`-style page layout, React Query hooks |

**Where the code lives.**

- DB: new Prisma models prefixed `Shorts*` (mapped to `shorts_*` tables) in
  `packages/db/prisma/schema.prisma` + one migration.
- Shared DTOs, zod schemas, channel seed list, pipeline state machine:
  `packages/types/src/shorts.ts` (the repo keeps shared rules in `@catgpt/types`).
- API: `apps/api/src/services/shorts/*` (pure `*-logic.ts` + IO modules),
  `apps/api/src/routes/shorts.ts`, CLI `apps/api/src/shorts-cli.ts`.
- Web: `apps/web/app/shorts/*`, `apps/web/components/shorts/*`,
  `apps/web/lib/shorts-hooks.ts`, one sidebar entry.

**Ownership.** The app is multi-user. Shorts channels belong to the user who
opens the Shorts page; the 10 channels are seeded for that user on first visit
(idempotent upsert by `(userId, slug)`). `prisma/seed.ts` can't seed them because
it doesn't know which Supabase user is the owner. The CLI takes `--user <email>`
(or uses the only user that owns Shorts channels).

**Job queue: Postgres-backed, not BullMQ.** The spec needs a persistent queue
with retries and idempotency so a crash never double-generates or double-posts.
The repo's BullMQ path only exists when `REDIS_URL` is set (otherwise jobs are
fire-and-forget in process and lost on crash) and its generation queue uses
`attempts: 1`. So Shorts uses its own `ShortsJob` table:

- `idempotencyKey` is UNIQUE — enqueueing the same step twice is a no-op.
- Workers claim with `FOR UPDATE SKIP LOCKED` and a lease (`lockedUntil`); a
  crashed worker's lease expires and the job is re-claimed.
- Retries with exponential backoff, `maxAttempts`, then `dead`.
- Every step is itself idempotent: video status moves with conditional updates
  (`UPDATE … WHERE status = <expected>`), and the upload step persists the
  resumable session URI before sending bytes and never re-uploads a video that
  already has a `youtubeVideoId`.
It works identically with or without Redis, and runs wherever the generation
worker runs (inline in the API, or `pnpm --filter @catgpt/api worker`).

**Env vars.** New ones are added to `env.ts` (all optional at the zod level).
A missing Shorts variable must not stop the rest of the app from booting, so the
startup check prints an explicit report of every missing required variable and
tool, the Shorts page shows the same report, and each feature refuses with that
reason instead of failing silently. `pnpm --filter @catgpt/api shorts check`
exits non-zero if anything required is missing.

**Claude API.** Official `@anthropic-ai/sdk` (the repo had no Anthropic client),
model from `ANTHROPIC_MODEL`, JSON output via `output_config.format`
(`json_schema`), re-validated with zod. The exact request and response are
stored on the video row.

**Files.** Shorts media is stored on local disk under `STORAGE_PATH` (default
`./shorts-storage`), not in the public `/uploads` folder or Supabase Storage
(Supabase free tier caps objects at 50 MB and its bucket is public). Downloads
go through an authenticated endpoint or a short-lived HMAC-signed URL (needed
because `<video src>` can't send a Bearer header). On Railway, mount a volume at
`STORAGE_PATH`.

**ffmpeg.** Uses the host `ffmpeg`/`ffprobe` (spec requirement). The existing
app bundles `ffmpeg-static`; Shorts uses the system binary when present and the
startup check reports it if missing. Captions use libass (`subtitles` filter)
with the repo's bundled Noto Sans font so output is host-independent.

### External API facts checked against current docs (2026-11-20)

Fetched from the official pages, not taken from the build spec:

| Fact | Current docs say | Effect on the build |
| --- | --- | --- |
| `videos.insert` quota | Separate "Video Uploads" bucket: 100 calls/day, 1 unit each (the spec's "~1,600 of 10,000 units, ~6/day" is outdated) | Upload budget is tracked per Pacific-time day with constants in `youtube-logic.ts` (`UPLOADS_PER_DAY = 100`); `quotaExceeded`/`uploadLimitExceeded` from YouTube still moves the video to the manual queue. Uploads are claimed earliest-slot first. |
| Unverified API projects | `videos.insert` page: "Videos uploaded from unverified API projects are not restricted to private viewing mode." | Private-lock detection is still built (cheap, and Google may change it): after upload the app reads `status.privacyStatus`/`publishAt` back; a video that stays private past its publish time is flagged and moved to the manual queue with the reason. |
| Synthetic disclosure | `status.containsSyntheticMedia` (boolean), settable on insert | Sent on every upload from `video.synthetic`. |
| Scheduling | `status.publishAt` only honoured when `privacyStatus` is `private` and the video was never published | Scheduled uploads send `private` + `publishAt`; uploads for a slot already in the past go `public`. |
| Analytics metrics | `views, estimatedMinutesWatched, averageViewDuration, averageViewPercentage, likes, comments, shares, subscribersGained, engagedViews` all exist; no "viewed vs swiped away" metric | All are requested; "viewed vs swiped away" is a manual-entry field per video. |
| ElevenLabs timestamps | `POST /v1/text-to-speech/{voice_id}/with-timestamps` → `audio_base64`, `alignment{characters, character_start_times_seconds, character_end_times_seconds}`, `normalized_alignment` | Word timings are built from character alignment. |
| Pexels | `GET https://api.pexels.com/v1/videos/search`, raw key in `Authorization`, `orientation=portrait`, `per_page≤80`; 200 req/hour, 20k/month | Client-side limiter at 200/hour; 24 h response cache. |
| Pixabay | `GET https://pixabay.com/api/videos/?key=…`; 100 req/60 s; "requests must be cached for 24 hours"; store videos on your server | Limiter at 100/minute; 24 h response cache; clips are downloaded, never hotlinked. |
| Google OAuth "Testing" | Refresh tokens expire in 7 days | README tells the owner to set the consent screen to "In production". |

## Phase 2 — Foundations

- **Migration authored as a schema diff.** `prisma migrate dev` can't replay this repo's
  migrations on a fresh database: `20260927120000_social_post_media_urls` alters `SocialPost`
  before `20260928120000_social_publishing` creates it (a pre-existing ordering bug, left
  untouched because production already applied them). The Shorts migration
  (`20261120120000_shorts_factory`) was generated with `prisma migrate diff` from the previous
  schema to the new one, so it contains only the 10 `shorts_*` tables. `prisma migrate deploy`
  on an existing database applies it normally.
- **Seeded posting times** are one per channel per day, spread across the IST day
  (08:30–21:30) so channels don't all compete for the same upload slot. Videos per day always
  equals the number of posting times (the API rejects a mismatch; the edit dialog derives one
  from the other).
- **Voice id** is blank in the seed: the owner sets an ElevenLabs voice per channel in the UI;
  until then `ELEVENLABS_DEFAULT_VOICE_ID` (an existing optional var) is used, and if neither is
  set the voiceover step refuses with that message.
- **Optional overrides not in the owner's list** (all have defaults, none are secrets):
  `FFMPEG_BIN`/`FFPROBE_BIN` (binary names), `SHORTS_WORKER_CONCURRENCY` (default 2),
  `SHORTS_DISABLED=1` (turn the worker/scheduler off in a process).
- **Structured logs**: every Shorts event is one JSON line (`scope:"shorts"`), and
  transitions/fallbacks/refusals are also persisted to `shorts_events` for the per-video history.

## Phase 3 — Path B end to end

- **One narration, one TTS call.** The hook and beats are voiced as one ElevenLabs request
  (`with-timestamps`) so delivery is continuous. Beat clip lengths come from the word timings;
  the hook shares the first beat's clip (a 1.5 s hook clip would be a jarring cut).
- **Length.** Script prompt targets 15–40 s of narration at 2.6 words/s; the render is voice +
  0.6 s tail, clamped to 15–45 s. A voiceover over ~44.4 s is refused rather than cut.
- **Retries never re-pay.** The voiceover and downloaded clips are reused when a step is
  retried; the script step makes up to 3 Claude calls (invalid JSON, a failed check, or a
  duplicate each trigger a re-ask with the reason) and stores every request/response.
- **"Vertical or croppable"** = native vertical, or a centre 9:16 crop at least 540 px wide and
  960 px tall (at most 2x upscale). Native vertical scores higher. A clip shorter than its beat
  is looped.
- **Duplicate rules.** Same normalised script hash in the channel within 30 days → rejected
  (re-asked). Identical footage set within 30 days → rejected. Clips the channel used in the last
  30 days are only picked when nothing fresh fits.
- **Captions.** ASS subtitles, ≤3 words per caption, the spoken word highlighted, upper case,
  placed above the Shorts UI overlay. "Captions present" is validated as "N caption events were
  burned in" (ffprobe can't see burned-in text); a frame grab was checked by eye.
- **Music.** Least-recently-used track from `STORAGE_PATH/music_library`, looped, ducked
  under the voice with `sidechaincompress`, final mix loudness-normalised to −14 LUFS.
- **Offline fixtures** (`--offline` / "Dry run" button / `source = "dry_run"`): template
  script, ffmpeg test-pattern footage, synthetic tone with even word timings. They exist so the
  pipeline, scheduler and 3-day dry run can be exercised without keys or spend. Dry-run videos are
  never uploaded, and the content-rule check allows the `offline_fixture` provider only for them.
- **Config errors don't retry**: a missing key fails the job immediately with "Not configured:
  set X" (shown on the video); network/429/5xx errors retry with backoff.

## Phase 4 — Manual posting queue + public stats

- **Manual vs upload is decided as soon as a video is approved**, so a manual-queue video shows
  up immediately with its reason. A real upload defers itself until 6 h before the slot, so the
  earliest slots use quota first.
- **Suggested posting time** = the video's slot, or (for "Generate now" videos without a slot)
  the channel's next posting time in TIMEZONE. The UI shows it in the viewer's local clock.
- **"Mark as posted" never trusts a bare claim when it can check.** The URL must parse as a
  YouTube video id; with `YOUTUBE_API_KEY` set the id must exist publicly (`videos.list`), else
  the request is refused. A YouTube id can only be linked to one video. Without the key the post
  is accepted and the event log says "not verified".
- **Stats are never invented.** A video YouTube doesn't return (deleted/private/wrong id) gets no
  snapshot and a warning event. Snapshots are stored per checkpoint: `posted` (immediately),
  `24h`, `72h`, `7d`, `daily`, `manual`.
- **Downloads/previews** use signed URLs (6 h expiry, HMAC) with HTTP Range support.
- **DB integration tests** (`shorts-db.it.test.ts`) are opt-in (`SHORTS_IT=1` + a local
  Postgres) because the repo's test suite otherwise never touches a database.

## Phase 5 — YouTube OAuth + automated upload

- **One Google OAuth client, one connection per experiment channel.** "Connect YouTube" sends the
  owner through Google with `prompt=consent select_account` so they can pick the right brand
  channel; the callback (`GOOGLE_REDIRECT_URI`, which must point at
  `<API>/shorts/oauth/callback`) stores the encrypted refresh token on that channel. Connecting the
  same YouTube channel to two experiment channels is refused (it would mix their data). OAuth
  state reuses the existing `SocialOAuthSession` table (hashed, 10-minute, single-use).
- **Missing scopes are refused at connect time** (all three are needed: upload, readonly,
  analytics) instead of failing later.
- **Upload budget.** Counted per Pacific-time day in `shorts_quota_days`, reserved atomically
  before opening an upload session (95 of the documented 100/day). A `quotaExceeded` from
  YouTube marks the day exhausted, and every later video that day goes to the manual queue.
- **Crash safety.** The resumable session URI is saved before bytes are sent; the YouTube id is
  saved the moment YouTube returns it; a retry probes the saved session and resumes from the
  byte YouTube confirmed. A video with an id is never uploaded again. Verified against a local
  fake of Google's endpoints (`youtube-upload.it.test.ts`): network drop mid-upload → one init
  call, one resumed PUT, quota counted once.
- **"Posted" means verified public.** An upload for a future slot is `scheduled`
  (`private` + `publishAt`); a `publish_check` job runs 10 min after the slot and only marks it
  `posted` once YouTube reports `public`. Still private 30+ min after the slot, or YouTube
  dropped `publishAt` → `privateLocked` + manual queue with instructions. Not public after 6 h
  for any other reason → manual queue.
- **Expired/revoked tokens** (`invalid_grant`, 401) set the channel to `reauth_required` with a
  message that mentions the 7-day "Testing" consent-screen expiry; its videos go to the manual
  queue until the owner presses Reconnect.
- **Category** `22` (People & Blogs) for every upload; `selfDeclaredMadeForKids: false`.
- **Not verified live:** no real Google project was available, so the consent screen, real
  token exchange, real `videos.insert`, and YouTube's actual private-lock behaviour were not
  exercised. Request shapes follow the docs checked in Phase 1.

## Phase 6 — Path A ingest

- **Two entry points, one job.** Watch folder `STORAGE_PATH/ingest/<channel-slug>/` (scanned
  every minute; a file must be unchanged for 30 s so half-copied files are skipped) and
  `POST /shorts/channels/:id/ingest` (multipart, up to 500 MB, also in the Pipeline page). Both
  stage the file and enqueue an `ingest` job keyed by the file's sha256: the same file is never
  ingested twice (a re-drop goes to `rejected/` with a `.reason.txt`).
- **Sidecar** `<name>.json` next to the MP4: `title, description, tags, synthetic, hookType,
  topic` (all optional). An invalid sidecar rejects the pair with the reason. A `source` URL
  pointing at YouTube/Instagram/TikTok is refused (no reposting).
- **Normalisation, not trust.** Every ingest is re-encoded to H.264/AAC 1080x1920 (centre crop
  if the aspect differs) and passes the same validation as Path B except "captions" (rendered
  elsewhere). A render without audio gets a `music_library` track if one exists; otherwise it is
  refused with that reason (Shorts without sound are not a fair comparison).
- **Slot**: the channel's next free posting time. Then the channel's approval mode applies
  (manual by default → "awaiting approval").
- **Failures are visible**: a dead ingest moves the file to `rejected/` with the reason and
  raises a channel alert shown on the Pipeline page.
- The spec's "bucket prefix" alternative was not built; the watch folder lives under
  `STORAGE_PATH`, which can be a mounted volume or a synced bucket mount.

## Phase 7 — Path C with a hard budget cap

- **Provider adapter** reuses the repo's Veo/Runway/Kling request/response code
  (`services/video-gen/providers.ts`, now taking an explicit key). `VIDEO_GEN_PROVIDER` maps to a
  model: `veo`→Veo 3.1, `veo-fast`, `veo-lite`, `runway`→Gen-4 Turbo, `kling`→Kling 3.0 Standard.
  Clips are requested at 720p 9:16 (cheaper tier; the composer scales/crops to 1080x1920), one per
  beat, the shortest length the model offers that covers the beat (longest + loop otherwise).
- **Hard cap.** Before every generation call: estimate (seconds × price), then reserve it in
  `shorts_costs` inside a transaction holding a Postgres advisory lock, so concurrent workers
  can't both fit under the cap. Over the cap → no call is made, and the video falls back to B
  with the reason logged ("5.6 of 6 USD spent, 0.4 left, next clip needs 0.8"). The month is the
  calendar month in TIMEZONE.
- **Ledger semantics.** `reserved` → `spent` once the provider accepts the job (providers bill on
  acceptance, and we can't confirm refunds for failed jobs, so the conservative number is kept);
  `released` (cost not counted) when the request was never accepted. The task id is stored on
  the ledger row, so a crash after submitting resumes polling that task instead of paying again.
- **Price.** Owner-set price per second in BUDGET_CURRENCY (Costs page). Without one, the
  built-in list price is used only when BUDGET_CURRENCY is USD; for any other currency Path C
  refuses ("price not set") instead of guessing an exchange rate.
- **Fallback** goes to Path B only if the channel's fallback path is B (both seeded C channels);
  with no fallback the video fails with the reason. A fallen-back video has `path = B`,
  `plannedPath = C`, `synthetic = false` (its final footage is stock).
- **Verified offline**: 3 dry-run videos on `fails` with a 6 USD cap at 0.10/s → videos 1–2 fully
  generated (2.40 each), video 3 hit the cap after one clip and fell back to stock, ledger and
  fallback event as expected. **Not verified**: real Veo/Runway/Kling calls and their actual
  prices (the price table is the repo's third-party estimate; set your real price on the Costs
  page).
