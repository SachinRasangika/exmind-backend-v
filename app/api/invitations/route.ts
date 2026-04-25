import { randomUUID } from "node:crypto";
import { z } from "zod";
import { fail, ok } from "@/lib/http";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";

const createSchema = z.object({
  workspaceId: z.string().uuid(),
  /** Full registered email, or exact display name (if unique). */
  receiverEmailOrName: z.string().min(1).max(512),
  role: z.enum(["admin", "editor", "viewer"]).default("viewer"),
});

type ReceiverRow = { id: string; email: string; name: string };

async function resolveReceiver(raw: string): Promise<
  | { ok: true; user: ReceiverRow }
  | { ok: false; reason: "not_found" | "ambiguous_name" }
> {
  const q = raw.trim();
  if (!q) {
    return { ok: false, reason: "not_found" };
  }

  if (q.includes("@")) {
    const user = await prisma.user.findFirst({
      where: { email: { equals: q, mode: "insensitive" } },
      select: { id: true, email: true, name: true },
    });
    if (!user) return { ok: false, reason: "not_found" };
    return { ok: true, user };
  }

  const matches = await prisma.user.findMany({
    where: { name: { equals: q, mode: "insensitive" } },
    take: 3,
    select: { id: true, email: true, name: true },
    orderBy: { email: "asc" },
  });

  if (matches.length === 0) return { ok: false, reason: "not_found" };
  if (matches.length > 1) return { ok: false, reason: "ambiguous_name" };
  return { ok: true, user: matches[0]! };
}

/**
 * POST /api/invitations
 * Body: { workspaceId, receiverEmailOrName, role? }
 * Resolves the user on the server (no client search).
 */
export async function POST(req: Request) {
  try {
    const user = await getCurrentUser(req);
    if (!user) return fail("Unauthorized", 401);

    const body = await req.json().catch(() => null);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return fail("Invalid request payload", 400, parsed.error.flatten());
    }

    const { workspaceId, receiverEmailOrName, role } = parsed.data;

    const resolved = await resolveReceiver(receiverEmailOrName);
    if (!resolved.ok) {
      if (resolved.reason === "ambiguous_name") {
        return fail("Several accounts use that name. Enter their full email address.", 400);
      }
      return fail("User not found. Please enter a registered email.", 404);
    }

    const receiver = resolved.user;

    if (receiver.id === user.id) {
      return fail("You cannot invite yourself", 400);
    }

    const membership = await prisma.workspaceMember.findFirst({
      where: {
        workspaceId,
        userId: user.id,
        role: { in: ["owner", "admin"] },
      },
    });
    if (!membership) {
      return fail("You do not have permission to invite members to this workspace", 403);
    }

    const alreadyMember = await prisma.workspaceMember.findFirst({
      where: { workspaceId, userId: receiver.id },
    });
    if (alreadyMember) {
      return fail("This user is already a member of the workspace", 400);
    }

    const pending = await prisma.workspaceInvitation.findFirst({
      where: {
        workspaceId,
        receiverUserId: receiver.id,
        status: "pending",
      },
    });
    if (pending) {
      return fail("An invitation is already pending for this user", 400);
    }

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, name: true },
    });
    if (!workspace) {
      return fail("Workspace not found", 404);
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 14);

    const invitation = await prisma.$transaction(async (tx) => {
      const inv = await tx.workspaceInvitation.create({
        data: {
          workspaceId,
          invitedBy: user.id,
          email: receiver.email,
          role,
          status: "pending",
          token: randomUUID(),
          expiresAt,
          receiverUserId: receiver.id,
        },
      });

      await tx.notification.create({
        data: {
          userId: receiver.id,
          title: "Workspace invitation",
          message: `${user.name} invited you to join "${workspace.name}".`,
          type: "workspace",
          relatedInvitationId: inv.id,
        },
      });

      return inv;
    });

    try {
      await prisma.auditLog.create({
        data: {
          workspaceId,
          userId: user.id,
          action: "member_invited",
          targetType: "invitation",
          targetId: invitation.id,
          details: `Invited ${receiver.email} as ${role}`,
        },
      });
    } catch (auditErr) {
      console.error("[invitations] auditLog failed", auditErr);
    }

    return ok(
      {
        id: invitation.id,
        workspaceId: invitation.workspaceId,
        receiverUserId: invitation.receiverUserId,
        status: invitation.status,
        role: invitation.role,
        expiresAt: invitation.expiresAt,
      },
      201,
    );
  } catch (e) {
    console.error("[invitations] POST", e);
    return fail("Could not send invitation. Try again.", 500);
  }
}
