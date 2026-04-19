import { fail, ok } from "@/lib/http";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser(req);
  if (!user) return fail("Unauthorized", 401);

  const { id } = await ctx.params;

  const row = await prisma.notification.findFirst({
    where: { id, userId: user.id },
  });
  if (!row) return fail("Not found", 404);

  const updated = await prisma.notification.update({
    where: { id },
    data: { read: true },
  });

  return ok(updated);
}
