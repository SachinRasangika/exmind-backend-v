import { fail, ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { isEmailConfigured, sendExpiryReminderEmail } from "@/lib/email";

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export async function POST(req: Request) {
  const cronKey = process.env.NOTIFICATION_CRON_KEY;
  if (!cronKey) {
    return fail("NOTIFICATION_CRON_KEY is not configured", 500);
  }
  const provided = req.headers.get("x-notification-key");
  if (provided != cronKey) {
    return fail("Unauthorized", 401);
  }

  const now = new Date();
  const tomorrow = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const dayAfter = new Date(tomorrow);
  dayAfter.setDate(dayAfter.getDate() + 1);
  const todayStart = startOfDay(now);

  const docs = await prisma.document.findMany({
    where: {
      expiryDate: { gte: tomorrow, lt: dayAfter },
    },
    select: {
      id: true,
      name: true,
      workspaceId: true,
    },
  });

  if (docs.length == 0) {
    return ok({ processedDocuments: 0, createdNotifications: 0 });
  }

  const workspaceIds = [...new Set(docs.map((d) => d.workspaceId))];
  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId: { in: workspaceIds } },
    select: { workspaceId: true, userId: true },
  });
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(members.map((m) => m.userId))] } },
    select: {
      id: true,
      email: true,
      settings: { select: { emailAlerts: true } },
    },
  });
  const userEmailMap = new Map(
    users.map((u) => [u.id, { email: u.email, emailAlerts: u.settings?.emailAlerts ?? false }]),
  );
  const memberMap = new Map<string, string[]>();
  for (const m of members) {
    const arr = memberMap.get(m.workspaceId) ?? [];
    arr.push(m.userId);
    memberMap.set(m.workspaceId, arr);
  }

  const existing = await prisma.notification.findMany({
    where: {
      type: "expiry",
      createdAt: { gte: todayStart },
      relatedDocumentId: { in: docs.map((d) => d.id) },
      title: "Document expires tomorrow",
    },
    select: { userId: true, relatedDocumentId: true },
  });
  const existingKeys = new Set(
    existing
      .filter((e) => e.relatedDocumentId != null)
      .map((e) => `${e.userId}:${e.relatedDocumentId}`),
  );

  const rows: Array<{
    userId: string;
    title: string;
    message: string;
    type: "expiry";
    relatedDocumentId: string;
  }> = [];
  const emailTasks: Array<Promise<unknown>> = [];
  let emailAttempts = 0;
  let emailSent = 0;
  let emailFailed = 0;
  const sendEmails = isEmailConfigured();

  for (const d of docs) {
    const recipients = memberMap.get(d.workspaceId) ?? [];
    for (const userId of recipients) {
      const key = `${userId}:${d.id}`;
      if (existingKeys.has(key)) continue;
      rows.push({
        userId,
        title: "Document expires tomorrow",
        message: `You have ${d.name} expiring on tomorrow.`,
        type: "expiry",
        relatedDocumentId: d.id,
      });
      if (sendEmails) {
        const recipient = userEmailMap.get(userId);
        if (recipient?.emailAlerts && recipient.email) {
          emailAttempts += 1;
          emailTasks.push(
            sendExpiryReminderEmail({
              to: recipient.email,
              documentName: d.name,
              expiryDate: tomorrow.toISOString().slice(0, 10),
            })
              .then(() => {
                emailSent += 1;
              })
              .catch((err) => {
                emailFailed += 1;
                console.error("Failed to send expiry reminder email", {
                  userId,
                  documentId: d.id,
                  error: err instanceof Error ? err.message : String(err),
                });
              }),
          );
        }
      }
      existingKeys.add(key);
    }
  }

  if (rows.length > 0) {
    await prisma.notification.createMany({ data: rows });
  }
  if (emailTasks.length > 0) {
    await Promise.all(emailTasks);
  }

  return ok({
    processedDocuments: docs.length,
    createdNotifications: rows.length,
    emailConfigured: sendEmails,
    emailAttempts,
    emailSent,
    emailFailed,
    targetDate: tomorrow.toISOString().slice(0, 10),
  });
}
