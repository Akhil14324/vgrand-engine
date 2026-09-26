import { ZodError, type ZodSchema } from "zod";

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string,
    /** Structured, client-safe extra data (e.g. compliance findings). */
    public details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const badRequest = (msg = "Bad request") => new HttpError(400, msg);
export const unauthorized = (msg = "Unauthorized") => new HttpError(401, msg);
export const forbidden = (msg = "Forbidden") => new HttpError(403, msg);
export const notFound = (msg = "Not found") => new HttpError(404, msg);

export function parseBody<T>(schema: ZodSchema<T>, body: unknown): T {
  try {
    return schema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) {
      const issue = err.issues[0];
      throw badRequest(
        issue ? `${issue.path.join(".")}: ${issue.message}` : "Invalid body",
      );
    }
    throw err;
  }
}
