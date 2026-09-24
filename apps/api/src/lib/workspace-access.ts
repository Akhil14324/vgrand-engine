import { prisma } from "@catgpt/db";
import { forbidden, notFound } from "./errors.js";

/** Prisma filter: workspaces the user owns or has been added to. */
export const workspaceAccess = (userId: string) => ({
  OR: [{ userId }, { members: { some: { userId } } }],
});

/**
 * A workspace the user may use (owner or member). Non-members get a 404 so
 * workspace ids cannot be probed. `ownerOnly` additionally demands ownership.
 */
export async function findWorkspaceForUser(
  userId: string,
  id: string,
  opts: { ownerOnly?: boolean } = {},
) {
  const workspace = await prisma.workspace.findFirst({
    where: { id, ...workspaceAccess(userId) },
  });
  if (!workspace) throw notFound("Workspace not found");
  if (opts.ownerOnly && workspace.userId !== userId) {
    throw forbidden("Only the workspace owner can do that");
  }
  return workspace;
}
