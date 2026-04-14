import { prisma } from "@/lib/prisma";
import {
  exchangeCodeForTokens,
  fetchGoogleUserEmail,
  verifyGmailState,
} from "@/lib/gmail_oauth";

function renderHtml(title: string, message: string) {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; padding: 24px;"><h2>${title}</h2><p>${message}</p><p>You can close this tab and return to Exmind.</p></body></html>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return renderHtml("Gmail connection failed", `Google returned: ${error}`);
  }
  if (!code || !state) {
    return renderHtml("Gmail connection failed", "Missing OAuth code or state.");
  }

  const parsed = verifyGmailState(state);
  if (!parsed) {
    return renderHtml("Gmail connection failed", "OAuth state is invalid or expired.");
  }

  try {
    const tokenData = await exchangeCodeForTokens(code);
    const accessToken = tokenData.access_token;
    if (typeof accessToken !== "string" || !accessToken) {
      throw new Error("Missing access token");
    }
    const refreshToken =
      typeof tokenData.refresh_token === "string"
        ? tokenData.refresh_token
        : null;
    const scope = typeof tokenData.scope === "string" ? tokenData.scope : "";
    const tokenType =
      typeof tokenData.token_type === "string" ? tokenData.token_type : "Bearer";
    const expiresIn =
      typeof tokenData.expires_in === "number" ? tokenData.expires_in : 3600;
    const expiryDate = new Date(Date.now() + expiresIn * 1000);
    const email = await fetchGoogleUserEmail(accessToken);

    const existing = await prisma.gmailIntegration.findUnique({
      where: { userId: parsed.userId },
      select: { refreshToken: true },
    });

    await prisma.gmailIntegration.upsert({
      where: { userId: parsed.userId },
      create: {
        userId: parsed.userId,
        email,
        accessToken,
        refreshToken,
        tokenType,
        scope,
        expiryDate,
      },
      update: {
        email,
        accessToken,
        refreshToken: refreshToken ?? existing?.refreshToken ?? null,
        tokenType,
        scope,
        expiryDate,
      },
    });

    return renderHtml("Gmail connected", `Connected account: ${email}`);
  } catch (e) {
    return renderHtml("Gmail connection failed", String(e));
  }
}
