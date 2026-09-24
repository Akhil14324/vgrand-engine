import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { prisma } from "@catgpt/db";
import {
  addMemberSchema,
  teamMessageSchema,
  type TeamMessageDto,
  type WorkspaceMemberDto,
} from "@catgpt/types";
import { HttpError, notFound, parseBody } from "../lib/errors.js";
import { findWorkspaceForUser } from "../lib/workspace-access.js";
import {
  addressesAi,
  answerTeamMessage,
  displayName,
  stripMention,
} from "../services/team.js";
import { env } from "../env.js";

type MessageRow = {
  id: string;
  workspaceId: string;
  role: string;
  authorId: string | null;
  body: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  author: { name: string | null; email: string } | null;
};

const MESSAGE_INCLUDE = { author: { select: { name: true, email: true } } };

const toMessageDto = (m: MessageRow): TeamMessageDto => ({
  id: m.id,
  workspaceId: m.workspaceId,
  role: m.role as TeamMessageDto["role"],
  authorId: m.authorId,
  authorName: m.role === "ai" ? "CatGPT" : displayName(m.author),
  body: m.body,
  status: m.status as TeamMessageDto["status"],
  createdAt: m.createdAt.toISOString(),
  updatedAt: m.updatedAt.toISOString(),
});

/** Members, invite links and the shared team chat of a workspace. */
export async function teamRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  /* -------------------------------- members -------------------------------- */

  app.get("/workspaces/:id/members", async (req) => {
    const { id } = req.params as { id: string };
    const ws = await findWorkspaceForUser(req.userId, id);
    const [owner, members] = await Promise.all([
      prisma.user.findUniqueOrThrow({
        where: { id: ws.userId },
        select: { id: true, name: true, email: true },
      }),
      prisma.workspaceMember.findMany({
        where: { workspaceId: id },
        orderBy: { createdAt: "asc" },
        include: { user: { select: { id: true, name: true, email: true } } },
      }),
    ]);
    const items: WorkspaceMemberDto[] = [
      { userId: owner.id, name: displayName(owner), email: owner.email, role: "owner" },
      ...members.map((m) => ({
        userId: m.user.id,
        name: displayName(m.user),
        email: m.user.email,
        role: "member" as const,
      })),
    ];
    return { items };
  });

  /** Add someone who already has an account, by email (owner only). */
  app.post("/workspaces/:id/members", async (req, reply) => {
    const { id } = req.params as { id: string };
    const ws = await findWorkspaceForUser(req.userId, id, { ownerOnly: true });
    const { email } = parseBody(addMemberSchema, req.body);
    const user = await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { id: true },
    });
    if (!user) {
      throw notFound(
        "No account with that email yet - send them the invite link instead.",
      );
    }
    if (user.id === ws.userId) {
      throw new HttpError(409, "That is you - you own this workspace.");
    }
    await prisma.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: id, userId: user.id } },
      create: { workspaceId: id, userId: user.id },
      update: {},
    });
    return reply.code(201).send({ ok: true });
  });

  /** Remove a member (owner) or leave the workspace yourself. */
  app.delete("/workspaces/:id/members/:userId", async (req, reply) => {
    const { id, userId } = req.params as { id: string; userId: string };
    const ws = await findWorkspaceForUser(req.userId, id);
    const isSelf = userId === req.userId;
    if (!isSelf && ws.userId !== req.userId) {
      throw new HttpError(403, "Only the workspace owner can remove members");
    }
    if (userId === ws.userId) {
      throw new HttpError(400, "The owner cannot leave - delete the workspace instead");
    }
    await prisma.workspaceMember.deleteMany({
      where: { workspaceId: id, userId },
    });
    return reply.code(204).send();
  });

  /* ------------------------------- invite links ------------------------------ */

  /** Owner: get (or create) the workspace's join link. */
  app.post("/workspaces/:id/invite", async (req) => {
    const { id } = req.params as { id: string };
    await findWorkspaceForUser(req.userId, id, { ownerOnly: true });
    const invite =
      (await prisma.workspaceInvite.findFirst({
        where: { workspaceId: id },
        orderBy: { createdAt: "desc" },
      })) ??
      (await prisma.workspaceInvite.create({
        data: {
          workspaceId: id,
          token: randomBytes(24).toString("base64url"),
          createdById: req.userId,
        },
      }));
    return { url: `${env.WEB_ORIGIN}/join/${invite.token}` };
  });

  /** Owner: revoke - every existing link stops working. */
  app.delete("/workspaces/:id/invite", async (req, reply) => {
    const { id } = req.params as { id: string };
    await findWorkspaceForUser(req.userId, id, { ownerOnly: true });
    await prisma.workspaceInvite.deleteMany({ where: { workspaceId: id } });
    return reply.code(204).send();
  });

  const loadInvite = async (token: string) => {
    const invite = await prisma.workspaceInvite.findUnique({
      where: { token },
      include: {
        workspace: {
          select: {
            id: true,
            name: true,
            userId: true,
            user: { select: { name: true, email: true } },
          },
        },
      },
    });
    if (!invite) throw notFound("This invite link is no longer valid");
    return invite;
  };

  /** Preview shown on the join page. */
  app.get("/join/:token", async (req) => {
    const { token } = req.params as { token: string };
    const { workspace } = await loadInvite(token);
    const already =
      workspace.userId === req.userId ||
      (await prisma.workspaceMember.count({
        where: { workspaceId: workspace.id, userId: req.userId },
      })) > 0;
    return {
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      ownerName: displayName(workspace.user),
      alreadyMember: already,
    };
  });

  app.post(
    "/join/:token",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req) => {
      const { token } = req.params as { token: string };
      const { workspace } = await loadInvite(token);
      if (workspace.userId !== req.userId) {
        await prisma.workspaceMember.upsert({
          where: {
            workspaceId_userId: { workspaceId: workspace.id, userId: req.userId },
          },
          create: { workspaceId: workspace.id, userId: req.userId },
          update: {},
        });
      }
      return { workspaceId: workspace.id, workspaceName: workspace.name };
    },
  );

  /* -------------------------------- team chat -------------------------------- */

  /**
   * Poll endpoint. Without ?since it returns the latest 60 messages; with it,
   * everything created or updated at/after that instant (AI replies are
   * updated in place from "pending" to "done"). Clients merge by id.
   */
  app.get("/workspaces/:id/messages", async (req) => {
    const { id } = req.params as { id: string };
    await findWorkspaceForUser(req.userId, id);
    const q = req.query as { since?: string };
    const since = q.since ? new Date(q.since) : null;
    if (since && Number.isNaN(since.getTime())) {
      throw new HttpError(400, "since must be an ISO timestamp");
    }
    const rows = since
      ? await prisma.teamMessage.findMany({
          where: { workspaceId: id, updatedAt: { gte: since } },
          orderBy: { updatedAt: "asc" },
          take: 200,
          include: MESSAGE_INCLUDE,
        })
      : (
          await prisma.teamMessage.findMany({
            where: { workspaceId: id },
            orderBy: { createdAt: "desc" },
            take: 60,
            include: MESSAGE_INCLUDE,
          })
        ).reverse();
    return { items: rows.map(toMessageDto) };
  });

  /** Post to the team chat; "@ai ..." also makes CatGPT reply. */
  app.post(
    "/workspaces/:id/messages",
    { config: { rateLimit: { max: 40, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      await findWorkspaceForUser(req.userId, id);
      const { body } = parseBody(teamMessageSchema, req.body);

      const message = await prisma.teamMessage.create({
        data: { workspaceId: id, authorId: req.userId, role: "user", body },
        include: MESSAGE_INCLUDE,
      });
      let ai: MessageRow | null = null;
      if (addressesAi(body)) {
        ai = await prisma.teamMessage.create({
          data: {
            workspaceId: id,
            role: "ai",
            body: "",
            status: "pending",
            replyToId: message.id,
          },
          include: MESSAGE_INCLUDE,
        });
        // Fire-and-forget: the reply lands in the row; clients pick it up by polling.
        void answerTeamMessage({
          aiMessageId: ai.id,
          workspaceId: id,
          askerId: req.userId,
          question: stripMention(body) || body,
        });
      }
      return reply.code(201).send({
        message: toMessageDto(message),
        ai: ai ? toMessageDto(ai) : null,
      });
    },
  );
}
