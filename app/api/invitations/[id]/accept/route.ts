import { fail, ok } from "@/lib/http";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/invitations/:id/accept
 * Adds the current user to the workspace when they are the invited receiver.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser(req);
  if (!user) return fail("Unauthorized", 401);

  const { id } = await ctx.params;

  const invitation = await prisma.workspaceInvitation.findUnique({
    where: { id },
    include: { workspace: true },
  });

  if (!invitation) {
    return fail("Invitation not found", 404);
  }

  if (invitation.status !== "pending") {
    return fail("This invitation is no longer pending", 400);
  }

  if (invitation.expiresAt < new Date()) {
    await prisma.workspaceInvitation.update({
      where: { id },
      data: { status: "expired" },
    });
    return fail("This invitation has expired", 400);
  }

  if (invitation.receiverUserId !== user.id) {
    return fail("Forbidden", 403);
  }

  const existing = await prisma.workspaceMember.findFirst({
    where: { workspaceId: invitation.workspaceId, userId: user.id },
  });
  if (existing) {
    await prisma.$transaction([
      prisma.workspaceInvitation.update({
        where: { id },
        data: { status: "accepted" },
      }),
      prisma.notification.updateMany({
        where: { relatedInvitationId: id },
        data: { read: true },
      }),
    ]);
    return ok({ joined: true, alreadyMember: true });
  }

  await prisma.$transaction(async (tx) => {
    await tx.workspaceMember.create({
      data: {
        workspaceId: invitation.workspaceId,
        userId: user.id,
        role: invitation.role,
      },
    });
    await tx.workspaceInvitation.update({
      where: { id },
      data: { status: "accepted" },
    });
    await tx.notification.updateMany({
      where: { relatedInvitationId: id },
      data: { read: true },
    });
    await tx.activityFeed.create({
      data: {
        workspaceId: invitation.workspaceId,
        userId: user.id,
        action: "joined_workspace",
        target: invitation.workspace.name,
        type: "member_invited",
      },
    });
  });

  return ok({ joined: true, workspaceId: invitation.workspaceId });
}
