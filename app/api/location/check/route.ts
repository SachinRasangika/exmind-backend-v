import { z } from "zod";
import { fail, ok } from "@/lib/http";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { computeDocumentStatus } from "@/lib/documents";

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

  return ok({ alerts });
}
