import { fail, ok } from "@/lib/http";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser(req);
  if (!user) return fail("Unauthorized", 401);

  const { id } = await ctx.params;
  const existing = await prisma.document.findUnique({ where: { id } });
  if (!existing) return fail("Document not found", 404);

  const member = await prisma.workspaceMember.findFirst({
    where: {
      workspaceId: existing.workspaceId,
      userId: user.id,
      role: { in: ["owner", "admin", "editor"] },
    },
  });
  if (!member) return fail("Forbidden", 403);

  const updated = await prisma.document.update({
    where: { id },
    data: { status: "renewed" },
  });

  return ok(updated);
}

