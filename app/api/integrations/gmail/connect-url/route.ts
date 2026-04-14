import { fail, ok } from "@/lib/http";
import { buildGoogleConsentUrl, signGmailState } from "@/lib/gmail_oauth";
import { getCurrentUser } from "@/lib/session";

export async function GET(req: Request) {
  const user = await getCurrentUser(req);
  if (!user) return fail("Unauthorized", 401);

  try {
    const state = signGmailState({ userId: user.id });
    const url = buildGoogleConsentUrl(state);
    return ok({ url });
  } catch (e) {
    return fail("Gmail OAuth not configured", 500, String(e));
  }
}
