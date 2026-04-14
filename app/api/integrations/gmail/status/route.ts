import { fail, ok } from "@/lib/http";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const user = await getCurrentUser(req);
  if (!user) return fail("Unauthorized", 401);

  const integration = await prisma.gmailIntegration.findUnique({
    where: { userId: user.id },
  });
  if (!integration) {
    return ok({ connected: false });
  }
  return ok({
    connected: true,
    email: integration.email,
    scope: integration.scope,
    expiryDate: integration.expiryDate.toISOString(),
    connectedAt: integration.connectedAt.toISOString(),
    lastSyncedAt: integration.lastSyncedAt?.toISOString() ?? null,
  });
}

export async function DELETE(req: Request) {
  const user = await getCurrentUser(req);
  if (!user) return fail("Unauthorized", 401);

  await prisma.gmailIntegration.deleteMany({ where: { userId: user.id } });
  return ok({ connected: false });
}
