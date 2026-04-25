import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { fail, ok } from "@/lib/http";
import { signAccessToken, verifyPassword } from "@/lib/auth";
import { recordSessionWelcomeNotification } from "@/lib/session-welcome-notification";
import { isEmailConfigured, sendLoginWelcomeEmail } from "@/lib/email";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request payload", 400, parsed.error.flatten());
  }

  const { email, password } = parsed.data;
  const user = await prisma.user.findUnique({
    where: { email },
    include: {
      workspaceMembers: {
        include: {
          workspace: true,
        },
      },
    },
  });

  if (!user || !user.passwordHash) {
    return fail("Invalid email or password", 401);
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return fail("Invalid email or password", 401);
  }

  await recordSessionWelcomeNotification(user.id, {
    displayName: user.name,
    isNewAccount: false,
  });
  if (isEmailConfigured()) {
    void sendLoginWelcomeEmail({
      to: user.email,
      displayName: user.name,
    }).catch((err) => {
      console.error("Failed to send login welcome email", {
        userId: user.id,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  const accessToken = signAccessToken({ userId: user.id, email: user.email });
  return ok({
    accessToken,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      workspaces: user.workspaceMembers.map((m) => ({
        id: m.workspace.id,
        name: m.workspace.name,
        role: m.role,
      })),
    },
  });
}
