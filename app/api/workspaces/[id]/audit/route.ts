import { fail, ok } from "@/lib/http";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser(req);
  if (!user) return fail("Unauthorized", 401);

  const { id: workspaceId } = await ctx.params;

  const member = await prisma.workspaceMember.findFirst({
    where: { workspaceId, userId: user.id, role: { in: ["owner", "admin"] } },
  });
  if (!member) return fail("Forbidden", 403);

  const url = new URL(req.url);
  const take = Math.min(Number(url.searchParams.get("limit") ?? "80"), 200);

  const rows = await prisma.auditLog.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
    take: Number.isFinite(take) && take > 0 ? take : 80,
    include: {
      user: { select: { id: true, name: true, email: true } },
    },
  });

  return ok(rows);
}
