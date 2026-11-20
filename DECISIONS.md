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
