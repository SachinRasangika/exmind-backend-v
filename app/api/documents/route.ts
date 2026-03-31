import { z } from "zod";
import { fail, ok } from "@/lib/http";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { computeDocumentStatus } from "@/lib/documents";

const createDocumentSchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().min(1),
  type: z.enum(["license", "insurance", "warranty", "membership", "subscription", "other"]),
  expiryDate: z.string(),
  notes: z.string().nullable().optional(),
  branchId: z.string().uuid().nullable().optional(),
});

export async function GET(req: Request) {
  const user = await getCurrentUser(req);
  if (!user) {
    return fail("Unauthorized", 401);
  }

  const url = new URL(req.url);
  const workspaceId = url.searchParams.get("workspaceId");
  const status = url.searchParams.get("status");

  const memberWorkspaces = await prisma.workspaceMember.findMany({
    where: { userId: user.id },
    select: { workspaceId: true },
  });

  const allowedWorkspaceIds = memberWorkspaces.map((m) => m.workspaceId);
  const effectiveWorkspaceId =
    workspaceId && allowedWorkspaceIds.includes(workspaceId) ? workspaceId : undefined;

  const docs = await prisma.document.findMany({
    where: {
      workspaceId: effectiveWorkspaceId ?? { in: allowedWorkspaceIds },
    },
    orderBy: { createdAt: "desc" },
  });

  const withComputedStatus = docs
    .map((doc) => ({ ...doc, status: computeDocumentStatus(doc.expiryDate) }))
    .filter((doc) => (status ? doc.status === status : true));

  return ok(withComputedStatus);
}

export async function POST(req: Request) {
  const user = await getCurrentUser(req);
  if (!user) {
    return fail("Unauthorized", 401);
  }

  const body = await req.json().catch(() => null);
  const parsed = createDocumentSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request payload", 400, parsed.error.flatten());
  }

  const membership = await prisma.workspaceMember.findFirst({
    where: {
      workspaceId: parsed.data.workspaceId,
      userId: user.id,
      role: { in: ["owner", "admin", "editor"] },
    },
  });
  if (!membership) {
    return fail("Forbidden", 403);
  }

  const expiryDate = new Date(parsed.data.expiryDate);
  if (Number.isNaN(expiryDate.getTime())) {
    return fail("Invalid expiryDate", 400);
  }

  const document = await prisma.document.create({
    data: {
      workspaceId: parsed.data.workspaceId,
      createdBy: user.id,
      name: parsed.data.name,
      type: parsed.data.type,
      status: computeDocumentStatus(expiryDate),
      expiryDate,
      notes: parsed.data.notes ?? null,
      branchId: parsed.data.branchId ?? null,
    },
  });

  return ok(document, 201);
}
