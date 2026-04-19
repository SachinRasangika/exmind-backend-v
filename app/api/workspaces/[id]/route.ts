import { z } from "zod";
import { fail, ok } from "@/lib/http";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";

const patchWorkspaceSchema = z.object({
  name: z.string().min(1).optional(),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser(req);
  if (!user) return fail("Unauthorized", 401);

  const { id } = await ctx.params;

  const member = await prisma.workspaceMember.findFirst({
    where: { workspaceId: id, userId: user.id, role: { in: ["owner", "admin"] } },
  });
  if (!member) return fail("Forbidden", 403);

  const body = await req.json().catch(() => null);
  const parsed = patchWorkspaceSchema.safeParse(body);
  if (!parsed.success) return fail("Invalid request payload", 400, parsed.error.flatten());

  const updated = await prisma.workspace.update({
    where: { id },
    data: {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
    },
  });

  return ok({
    id: updated.id,
    name: updated.name,
    type: updated.type,
    role: member.role,
    createdAt: updated.createdAt,
  });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser(req);
  if (!user) return fail("Unauthorized", 401);

  const { id } = await ctx.params;

  const member = await prisma.workspaceMember.findFirst({
    where: { workspaceId: id, userId: user.id, role: "owner" },
  });
  if (!member) return fail("Only the workspace owner can delete it", 403);

  await prisma.workspace.delete({ where: { id } });
  return ok({ deleted: true });
}
