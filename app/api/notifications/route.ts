import { fail, ok } from "@/lib/http";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const user = await getCurrentUser(req);
  if (!user) return fail("Unauthorized", 401);

  const url = new URL(req.url);
  const take = Math.min(Number(url.searchParams.get("limit") ?? "80"), 200);

  const rows = await prisma.notification.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: Number.isFinite(take) && take > 0 ? take : 80,
  });

  return ok(rows);
}
