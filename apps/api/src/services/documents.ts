import { randomUUID } from "node:crypto";
import mammoth from "mammoth";
import OpenAI from "openai";
import { PDFParse } from "pdf-parse";
import { Prisma, prisma } from "@catgpt/db";
import { env } from "../env.js";

/**
 * PDF ingestion + RAG retrieval.
 *  - pdf-parse extracts text locally (no external API).
 *  - Chunks are embedded in batches via OpenAI embeddings (same OPENAI_API_KEY)
 *    and stored in pgvector — retrieval is one cosine-distance query.
 */

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }
  client ??= new OpenAI({
    apiKey: env.OPENAI_API_KEY,
    baseURL: env.OPENAI_BASE_URL || undefined,
  });
  return client;
}

/** Embed many strings in batches — a single API call per batch keeps ingest fast. */
async function embedTexts(texts: string[]): Promise<number[][]> {
  const BATCH = 128;
  const out: number[][] = new Array(texts.length);
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    const res = await getClient().embeddings.create({
      model: env.EMBEDDING_MODEL,
      // Pinned to the vector(1536) column — guards against model swaps.
      dimensions: 1536,
      input: batch,
    });
    for (const d of res.data) out[i + d.index] = d.embedding;
  }
  return out;
}

/** Split on paragraph/sentence boundaries, targeting ~RAG_CHUNK_CHARS per chunk. */
export function chunkText(raw: string): string[] {
  const size = env.RAG_CHUNK_CHARS;
  const overlap = env.RAG_CHUNK_OVERLAP;
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) return [];

  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + size, text.length);
    if (end < text.length) {
      // Walk back to the last sentence/paragraph break so chunks don't cut mid-thought.
      const slice = text.slice(start, end);
      const lastBreak = Math.max(
        slice.lastIndexOf(". "),
        slice.lastIndexOf("? "),
        slice.lastIndexOf("! "),
        slice.lastIndexOf("; "),
      );
      if (lastBreak > size * 0.4) end = start + lastBreak + 1;
    }
    chunks.push(text.slice(start, end).trim());
    // Tail reached — sliding further only re-slices the same ending.
    if (end >= text.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * Extract text, chunk, embed, and persist chunks for a Document row.
 * Runs inline at upload time — batched embeddings keep typical files under ~2s.
 * .docx goes through mammoth (no fixed page count — the returned pageCount is
 * a rough ~500-words-per-page estimate for display only).
 */
export async function ingestDocument(
  documentId: string,
  buffer: Buffer,
  mimeType = "application/pdf",
): Promise<{ pageCount: number; chunkCount: number }> {
  let text: string;
  let pageCount: number;
  if (mimeType === DOCX_MIME) {
    const { value } = await mammoth.extractRawText({ buffer });
    text = value;
    // Estimate only — .docx has no fixed pagination.
    pageCount = Math.max(1, Math.ceil(text.trim().split(/\s+/).length / 500));
  } else {
    const parser = new PDFParse({ data: buffer });
    let parsed: Awaited<ReturnType<typeof parser.getText>>;
    try {
      parsed = await parser.getText();
    } finally {
      await parser.destroy();
    }
    if (parsed.total > env.MAX_PDF_PAGES) {
      throw new Error(
        `it has ${parsed.total} pages — the limit is ${env.MAX_PDF_PAGES} pages`,
      );
    }
    text = parsed.text ?? "";
    pageCount = parsed.total;
  }

  const chunks = chunkText(text);
  if (chunks.length === 0) {
    throw new Error(
      mimeType === DOCX_MIME
        ? "no text could be extracted — the document looks empty"
        : "no text could be extracted — it looks like a scanned/image-only PDF",
    );
  }

  const vectors = await embedTexts(chunks);

  // Multi-row inserts, ~25 chunks per statement — each INSERT is atomic on
  // its own. No interactive transaction: the 5s tx timeout (and Supabase's
  // transaction-mode pooler) can't cope with hundreds of sequential inserts.
  const ROWS_PER_INSERT = 25;
  try {
    for (let i = 0; i < chunks.length; i += ROWS_PER_INSERT) {
      const slice = chunks.slice(i, i + ROWS_PER_INSERT);
      const rows = slice.map((content, j) => {
        const idx = i + j;
        const literal = `[${vectors[idx]!.join(",")}]`;
        return Prisma.sql`(${randomUUID()}, ${documentId}, ${idx}, ${content}, ${literal}::vector)`;
      });
      await prisma.$executeRaw`
        INSERT INTO "DocumentChunk" ("id", "documentId", "chunkIndex", "content", "embedding")
        VALUES ${Prisma.join(rows)}`;
    }
  } catch (err) {
    // Partial batches may have committed — don't leave orphan chunks behind.
    await prisma.documentChunk
      .deleteMany({ where: { documentId } })
      .catch(() => {});
    throw err;
  }
  return { pageCount, chunkCount: chunks.length };
}

/**
 * Top-K chunks across all ready documents in scope: ones linked to this
 * conversation OR everything in the conversation's workspace. The workspace
 * branch is what makes "analyze all the Workspace data" automatic on every
 * turn — no re-attaching needed.
 * Returns labeled passages for the chat system prompt, or [] when there's
 * nothing to retrieve (no docs, no key, or retrieval fails).
 */
export async function retrieveContext(
  prompt: string,
  scope: { conversationId: string | null; workspaceId: string | null },
): Promise<string[]> {
  const docs = await prisma.document.findMany({
    where: {
      status: "ready",
      OR: [
        ...(scope.conversationId
          ? [{ conversationId: scope.conversationId }]
          : []),
        ...(scope.workspaceId ? [{ workspaceId: scope.workspaceId }] : []),
      ],
    },
    select: { id: true },
  });
  if (docs.length === 0) return [];

  const [vec] = await embedTexts([prompt.slice(0, 2000)]);
  if (!vec) return [];
  const literal = `[${vec.join(",")}]`;

  const rows = await prisma.$queryRaw<
    Array<{ content: string; filename: string }>
  >`
    SELECT c."content", d."filename"
    FROM "DocumentChunk" c
    JOIN "Document" d ON d."id" = c."documentId"
    WHERE c."documentId" IN (${Prisma.join(docs.map((d) => d.id))})
      AND c."embedding" IS NOT NULL
    ORDER BY c."embedding" <=> ${literal}::vector
    LIMIT ${env.RAG_TOP_K}`;
  return rows.map((r) => `[${r.filename}] ${r.content}`);
}

/**
 * Queued ingestion handler — the HTTP route stores the file and enqueues the
 * job; this runs on the worker. Mirrors runGeneration()'s status lifecycle:
 * processing -> ready | failed, persisted on the Document row.
 */
export async function runDocumentIngestion(
  documentId: string,
  mimeType: string,
): Promise<void> {
  const doc = await prisma.document.findUnique({ where: { id: documentId } });
  if (!doc || doc.status !== "processing") return;
  try {
    // The upload was already persisted — fetch it back so the job payload
    // stays small and storage works the same for Supabase and local files.
    if (!doc.storageUrl) {
      throw new Error("document has no stored file to ingest");
    }
    const res = await fetch(doc.storageUrl);
    if (!res.ok) {
      throw new Error(`couldn't fetch the stored file (${res.status})`);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    const { pageCount, chunkCount } = await ingestDocument(
      documentId,
      buffer,
      mimeType,
    );
    await prisma.document.update({
      where: { id: documentId },
      data: { status: "ready", pageCount, chunkCount },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "ingest failed";
    await prisma.document.update({
      where: { id: documentId },
      data: { status: "failed", error: message },
    });
    throw err;
  }
}
