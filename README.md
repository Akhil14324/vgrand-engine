# CatGPT — Themed AI Image Generation Studio

ChatGPT-style studio for themed image generation **and general chat**. Type `/`
in the composer to arm a theme template (`/restaurant`, `/infra`, …), describe
your idea, and a themed prompt template is merged with it before hitting the
image model. Non-image prompts get streaming Markdown replies (coding help,
Q&A, assessments). Drop a **PDF** into the composer to ask questions about it —
text is chunked, embedded, and retrieved per-turn (RAG); any reply can be
exported as a PDF. Generations can be saved to boards, shared via public links,
and browsed in a per-user history/memory feed.

## Stack

| Layer   | Tech                                                        |
| ------- | ----------------------------------------------------------- |
| web     | Next.js 15 (App Router), Tailwind, Zustand, React Query     |
| api     | Fastify 5, BullMQ, Redis, SSE for live status + streamed chat tokens |
| db      | Prisma → Postgres + pgvector (Supabase-compatible)          |
| images  | OpenAI `gpt-image-2.5-flare` (drafts) + `gpt-image-2.5-sunburst` (edits); Flux & Ideogram adapters ready |
| chat    | `CHAT_MODEL` streaming replies; `text-embedding-3-small` for PDF RAG — same OpenAI key |
| storage | Supabase Storage                                            |
| auth    | Supabase Auth, email + password only (login required)       |
| limits  | Unlimited chat; `IMAGE_DAILY_LIMIT` (default 50) images per user per UTC day |

## Quickstart

```bash
corepack enable            # once — provides pnpm
pnpm install
pnpm infra:up              # docker compose: postgres + redis

cp packages/db/.env.example packages/db/.env
cp apps/api/.env.example   apps/api/.env
cp apps/web/.env.example   apps/web/.env.local
# put your OPENAI_API_KEY in apps/api/.env

pnpm db:migrate            # creates tables (first run names the migration)
pnpm db:seed               # seeds /restaurant and /infra themes
pnpm dev                   # web :3000, api :4000 (worker runs inline)
```

Supabase is required: every request is authenticated and each user only ever
sees their own chats, images, documents and memories.

## Supabase setup

Fill `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` in
`apps/api/.env`, and `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
in `apps/web/.env.local`. That enables email/password login and Supabase Storage uploads. Point
`DATABASE_URL` at your Supabase Postgres (use the pooler URL) and re-run
`pnpm db:migrate && pnpm db:seed`. In Supabase Auth settings, turn off "Confirm email" if you want
sign-ups to work instantly without an email round-trip.

## Model routing

- `POST /generations` → **flare** (draft mode)
- `POST /generations/:id/regenerate` → **sunburst** (edit mode, parent image
  passed as reference, linked via `parentId`)
- A theme can pin a provider via `styleGuide.preferredProvider`
  (`"openai" | "flux" | "ideogram"`); errors fall back to OpenAI once.
- `quality` defaults to `low` (drafts); bump to `medium`/`high` on keepers.

## Adding themes

Themes are data — edit `packages/db/prisma/seed.ts` and re-run `pnpm db:seed`
(upserts by slug), or `POST /themes` with `{slug, label, promptTemplate,
styleGuide}`. They appear in the `/` menu automatically.

Prompts sent **without** a theme still generate — a generic template wraps them.

## Layout

```
apps/api     Fastify routes, BullMQ worker, SSE, storage service
apps/web     Next.js studio: composer, feed, boards, /share/[token]
packages/db          Prisma schema + client + seed
packages/image-providers   ImageProvider interface + openai/flux/ideogram + fallback routing
packages/types       zod request schemas + DTO types shared by web & api
packages/config      shared tsconfig + tailwind preset
```

## API surface

```
POST /generations            {themeSlug?, prompt, provider?, quality?, size?, referenceImageUrl?, documentIds?, parentId?}
GET  /generations            ?themeSlug=&conversationId=&cursor=&limit=
GET  /generations/:id        DELETE /generations/:id
POST /generations/:id/regenerate   {prompt?, quality?}
POST /generations/:id/pdf          export a text reply as a downloadable PDF
GET  /generations/:id/events       SSE stream (token via ?token= for EventSource)

POST /documents              multipart PDF → extract + embed chunks (RAG)
GET  /documents              ?conversationId=    DELETE /documents/:id

GET  /themes                 GET /themes/:slug    POST /themes   PUT /themes/:id
POST /boards                 GET /boards          POST /boards/:id/items   DELETE /boards/:id/items/:itemId
POST /share/:generationId    GET /share/:token (public)
GET  /memories               POST /memories       DELETE /memories/:id
POST /uploads                multipart image → {url} (reference images)
GET  /health
```

## Notes

- Workspace packages ship as TypeScript source — the API runs under `tsx` and
  Next transpiles `@catgpt/types`. If you outgrow that, add a `tsc` build
  per package and point `exports` at `dist`.
- `ApiKey`/BYO-key support is intentionally skipped (shared server-side key
  model). The schema + `/me/api-keys` endpoints are easy to add back if the
  product goes multi-tenant.
- UI primitives live in `apps/web/components/ui` rather than `packages/ui`
  since there's a single frontend; promote them if a second app appears.

## Shorts Factory

Runs 10 YouTube Shorts channels as an experiment to learn which formats work
(web: `/shorts`). Design decisions and what was/wasn't verified live:
[`DECISIONS.md`](DECISIONS.md).

| Path | How videos are made | Channels |
| ---- | ------------------- | -------- |
| A | Rendered elsewhere; the app ingests finished MP4s (watch folder or upload) | oddly-satisfying, weird-science |
| B | Claude script → Pexels/Pixabay footage → ElevenLabs voice → ffmpeg with burned-in captions | cats, dogs, wild-animals, food, wholesome, memes-relatable |
| C | AI clips (Veo/Runway/Kling) under a hard monthly cap, falling back to B | fails, insane-skills |

Pipeline per video: `idea → scripted → assets_ready → rendered → awaiting_approval → approved →
scheduled → posted`, or `manual_pending → manual_posted`, or `failed` (retry from the UI).
Every channel starts on **manual approval**; switch a channel to auto on the Channels page.

### 1. Install ffmpeg and ffprobe

The host needs both on `PATH` (with libass for captions and libx264):

```bash
# Debian/Ubuntu
sudo apt-get install -y ffmpeg
# macOS
brew install ffmpeg
ffmpeg -version && ffprobe -version
```

On Railway, add `ffmpeg` to the build packages (Nixpacks: `NIXPACKS_APT_PKGS=ffmpeg`, or
`[phases.setup] aptPkgs = ["ffmpeg"]`).

### 2. Environment variables (apps/api/.env)

| Variable | Purpose | Required |
| --- | --- | --- |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | scripts and the weekly report | yes |
| `ELEVENLABS_API_KEY` | voiceover (set a voice id per channel in the UI, or `ELEVENLABS_DEFAULT_VOICE_ID`) | yes |
| `PEXELS_API_KEY`, `PIXABAY_API_KEY` | stock footage | yes |
| `YOUTUBE_API_KEY` | public stats for every posted video | yes |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | YouTube OAuth for uploads and private analytics | optional (without them every video uses the manual queue) |
| `TOKEN_ENCRYPTION_KEY` | encrypts stored OAuth tokens: `openssl rand -hex 32` | yes if Google OAuth is set |
| `VIDEO_GEN_PROVIDER` (`veo`, `veo-fast`, `veo-lite`, `runway`, `kling`), `VIDEO_GEN_API_KEY` | Path C clips | optional (without them Path C always falls back to B) |
| `PATH_C_MONTHLY_BUDGET`, `BUDGET_CURRENCY` | hard monthly cap for Path C, e.g. `20` and `USD` | yes |
| `APP_BASE_URL` | the web app URL (OAuth returns here) | yes |
| `TIMEZONE` | posting schedule time zone, default `Asia/Kolkata` | yes (has a default) |
| `STORAGE_PATH` | videos, ingest folders, `music_library/`; default `./shorts-storage`. Use a persistent volume in production | if missing |
| `DATABASE_URL` | already used by the app | yes |

At boot the API and worker print a report naming every missing or invalid variable and tool;
the Shorts page shows the same report. Check it any time with:

```bash
pnpm --filter @catgpt/api shorts check     # exits 1 if anything required is missing
```

If `BUDGET_CURRENCY` isn't `USD`, set your provider's real price per second on the Costs page;
Path C refuses to spend until a price is known.

### 3. Google Cloud project (for automatic uploads)

1. Create a project at console.cloud.google.com and enable **YouTube Data API v3** and
   **YouTube Analytics API**.
2. **APIs & Services → Credentials → Create API key** → `YOUTUBE_API_KEY` (restrict it to the
   YouTube Data API).
3. **OAuth consent screen**: user type *External*; add the scopes
   `youtube.upload`, `youtube.readonly`, `yt-analytics.readonly`.
4. **Set the consent screen's publishing status to "In production".** While it stays in
   "Testing", Google expires refresh tokens after **7 days**: every channel would need
   reconnecting weekly, and uploads would fall back to the manual queue in between. Google may
   ask for verification for these scopes; until it's done you can still connect (an
   "unverified app" warning shows).
5. **Credentials → Create OAuth client ID → Web application.** Authorized redirect URI:
   `<API_PUBLIC_URL>/shorts/oauth/callback` (e.g. `https://api.example.com/shorts/oauth/callback`).
   Put the same value in `GOOGLE_REDIRECT_URI`, and the client id/secret in `GOOGLE_CLIENT_ID` /
   `GOOGLE_CLIENT_SECRET`.
6. In the app, Channels → **Connect YouTube** on each channel and pick that channel's own
   YouTube (brand) channel. One YouTube channel can't be connected to two experiment channels.

Quota (checked 2026-11-20): `videos.insert` has its own bucket of 100 uploads/day per project;
the app stops at 95 and sends the rest to the manual queue. Quota resets at midnight Pacific time.

### 4. Running

```bash
pnpm db:migrate                              # creates the shorts_* tables
pnpm dev                                     # the Shorts worker + scheduler run with the generation worker
pnpm --filter @catgpt/api shorts make --channel cats            # one Path B video now (live APIs)
pnpm --filter @catgpt/api shorts make --channel cats --offline  # same pipeline on local fixtures, no keys, no spend
pnpm --filter @catgpt/api shorts dry-run --days 3               # scheduler simulation, offline, no uploads
pnpm --filter @catgpt/api shorts ingest                         # scan Path A watch folders now
```

- **Path A**: drop `name.mp4` (+ optional `name.json` with `title`, `description`, `tags`,
  `synthetic`, `hookType`, `topic`) into `STORAGE_PATH/ingest/<channel-slug>/`, or upload on the
  Pipeline page. Refused files move to `rejected/` with a `.reason.txt`.
- **Music**: put tracks you have cleared for use in `STORAGE_PATH/music_library/`. Empty = no
  music.
- **Manual queue**: download, copy title/description/tags, post at the suggested time, paste
  the URL into "Mark as posted". The app verifies the URL is a public YouTube video.
- **Stats**: public stats sync right after posting, at 24 h, 72 h and 7 days, and daily (03:00
  in TIMEZONE); private analytics daily for connected channels. A channel with fewer than 30
  posted videos shows "too early" and isn't ranked. The weekly report is written every Monday
  09:00.
- **Logs**: Shorts events are JSON lines with `"scope":"shorts"`; per-video history is on the
  video's detail dialog.
- **Integration tests** (need a local Postgres): `SHORTS_IT=1 DATABASE_URL=... pnpm --filter
  @catgpt/api exec vitest run shorts-db.it youtube-upload.it worker-kill.it`.

## Instagram Automations

Comment-to-DM automation for connected Instagram professional accounts (web: `/automations`).
When someone comments a keyword on a post or reel, the app replies publicly under the comment
(optional, random pick from your variants, `{username}` supported) and sends them a private
DM (optional link button). DM keyword rules answer incoming DMs the same way. Every comment and
message is logged in the Activity table with what was sent, skipped or failed.

### What you set up in Meta (once)

1. **App Review / Advanced Access** for: `instagram_basic`, `instagram_manage_comments`,
   `instagram_manage_messages`, `pages_manage_metadata`, `pages_read_engagement`,
   `pages_show_list` (plus the publishing ones you already use). Meta requires Advanced Access
   (and Business Verification) for accounts that don't have a role on your app, and the app must
   be **Live** to receive webhooks for them.
2. **Login permissions.** If you use Facebook Login for Business (`META_LOGIN_CONFIG_ID`), add
   the permissions above to that saved configuration. Otherwise set
   `META_AUTOMATION_SCOPES=true` *after* Meta approves them (requesting unapproved permissions
   breaks the login for everyone, so it's off by default).
3. **Webhooks** (App Dashboard → Webhooks → Instagram): callback URL
   `<API_PUBLIC_URL>/webhooks/meta`, verify token = the value of `META_WEBHOOK_VERIFY_TOKEN`,
   then subscribe to the fields `comments`, `live_comments` and `messages`. Deliveries are
   verified with `META_APP_SECRET` (`X-Hub-Signature-256`); unsigned ones are refused.
4. **Reconnect** each Facebook/Instagram account after the permissions are approved, so its
   token carries them (Automations page → Reconnect). Existing rules are kept.
5. On the Automations page press **Subscribe page** for each account, then check the Setup
   card is all green ("Ready"). The Instagram account must be **public**, and in the Instagram
   app *Settings → Messages and story replies → Message controls → Connected tools*, "Allow
   access to messages" must be on.

### Environment variables

| Variable | Purpose |
| --- | --- |
| `META_APP_ID`, `META_APP_SECRET` | already used for Facebook/Instagram connect; the secret also verifies webhook signatures |
| `META_WEBHOOK_VERIFY_TOKEN` | any random string; type the same value as the Verify Token in Meta |
| `META_AUTOMATION_SCOPES` | `true` to request the automation permissions at login (only without `META_LOGIN_CONFIG_ID`) |

### Instagram's own limits (enforced in code)

- The DM to a commenter is a one-time **private reply**, possible only within **7 days** of the
  comment. Further DMs need the person to reply first (then within 24 h).
- Public replies work on **top-level** comments only; not on replies or live comments (those
  still get the DM).
- "Reply to each person only once" is on by default per rule, and your own comments are ignored.
- Rate-limit and server errors retry with backoff; a reply whose outcome is unknown (network
  drop) is never resent, so nobody gets a duplicate public reply.

The database tables come with the migration `20261121120000_instagram_automation` (applied by
Railway's `prisma migrate deploy` on deploy). Tests: `SHORTS_IT=1 DATABASE_URL=... pnpm --filter
@catgpt/api exec vitest run ig-automation`.
