# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

CatGPT — a ChatGPT-style studio for themed image generation and general chat (PDF RAG, web search, code interpreter, brand/campaign mode, voice, shared workspaces with team chat), plus two business-strategy modules built on top of it: **Guava** (branded "Brand Strategist" in the UI — advisory diagnosis) and **B Camp** (turns a goal/recommendation into a tracked campaign plan, execution pipeline, and social publishing). pnpm + Turborepo monorepo, Node >=22, pnpm 9. `README.md` covers setup/env vars and the original model routing (it predates brands, campaigns, B Camp, growth, social publishing, voice, and workspace/team features — check `apps/api/src/routes` for the real, current list of modules).

## Commands

```bash
pnpm install
pnpm infra:up                # docker compose: postgres (pgvector) + redis
pnpm dev                     # turbo: web :3000, api :4000 (worker runs inline)
pnpm typecheck               # turbo, tsc --noEmit in every package
pnpm lint                    # eslint . at the repo root (flat config covers both apps)
pnpm test                    # turbo test — currently only apps/api has tests (vitest)
pnpm build                   # turbo build
pnpm db:generate | db:migrate | db:push | db:seed | db:studio   # Prisma via @catgpt/db
pnpm --filter @catgpt/api worker   # run the BullMQ worker as its own process
pnpm --filter @catgpt/api typecheck   # single-package typecheck
```

Verify changes with `pnpm typecheck` (the broadest check across both apps and all packages) plus `pnpm lint` and, if you touched `apps/api`, `pnpm --filter @catgpt/api test`. `apps/web` has no test script — its correctness check is `typecheck` + manual/`run`-skill verification.

Tests live next to the code they test as `*.test.ts` under `apps/api/src/**` (vitest). To run one file or a single test:

```bash
pnpm --filter @catgpt/api exec vitest run src/services/growth-logic.test.ts
pnpm --filter @catgpt/api exec vitest run -t "name substring"
pnpm --filter @catgpt/api exec vitest         # watch mode
```

`vitest.config.ts` injects fake Supabase env vars so `env.ts` (which refuses to boot without `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`) can parse in tests without real credentials. Tests target pure logic modules (`*-logic.ts`, `bcamp.ts`'s access rules, brand-compliance rules, prompt building, URL validation) rather than hitting the DB or external APIs.

After editing `packages/db/prisma/schema.prisma`, run `pnpm db:migrate` (creates a migration) and `db:generate`. Themes are data seeded from `packages/db/prisma/seed.ts` (`pnpm db:seed`, upserts by slug).

## Architecture

- `apps/api` (Fastify 5, ESM, run with `tsx`, no build step) — routes in `src/routes`, business logic in `src/services`. `app.ts` wires plugins, the shared error handler (`HttpError` / `ZodError` from `lib/errors.ts`), and per-user rate limiting. Every route module registers `app.authenticate` (Supabase JWT, `plugins/auth.ts`) in a `preHandler`; all data is scoped per user (or workspace/brand, via `lib/workspace-access.ts` and `lib/brand.ts`'s `findAccessibleBrand`).
- `apps/web` (Next.js 15 App Router, Tailwind, Zustand, React Query) — a single studio shell (`components/studio-shell.tsx`, composer, feed) plus standalone pages per module (`app/guava`, `app/bcamp`, `app/growth`, `app/execution`, `app/calendar`, `app/brand`, `app/workspaces`). UI state lives in `lib/store.ts`; server calls in `lib/api.ts`/`lib/hooks.ts` (plus module-specific hook files, e.g. `lib/bcamp-hooks.ts`, `lib/growth-hooks.ts`); live updates via `lib/sse.ts`.
- `packages/*` are consumed as TypeScript source (no per-package build): `types` (zod request schemas + DTOs shared by web and api — add new request/response shapes here; also holds the *pure* planning/business logic for Guava and B Camp so the API, web, and tests share one set of rules — see `packages/types/src/guava.ts` and `packages/types/src/bcamp.ts`), `db` (Prisma schema, client, seed), `image-providers` (`ImageProvider` interface with openai/flux/ideogram adapters and `generateWithFallback`), `config` (tsconfig/tailwind presets).

### Generation pipeline (the core flow)

Everything — image jobs, streamed chat replies, PDF Q&A, campaigns — is a `Generation` row processed by `services/generation-worker.ts` (`runGeneration`). `POST /generations` creates the row and calls `enqueueGeneration` (`services/queue.ts`):

- With `REDIS_URL`: a BullMQ queue; the worker can run inline in the API process (`WORKER_INLINE`) or separately via `worker.ts`. The same queue also carries document-ingestion jobs (`IngestJob`) and social-post publish jobs (`enqueueSocialPost`, `SOCIAL_MAX_ATTEMPTS`/`SOCIAL_BACKOFF_MS` retries).
- Without Redis: the job runs in-process, fire-and-forget. Status and errors are persisted on the row.

The worker decides per prompt whether it's an image job or a chat turn. Image-vs-chat routing in `routes/generations.ts` is layered, not a single keyword check: an explicit `IMAGE_TRIGGER` regex (create/make/generate/draw/design/... + image/photo/picture/..., including a few common misspellings) fast-paths the obvious cases; everything else that isn't already resolved by a ref image, parent/edit chain, or campaign context falls through to `classifyIntent()` in `services/chat.ts`, which judges intent semantically via Jev (see below) or the chat model, not by keyword — so novel phrasing and typos not in the regex are still expected to route correctly. Chat itself routes to plain streaming, web search, code interpreter, or campaign mode (`services/chat.ts`, `services/campaign.ts`) based on prefix/intent helpers. Both `services/chat.ts` and `services/campaign.ts` run a post-hoc deterministic guard over the assembled reply (`assertNoFakeImageOutput` / `assertNoFakeGenerationClaim` + `CodeFenceGuard`) that appends a corrective note (and logs a warning) if the model bluffs having produced an image or ran real code it didn't. Progress and streamed tokens are published through `services/events.ts` (Redis pub/sub, or an in-process EventEmitter without Redis) and consumed by the SSE endpoint `GET /generations/:id/events` (auth token via `?token=` since EventSource can't send headers). Keep new job types compatible with both Redis and no-Redis modes.

### Jev (TypeSafe AI) — typed classification, not prose

`services/jev.ts` wraps an external "System One" evaluation model (`POST /v1/systemone`, gated on `TYPESAFE_API_KEY`): give it a `state` (conversation so far) plus typed questions (`choice`, `noul` yes/no-with-probability, `score`) and get back structured answers. It's used wherever the code would otherwise need a brittle regex or a full chat-completion call just to classify intent — image-vs-chat (`classifyIntent`), web-search triggering (`wantsWebSearch`), document-summary intent, memory-write gating, Guava/B Camp completeness checks. Every Jev call site has a non-Jev fallback (regex or a plain chat-completion call) so the feature is fully optional; without `TYPESAFE_API_KEY` everything still works, just via the older path.

### Guava (Brand Strategist) and B Camp (campaign strategy + execution)

These two modules sit on top of the generation pipeline but run their own logic, not `Generation` rows:

- **Guava** (`routes/guava.ts`, `services/guava-profile.ts`, `services/guava-diagnosis.ts`, page `/guava`) — a per-brand profile (sections/fields/industry packs live in `packages/types/src/guava.ts`; add an industry by adding one entry to `GUAVA_INDUSTRIES`) and stored diagnoses with follow-up Q&A. It runs its own in-process job (result persisted on `GuavaDiagnosis`, page polls), advisory only.
- **B Camp** (`routes/bcamp.ts`, `services/bcamp.ts`, page `/bcamp`) — turns a goal (a Guava recommendation, a seasonal prompt, or free text) into a `StrategyPlan` (objective, audience, offer, channels, budget, timeline, deliverables, tasks — schema and pure logic in `packages/types/src/bcamp.ts`), then converts accepted plan items into trackable `Deliverable`/`ExecTask` rows (`services/execution.ts`, page `/execution`) with an approval workflow (`routes/approvals.ts`). Every number/claim in a plan is tagged with a `Basis` (`user`/`historical`/`estimate`/`unknown`); `measurementGaps()` deliberately refuses to credit a campaign with sales just because they happened concurrently — reach/likes/views are explicitly flagged as not sales.
- **Growth** (`routes/growth.ts`, `services/growth.ts`, page `/growth`) — sits above B Camp: derives goals/suggestions/insights from strategies + recorded results, and produces campaign learnings/revisions (`CampaignLearning`, `StrategyRevision`) that feed back into future plans.
- Deliverables of a generatable type (`social_post`, `image`, `flyer`) can be produced through the image pipeline and linked back via `generationId`.

### Social publishing

`services/social/` holds one `SocialAdapter` per platform (`instagram`, `facebook`, `x`, `youtube` — `adapters/index.ts` maps `SocialPlatform` to its adapter). `accounts.ts` finds a usable connected account, `tokens.ts` refreshes OAuth tokens before use, `publish.ts` prepares media (`media/`, including on-the-fly image→video for YouTube) and calls the adapter, retrying through the same BullMQ queue as generations. `oauth/` + `routes/social.ts` (`socialRoutes`/`socialCallbackRoutes`) handle the connect flow per provider (Meta Graph API, X, Google/YouTube — each gated on its own env vars, see `env.ts`'s `metaConfigured`/`xConfigured`/`youtubeConfigured`). `social-calendar.ts` + `routes/social-calendar.ts` plan and schedule posts (including holiday-aware calendar fill) ahead of publish. Per-date occasions are resolved by `researchCalendarEvents` (`services/campaign.ts`): the seeded `Holiday` table (`pnpm --filter @catgpt/db seed:holidays` — lunar dates are curated per year, add next year's rows) merged with a live web search, then scored per-date for brand relevance ("no guessing": evaluator may only pick supplied candidates). Used by campaign chat, autopilot plans, Papaya day posts, AI Fill, and non-campaign date-range asks (injected via `metadata.calendarNote` in `routes/generations.ts`). OAuth tokens at rest are encrypted with `SOCIAL_TOKEN_KEY` (`lib/social-crypto.ts`).

### Other cross-file concepts

- Image daily quota with refunds on failure: `lib/usage.ts`.
- RAG over PDFs with pgvector chunks: `services/documents.ts`; scanned pages are OCR'd (`OCR_MODEL`) when extracted text is too sparse (`OCR_MIN_PAGE_CHARS`).
- Document editing (rewrite a `.docx`/PDF section-by-section, re-export): `services/document-edit.ts`, `document-patch.ts`, `docx-export.ts`, `pdf-export.ts`, bounded-concurrency via `lib/concurrency.ts`.
- Per-user learned memories: `services/learned-memory.ts`.
- Brand context injected into prompts, and brand access control: `lib/brand.ts`. Related brand sub-modules: `brand-voice`, `brand-kit`, `brand-guidelines` (+ `-doc` doc generation), `brand-compliance` (rule-based + AI findings against posted/generated content, with its own guard/test files).
- Workspaces with members/invites/team chat where `@ai` triggers an answer: `routes/team.ts`, `services/team.ts`; workspace-scoped data retention/deletion: `services/workspace-privacy.ts`.
- Voice mode (speech-to-text/text-to-speech, `VOICE_STT_MODEL`/`VOICE_TTS_MODEL`): `routes/voice.ts`. Voice replies never claim to have produced an image or file.
- Images go to Supabase Storage or, if unconfigured, local `UPLOAD_DIR` served at `/uploads/`; a separate `PRIVATE_STORAGE_BUCKET`/`PRIVATE_UPLOAD_DIR` holds consented voice samples.

## Conventions

- Models: `gpt-image-2.5-flare` for new drafts, `gpt-image-2.5-sunburst` for regenerate/edit (parent image as reference); a theme's `styleGuide.preferredProvider` can pin a provider, with one fallback to OpenAI. Chat model is set by `CHAT_MODEL`; other model-shaped env vars (`CODE_MODEL`, `CAMPAIGN_MODEL`, `EDIT_MODEL`, `OCR_MODEL`, `EMBEDDING_MODEL`, `JEV_MODEL`) each fall back to `CHAT_MODEL` or a hardcoded default if unset — see `env.ts`.
- Image rules (product requirements): every generated image exposes "Describe edit" (`DescribeEditDialog` in `generation-actions.tsx`). A described change MUST run as an edit of that exact image — `parentId` + parent image as reference + `buildEditPrompt` (minimal-change directive), never the creation template. An explicit "start over"/recreate (`createGenerationSchema.recreate`, `RECREATE_IMAGE` regex) produces a fresh draft instead. Brand `kind:"product"` assets = the brand's Product Photos: user-uploaded only (generated/edited/campaign images are never auto-added), fully isolated per brand, and prioritized in `brandReferenceUrls` (logo → products → mascot → references, cap 4). Brand-mode image prompts must state a marketing purpose (`brandImageGuidance`, `CREATIVE_SYSTEM`).
- Deploy is Railway (`railway.json`); root `pnpm start` runs `prisma migrate deploy` then the API.
