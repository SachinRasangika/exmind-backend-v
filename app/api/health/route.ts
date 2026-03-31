import { ok } from "@/lib/http";

export async function GET() {
  return ok({
    service: "smart-expiry-backend",
    status: "ok",
    timestamp: new Date().toISOString(),
  });
}
