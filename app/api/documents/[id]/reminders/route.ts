import { ReminderType } from "@prisma/client";
import { z } from "zod";
import { fail, ok } from "@/lib/http";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";

const itemSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("default"),
    daysBefore: z.number().int().min(0).max(365),
    enabled: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("custom"),
    daysBefore: z.number().int().min(0).max(365),
    time: z.string().regex(/^\d{2}:\d{2}$/),
    enabled: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("location"),
    locationRadiusMeters: z.number().int().min(100).max(1000),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    locationPlaceName: z.string().max(512).optional(),
    enabled: z.boolean().optional(),
  }),
]);

const putBodySchema = z.object({
  items: z.array(itemSchema),
});

async function assertDocumentAccess(
  documentId: string,
  userId: string,
  needEdit: boolean,
): Promise<{ document: NonNullable<Awaited<ReturnType<typeof prisma.document.findUnique>>> } | { res: Response }> {
  const document = await prisma.document.findUnique({ where: { id: documentId } });
  if (!document) return { res: fail("Document not found", 404) };

  const member = await prisma.workspaceMember.findFirst({
    where: {
      workspaceId: document.workspaceId,
      userId,
      ...(needEdit ? { role: { in: ["owner", "admin", "editor"] } } : {}),
    },
  });
  if (!member) return { res: fail("Forbidden", 403) };
  return { document };
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser(req);
  if (!user) return fail("Unauthorized", 401);

  const { id } = await ctx.params;
  const access = await assertDocumentAccess(id, user.id, false);
  if ("res" in access) return access.res;

  const reminders = await prisma.reminder.findMany({
    where: { documentId: id },
    orderBy: { createdAt: "asc" },
  });

  return ok({ items: reminders });
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser(req);
  if (!user) return fail("Unauthorized", 401);

  const { id } = await ctx.params;
  const access = await assertDocumentAccess(id, user.id, true);
  if ("res" in access) return access.res;

  const body = await req.json().catch(() => null);
  const parsed = putBodySchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request payload", 400, parsed.error.flatten());
  }

  await prisma.reminder.deleteMany({ where: { documentId: id } });

  const rows: {
    documentId: string;
    type: ReminderType;
    daysBefore: number | null;
    time: string | null;
    locationRadiusMeters: number | null;
    locationLatitude: number | null;
    locationLongitude: number | null;
    locationPlaceName: string | null;
    enabled: boolean;
  }[] = [];

  for (const item of parsed.data.items) {
    const enabled = item.enabled !== false;
    if (!enabled) continue;

    if (item.type === "default") {
      rows.push({
        documentId: id,
        type: ReminderType.default,
        daysBefore: item.daysBefore,
        time: null,
        locationRadiusMeters: null,
        locationLatitude: null,
        locationLongitude: null,
        locationPlaceName: null,
        enabled: true,
      });
    } else if (item.type === "custom") {
      rows.push({
        documentId: id,
        type: ReminderType.custom,
        daysBefore: item.daysBefore,
        time: item.time,
        locationRadiusMeters: null,
        locationLatitude: null,
        locationLongitude: null,
        locationPlaceName: null,
        enabled: true,
      });
    } else {
      rows.push({
        documentId: id,
        type: ReminderType.location,
        daysBefore: null,
        time: null,
        locationRadiusMeters: item.locationRadiusMeters,
        locationLatitude: item.latitude ?? null,
        locationLongitude: item.longitude ?? null,
        locationPlaceName: item.locationPlaceName ?? null,
        enabled: true,
      });
    }
  }

  if (rows.length > 0) {
    await prisma.reminder.createMany({ data: rows });
  }

  const reminders = await prisma.reminder.findMany({
    where: { documentId: id },
    orderBy: { createdAt: "asc" },
  });

  return ok({ items: reminders });
}
