import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  createConsentSchema,
  deleteWorkspaceDataSchema,
  updateWorkspacePrivacySchema,
  type ConsentRecordDto,
  type DeleteWorkspaceDataDto,
  type WorkspacePrivacyDto,
} from "@catgpt/types";
import { parseBody } from "../lib/errors.js";
import {
  addConsent,
  deleteWorkspaceContent,
  exportWorkspaceData,
  getPrivacy,
  listConsents,
  revokeConsent,
  setRetention,
} from "../services/workspace-privacy.js";

const idParams = z.object({ id: z.string().uuid() });
const consentParams = z.object({ id: z.string().uuid(), consentId: z.string().uuid() });

/** Workspace data & privacy controls: retention, export, delete-all, consent log. */
export async function workspacePrivacyRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/workspaces/:id/privacy", async (req): Promise<WorkspacePrivacyDto> => {
    const { id } = parseBody(idParams, req.params);
    return getPrivacy(req.userId, id);
  });

  app.patch("/workspaces/:id/privacy", async (req): Promise<WorkspacePrivacyDto> => {
    const { id } = parseBody(idParams, req.params);
    const body = parseBody(updateWorkspacePrivacySchema, req.body);
    return setRetention(req.userId, id, body.retentionDays);
  });

  /** Streamed straight to the caller as a download; never stored on our side. */
  app.get(
    "/workspaces/:id/export",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const { id } = parseBody(idParams, req.params);
      const data = await exportWorkspaceData(req.userId, id);
      return reply
        .header("Content-Type", "application/json; charset=utf-8")
        .header("Content-Disposition", `attachment; filename="workspace-export-${id.slice(0, 8)}.json"`)
        .send(JSON.stringify(data, null, 2));
    },
  );

  app.delete(
    "/workspaces/:id/data",
    { config: { rateLimit: { max: 3, timeWindow: "1 minute" } } },
    async (req): Promise<DeleteWorkspaceDataDto> => {
      const { id } = parseBody(idParams, req.params);
      const body = parseBody(deleteWorkspaceDataSchema, req.body);
      return deleteWorkspaceContent(req.userId, id, body.confirm);
    },
  );

  app.get("/workspaces/:id/consents", async (req): Promise<{ items: ConsentRecordDto[] }> => {
    const { id } = parseBody(idParams, req.params);
    return { items: await listConsents(req.userId, id) };
  });

  app.post("/workspaces/:id/consents", async (req, reply): Promise<ConsentRecordDto> => {
    const { id } = parseBody(idParams, req.params);
    const body = parseBody(createConsentSchema, req.body);
    return reply.code(201).send(await addConsent(req.userId, id, body));
  });

  app.post("/workspaces/:id/consents/:consentId/revoke", async (req): Promise<ConsentRecordDto> => {
    const { id, consentId } = parseBody(consentParams, req.params);
    return revokeConsent(req.userId, id, consentId);
  });
}
