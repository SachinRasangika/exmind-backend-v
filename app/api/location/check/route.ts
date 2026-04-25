import { z } from "zod";
import { fail, ok } from "@/lib/http";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { computeDocumentStatus } from "@/lib/documents";
import { isEmailConfigured, sendLocationZoneAlertEmail } from "@/lib/email";

const payloadSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  radiusMeters: z.number().positive().max(10000).default(1000),
});

function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
) {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const r = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * r * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function POST(req: Request) {
  const user = await getCurrentUser(req);
  if (!user) {
    return fail("Unauthorized", 401);
  }

  const body = await req.json().catch(() => null);
  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid request payload", 400, parsed.error.flatten());
  }

  const userWorkspaceIds = (
    await prisma.workspaceMember.findMany({
      where: { userId: user.id },
      select: { workspaceId: true },
    })
  ).map((m) => m.workspaceId);

  const branches = await prisma.branch.findMany({
    include: {
      documents: {
        where: { workspaceId: { in: userWorkspaceIds } },
      },
    },
  });

  const alerts = branches
    .map((branch) => {
      const distance = haversineMeters(
        parsed.data.lat,
        parsed.data.lng,
        Number(branch.latitude),
        Number(branch.longitude),
      );

      const expiringDocs = branch.documents.filter(
        (d) => computeDocumentStatus(d.expiryDate) === "expiring",
      );

      return {
        branchId: branch.id,
        branchName: branch.name,
        distanceMeters: Math.round(distance),
        expiringDocuments: expiringDocs.map((d) => ({
          id: d.id,
          name: d.name,
          expiryDate: d.expiryDate,
        })),
      };
    })
    .filter((item) => item.distanceMeters <= parsed.data.radiusMeters && item.expiringDocuments.length > 0)
    .sort((a, b) => a.distanceMeters - b.distanceMeters);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const allExpiringDocumentIds = alerts.flatMap((a) => a.expiringDocuments.map((d) => d.id));
  const existingToday = allExpiringDocumentIds.length
    ? await prisma.notification.findMany({
        where: {
          userId: user.id,
          type: "location",
          createdAt: { gte: todayStart },
          relatedDocumentId: { in: allExpiringDocumentIds },
        },
        select: { relatedDocumentId: true },
      })
    : [];
  const existingDocIds = new Set(
    existingToday
      .map((n) => n.relatedDocumentId)
      .filter((id): id is string => typeof id == "string" && id.length > 0),
  );

  const sendEmails = isEmailConfigured();
  const me = await prisma.user.findUnique({
    where: { id: user.id },
    select: { email: true, settings: { select: { emailAlerts: true } } },
  });
  const shouldEmail = !!(sendEmails && me?.email && me.settings?.emailAlerts);

  const rows: Array<{
    userId: string;
    title: string;
    message: string;
    type: "location";
    relatedDocumentId: string;
    relatedBranchId: string;
  }> = [];
  const emailTasks: Array<Promise<unknown>> = [];
  let emailAttempts = 0;
  let emailSent = 0;
  let emailFailed = 0;

  for (const alert of alerts) {
    for (const doc of alert.expiringDocuments) {
      if (existingDocIds.has(doc.id)) continue;
      rows.push({
        userId: user.id,
        title: `Near renewal zone: ${alert.branchName}`,
        message: `You are near ${alert.branchName}. ${doc.name} may need renewal soon.`,
        type: "location",
        relatedDocumentId: doc.id,
        relatedBranchId: alert.branchId,
      });
      existingDocIds.add(doc.id);
      if (shouldEmail) {
        emailAttempts += 1;
        emailTasks.push(
          sendLocationZoneAlertEmail({
            to: me!.email,
            documentName: doc.name,
            branchName: alert.branchName,
          })
            .then(() => {
              emailSent += 1;
            })
            .catch((err) => {
              emailFailed += 1;
              console.error("Failed to send location zone email", {
                userId: user.id,
                documentId: doc.id,
                branchId: alert.branchId,
                error: err instanceof Error ? err.message : String(err),
              });
            }),
        );
      }
    }
  }

  if (rows.length > 0) {
    await prisma.notification.createMany({ data: rows });
  }
  if (emailTasks.length > 0) {
    await Promise.all(emailTasks);
  }

  return ok({
    alerts,
    createdNotifications: rows.length,
    emailConfigured: sendEmails,
    emailAttempts,
    emailSent,
    emailFailed,
  });
}
