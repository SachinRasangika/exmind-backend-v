import { z } from "zod";
import { fail, ok } from "@/lib/http";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";

const createWorkspaceSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["personal", "family", "business"]).default("personal"),
});

export async function GET(req: Request) {
  const user = await getCurrentUser(req);
  if (!user) {
    return fail("Unauthorized", 401);
  }

  const memberships = await prisma.workspaceMember.findMany({
    where: { userId: user.id },
    include: { workspace: true },
    orderBy: { joinedAt: "asc" },
  });

  return ok(
    memberships.map((m) => ({
      id: m.workspace.id,
      name: m.workspace.name,
      type: m.workspace.type,
      role: m.role,
      createdAt: m.workspace.createdAt,
    })),
  );
}

export async function POST(req: Request) {
  const user = await getCurrentUser(req);
  if (!user) {
    return fail("Unauthorized", 401);
  }

  const body = await req.json().catch(() => null);
  const parsed = createWorkspaceSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request payload", 400, parsed.error.flatten());
  }

  const workspace = await prisma.workspace.create({
    data: {
      name: parsed.data.name,
      type: parsed.data.type,
      ownerId: user.id,
      members: {
        create: {
          userId: user.id,
          role: "owner",
        },
      },
    },
  });

  return ok(workspace, 201);
}
