import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Prisma's default pool (2*cpu+1) is tiny on small hosts, and chat streaming
 * holds queries open — requests then die with "Unable to start a transaction
 * in the given time". Give the pool sane defaults unless the URL sets them.
 */
function pooledUrl(): string | undefined {
  const raw = process.env.DATABASE_URL;
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (!url.searchParams.has("connection_limit"))
      url.searchParams.set("connection_limit", "10");
    if (!url.searchParams.has("pool_timeout"))
      url.searchParams.set("pool_timeout", "30");
    return url.toString();
  } catch {
    return raw;
  }
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasourceUrl: pooledUrl(),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export { Prisma, PrismaClient } from "@prisma/client";
export type * from "@prisma/client";
