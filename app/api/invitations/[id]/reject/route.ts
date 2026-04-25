import { fail, ok } from "@/lib/http";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/invitations/:id/reject
 * Declines a pending workspace invitation (receiver only).
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser(req);
  if (!user) return fail("Unauthorized", 401);

  const { id } = await ctx.params;

  const invitation = await prisma.workspaceInvitation.findUnique({
    where: { id },
  });

  if (!invitation) {
    return fail("Invitation not found", 404);
  }

  if (invitation.status !== "pending") {
    return fail("This invitation is no longer pending", 400);
  }

  if (invitation.receiverUserId !== user.id) {
    return fail("Forbidden", 403);
  }

  await prisma.$transaction([
    prisma.workspaceInvitation.update({
      where: { id },
      data: { status: "declined" },
    }),
    prisma.notification.updateMany({
      where: { relatedInvitationId: id },
      data: { read: true },
    }),
  ]);

  return ok({ declined: true });
}
