import { prisma } from "@/lib/prisma";
import { getBearerTokenFromHeaders, verifyAccessToken } from "@/lib/auth";

export async function getCurrentUser(req: Request) {
  const token = getBearerTokenFromHeaders(req.headers);
  if (!token) {
    return null;
  }

  const payload = verifyAccessToken(token);
  if (!payload) {
    return null;
  }

  return prisma.user.findUnique({
    where: { id: payload.userId },
  });
}
