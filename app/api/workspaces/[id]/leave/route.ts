import { fail, ok } from "@/lib/http";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";

/** Removes the current user from the workspace (not available for the owner). */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser(_req);
  if (!user) return fail("Unauthorized", 401);

  const { id: workspaceId } = await ctx.params;

  const member = await prisma.workspaceMember.findFirst({
    where: { workspaceId, userId: user.id },
  });
  if (!member) return fail("Not a member of this workspace", 404);

  if (member.role === "owner") {
    return fail("Workspace owners cannot leave. Delete the workspace or transfer ownership first.", 400);
  }

  await prisma.workspaceMember.delete({ where: { id: member.id } });

  return ok({ left: true });
}
