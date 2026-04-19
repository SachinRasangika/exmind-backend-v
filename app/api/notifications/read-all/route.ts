import { fail, ok } from "@/lib/http";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function PUT(req: Request) {
  const user = await getCurrentUser(req);
  if (!user) return fail("Unauthorized", 401);

  const result = await prisma.notification.updateMany({
    where: { userId: user.id, read: false },
    data: { read: true },
  });

  return ok({ updated: result.count });
}
