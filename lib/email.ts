import nodemailer from "nodemailer";

type ExpiryEmailPayload = {
  to: string;
  documentName: string;
  expiryDate: string;
};
type WelcomeEmailPayload = {
  to: string;
  displayName?: string | null;
};
type LocationZoneEmailPayload = {
  to: string;
  documentName: string;
  branchName: string;
};

function readSmtpConfig() {
  const host = process.env.SMTP_HOST;
  const portRaw = process.env.SMTP_PORT;
  const secureRaw = process.env.SMTP_SECURE;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.EMAIL_FROM;

  if (!host || !portRaw || !user || !pass || !from) {
    return null;
  }

  const port = Number(portRaw);
  if (Number.isNaN(port)) {
    return null;
  }

  const secure =
    secureRaw == null ? port == 465 : secureRaw.toLowerCase() == "true";

  return { host, port, secure, user, pass, from };
}

export function isEmailConfigured() {
  return readSmtpConfig() != null;
}

async function sendEmail(payload: {
  to: string;
  subject: string;
  text: string;
  html: string;
}) {
  const cfg = readSmtpConfig();
  if (!cfg) {
    throw new Error("SMTP is not configured");
  }

  const transport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: {
      user: cfg.user,
      pass: cfg.pass,
    },
  });

  await transport.sendMail({
    from: cfg.from,
    to: payload.to,
    subject: payload.subject,
    text: payload.text,
    html: payload.html,
  });
}

export async function sendExpiryReminderEmail(payload: ExpiryEmailPayload) {
  await sendEmail({
    to: payload.to,
    subject: "Document expires tomorrow",
    text: `Reminder: "${payload.documentName}" expires on ${payload.expiryDate}.`,
    html: `<p>Reminder: <strong>${payload.documentName}</strong> expires on <strong>${payload.expiryDate}</strong>.</p>`,
  });
}

export async function sendLoginWelcomeEmail(payload: WelcomeEmailPayload) {
  const greeting = payload.displayName?.trim() || "there";
  await sendEmail({
    to: payload.to,
    subject: "Welcome back to ExMind",
    text: `Hi ${greeting}, you have successfully signed in to ExMind.`,
    html: `<p>Hi <strong>${greeting}</strong>, you have successfully signed in to ExMind.</p>`,
  });
}

export async function sendLocationZoneAlertEmail(payload: LocationZoneEmailPayload) {
  await sendEmail({
    to: payload.to,
    subject: "You are near a renewal zone",
    text: `You are near ${payload.branchName}. ${payload.documentName} may need renewal soon. Open ExMind to review your alert.`,
    html: `<p>You are near <strong>${payload.branchName}</strong>. <strong>${payload.documentName}</strong> may need renewal soon.</p><p>Open ExMind to review your alert.</p>`,
  });
}
