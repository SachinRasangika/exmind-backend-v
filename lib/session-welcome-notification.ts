import { prisma } from "@/lib/prisma";

/**
 * In-app notification row so the Alerts tab shows a welcome + server timestamp after auth.
 */
export async function recordSessionWelcomeNotification(
  userId: string,
  opts: { displayName: string | null; isNewAccount: boolean },
) {
  const now = new Date();
  const iso = now.toISOString();
  const name = opts.displayName?.trim();
  const greeting = name ? `Hi ${name}. ` : "";
  const title = opts.isNewAccount ? "Welcome to Exmind" : "Welcome back";
  const message = opts.isNewAccount
    ? `${greeting}Your account is ready. Signed in at ${iso}.`
    : `${greeting}Signed in at ${iso}.`;

  await prisma.notification.create({
    data: {
      userId,
      title,
      message,
      type: "success",
      read: false,
    },
  });
}
