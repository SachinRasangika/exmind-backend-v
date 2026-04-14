import jwt from "jsonwebtoken";

type GmailOAuthState = {
  userId: string;
};

const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function jwtSecret() {
  return requiredEnv("JWT_SECRET");
}

export function getGoogleOAuthConfig() {
  return {
    clientId: requiredEnv("GOOGLE_CLIENT_ID"),
    clientSecret: requiredEnv("GOOGLE_CLIENT_SECRET"),
    redirectUri: requiredEnv("GOOGLE_REDIRECT_URI"),
    scope: GMAIL_SCOPE,
  };
}

export function signGmailState(payload: GmailOAuthState) {
  return jwt.sign(payload, jwtSecret(), {
    algorithm: "HS256",
    expiresIn: "10m",
    issuer: "exmind",
    audience: "gmail-oauth-state",
  });
}

export function verifyGmailState(token: string): GmailOAuthState | null {
  try {
    const decoded = jwt.verify(token, jwtSecret(), {
      algorithms: ["HS256"],
      issuer: "exmind",
      audience: "gmail-oauth-state",
    });
    if (!decoded || typeof decoded !== "object") return null;
    const userId = (decoded as { userId?: unknown }).userId;
    if (typeof userId !== "string" || !userId) return null;
    return { userId };
  } catch {
    return null;
  }
}

export function buildGoogleConsentUrl(state: string) {
  const { clientId, redirectUri, scope } = getGoogleOAuthConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope,
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeCodeForTokens(code: string) {
  const { clientId, clientSecret, redirectUri } = getGoogleOAuthConfig();
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(
      typeof data.error_description === "string"
        ? data.error_description
        : "Failed token exchange",
    );
  }
  return data;
}

export async function fetchGoogleUserEmail(accessToken: string) {
  const res = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/profile",
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error("Failed to read Gmail profile");
  }
  const emailAddress = data.emailAddress;
  if (typeof emailAddress !== "string" || !emailAddress) {
    throw new Error("Gmail profile email not found");
  }
  return emailAddress;
}
