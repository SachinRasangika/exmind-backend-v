import { DocumentStatus } from "@prisma/client";

const DAY_MS = 24 * 60 * 60 * 1000;

export function computeDocumentStatus(expiryDate: Date): DocumentStatus {
  const now = new Date();
  const expiry = new Date(expiryDate);
  const daysLeft = Math.ceil((expiry.getTime() - now.getTime()) / DAY_MS);

  if (daysLeft <= 0) {
    return "expired";
  }

  if (daysLeft <= 30) {
    return "expiring";
  }

  return "active";
}
