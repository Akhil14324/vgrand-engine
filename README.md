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
| storage | Supabase Storage, or local `./uploads` fallback in dev      |
| auth    | Supabase Auth (email + Google), or `DEV_AUTH_BYPASS` locally |

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

Works out of the box without Supabase: `DEV_AUTH_BYPASS=true` signs everyone in
as a local dev user, and images are stored under `apps/api/uploads/` and served
at `/uploads/*`.

## When you get Supabase

Fill `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` in
`apps/api/.env`, and `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
in `apps/web/.env.local`. That automatically switches on real JWT auth
(email + Google login UI) and Supabase Storage uploads. Point
`DATABASE_URL` at your Supabase Postgres (use the pooler URL) and re-run
`pnpm db:migrate && pnpm db:seed`. Set `DEV_AUTH_BYPASS=false` in production.

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
