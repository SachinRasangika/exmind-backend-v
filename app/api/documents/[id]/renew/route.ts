import { fail, ok } from "@/lib/http";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { onDocumentRenewed } from "@/lib/workspace-events";
import { computeDocumentStatus } from "@/lib/documents";
import { z } from "zod";

const renewSchema = z.object({
  name: z.string().min(1).optional(),
  type: z.enum(["license", "insurance", "warranty", "membership", "subscription", "other"]).optional(),
  expiryDate: z.string().optional(),
  notes: z.string().nullable().optional(),
});

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

  const body = await req.json().catch(() => null);
  const parsed = renewSchema.safeParse(body ?? {});
  if (!parsed.success) return fail("Invalid request payload", 400, parsed.error.flatten());

  let expiryDate: Date | undefined;
  if (parsed.data.expiryDate) {
    expiryDate = new Date(parsed.data.expiryDate);
    if (Number.isNaN(expiryDate.getTime())) return fail("Invalid expiryDate", 400);
  }

  const updated = await prisma.document.update({
    where: { id },
    data: {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.type !== undefined ? { type: parsed.data.type } : {}),
      ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {}),
      ...(expiryDate ? { expiryDate } : {}),
      status: expiryDate ? computeDocumentStatus(expiryDate) : "renewed",
    },
  });

  await onDocumentRenewed({
    workspaceId: updated.workspaceId,
    actorUserId: user.id,
    documentId: updated.id,
    name: updated.name,
  });

  return ok(updated);
}

