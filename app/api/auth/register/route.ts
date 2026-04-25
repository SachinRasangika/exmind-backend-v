import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { fail, ok } from "@/lib/http";
import { hashPassword, signAccessToken } from "@/lib/auth";
import { recordSessionWelcomeNotification } from "@/lib/session-welcome-notification";

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request payload", 400, parsed.error.flatten());
  }

  const { email, password, name } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return fail("Email already in use", 409);
  }

  const passwordHash = await hashPassword(password);

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      name,
      authProvider: "email",
      settings: {
        create: {},
      },
    },
    select: {
      id: true,
      email: true,
      name: true,
      createdAt: true,
    },
  });

  const workspace = await prisma.workspace.create({
    data: {
      name: `${name}'s Personal`,
      type: "personal",
      ownerId: user.id,
      members: {
        create: {
          userId: user.id,
          role: "owner",
        },
      },
    },
    select: { id: true },
  });

  await recordSessionWelcomeNotification(user.id, {
    displayName: name,
    isNewAccount: true,
  });

  const accessToken = signAccessToken({ userId: user.id, email: user.email });
  return ok({ user: { ...user, personalWorkspaceId: workspace.id }, accessToken }, 201);
}
