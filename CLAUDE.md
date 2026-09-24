# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

CatGPT — a ChatGPT-style studio for themed image generation and general chat (PDF RAG, web search, code interpreter, brand/campaign mode, voice, shared workspaces with team chat). pnpm + Turborepo monorepo, Node >=22, pnpm 9. `README.md` covers setup/env vars, model routing and the API surface (it predates brands, campaigns, voice, and workspace/team features — check `apps/api/src/routes` for the real list).

## Commands

```bash
pnpm install
pnpm infra:up                # docker compose: postgres (pgvector) + redis
pnpm dev                     # turbo: web :3000, api :4000 (worker runs inline)
pnpm typecheck               # turbo, tsc --noEmit in every package (the only real check)
pnpm build                   # turbo build
pnpm db:generate | db:migrate | db:push | db:seed | db:studio   # Prisma via @catgpt/db
pnpm --filter @catgpt/api worker   # run the BullMQ worker as its own process
pnpm --filter @catgpt/api typecheck   # single-package typecheck
```

There is no test suite and `lint` is not defined in any package. Verify changes with `pnpm typecheck`. After editing `packages/db/prisma/schema.prisma`, run `pnpm db:migrate` (creates a migration) and `db:generate`. Themes are data seeded from `packages/db/prisma/seed.ts` (`pnpm db:seed`, upserts by slug).

## Architecture

- `apps/api` (Fastify 5, ESM, run with `tsx`, no build step) — routes in `src/routes`, business logic in `src/services`. `app.ts` wires plugins, the shared error handler (`HttpError` / `ZodError` from `lib/errors.ts`), and per-user rate limiting. Every route module registers `app.authenticate` (Supabase JWT, `plugins/auth.ts`) in a `preHandler`; all data is scoped per user (or workspace, via `lib/workspace-access.ts`).
- `apps/web` (Next.js 15 App Router, Tailwind, Zustand, React Query) — a single studio shell (`components/studio-shell.tsx`, composer, feed). UI state lives in `lib/store.ts`; server calls in `lib/api.ts`/`lib/hooks.ts`; live updates via `lib/sse.ts`.
- `packages/*` are consumed as TypeScript source (no per-package build): `types` (zod request schemas + DTOs shared by web and api — add new request/response shapes here), `db` (Prisma schema, client, seed), `image-providers` (`ImageProvider` interface with openai/flux/ideogram adapters and `generateWithFallback`), `config` (tsconfig/tailwind presets).

### Generation pipeline (the core flow)

Everything — image jobs, streamed chat replies, PDF Q&A, campaigns — is a `Generation` row processed by `services/generation-worker.ts` (`runGeneration`). `POST /generations` creates the row and calls `enqueueGeneration` (`services/queue.ts`):

- With `REDIS_URL`: a BullMQ queue; the worker can run inline in the API process (`WORKER_INLINE`) or separately via `worker.ts`. The same queue also carries document-ingestion jobs (`IngestJob`).
- Without Redis: the job runs in-process, fire-and-forget. Status and errors are persisted on the row.

The worker decides per prompt whether it's an image job or a chat turn, and routes chat to plain streaming, web search, code interpreter, or campaign mode (`services/chat.ts`, `services/campaign.ts`) based on prefix/intent helpers. Progress and streamed tokens are published through `services/events.ts` (Redis pub/sub, or an in-process EventEmitter without Redis) and consumed by the SSE endpoint `GET /generations/:id/events` (auth token via `?token=` since EventSource can't send headers). Keep new job types compatible with both Redis and no-Redis modes.

Other cross-file concepts: image daily quota with refunds on failure (`lib/usage.ts`), RAG over PDFs with pgvector chunks (`services/documents.ts`), per-user learned memories (`services/learned-memory.ts`), brand context injected into prompts (`lib/brand.ts`), workspaces with members/invites/team chat where `@ai` triggers an answer (`routes/team.ts`, `services/team.ts`). Images go to Supabase Storage or, if unconfigured, local `UPLOAD_DIR` served at `/uploads/`.

## Conventions

- Models: `gpt-image-2.5-flare` for new drafts, `gpt-image-2.5-sunburst` for regenerate/edit (parent image as reference); a theme's `styleGuide.preferredProvider` can pin a provider, with one fallback to OpenAI. Chat model is set by `CHAT_MODEL`.
- Deploy is Railway (`railway.json`); root `pnpm start` runs `prisma migrate deploy` then the API.
