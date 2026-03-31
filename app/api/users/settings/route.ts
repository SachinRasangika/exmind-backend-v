import { z } from "zod";
import { fail, ok } from "@/lib/http";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";

const settingsSchema = z.object({
  smartReminders: z.boolean().optional(),
  emailAlerts: z.boolean().optional(),
  pushNotifications: z.boolean().optional(),
  locationServices: z.boolean().optional(),
  backgroundAlerts: z.boolean().optional(),
});

export async function GET(req: Request) {
  const user = await getCurrentUser(req);
  if (!user) {
    return fail("Unauthorized", 401);
  }

  const settings = await prisma.userSettings.findUnique({
    where: { userId: user.id },
  });

  return ok(settings ?? {});
}

export async function PUT(req: Request) {
  const user = await getCurrentUser(req);
  if (!user) {
    return fail("Unauthorized", 401);
  }

  const body = await req.json().catch(() => null);
  const parsed = settingsSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request payload", 400, parsed.error.flatten());
  }

  const settings = await prisma.userSettings.upsert({
    where: { userId: user.id },
    update: parsed.data,
    create: {
      userId: user.id,
      ...parsed.data,
    },
  });

  return ok(settings);
}
