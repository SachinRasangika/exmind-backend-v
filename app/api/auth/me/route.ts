import { fail, ok } from "@/lib/http";
import { getCurrentUser } from "@/lib/session";

export async function GET(req: Request) {
  const user = await getCurrentUser(req);
  if (!user) {
    return fail("Unauthorized", 401);
  }

  return ok({
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    authProvider: user.authProvider,
    biometricEnabled: user.biometricEnabled,
    appLockEnabled: user.appLockEnabled,
  });
}
