import { z } from "zod";
import { fail, ok } from "@/lib/http";

const bodySchema = z.object({
  email: z.string().email(),
});

/**
 * Stub: production would enqueue a reset email. Always returns success to avoid email enumeration.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return fail("Invalid request payload", 400, parsed.error.flatten());

  return ok({
    ok: true,
    message:
      "If an account exists for that email, you will receive password reset instructions shortly.",
  });
}
