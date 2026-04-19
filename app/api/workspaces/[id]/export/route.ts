import { NextResponse } from "next/server";
import { fail } from "@/lib/http";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { computeDocumentStatus } from "@/lib/documents";
import { onExportGenerated } from "@/lib/workspace-events";

function csvEscape(s: string) {
  if (s.includes('"') || s.includes(",") || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser(req);
  if (!user) return fail("Unauthorized", 401);

  const { id: workspaceId } = await ctx.params;

  const member = await prisma.workspaceMember.findFirst({
    where: { workspaceId, userId: user.id },
  });
  if (!member) return fail("Forbidden", 403);

  const docs = await prisma.document.findMany({
    where: { workspaceId },
    orderBy: { expiryDate: "asc" },
  });

  const header = ["Name", "Type", "Status", "ExpiryDate", "Notes"];
  const lines = [header.join(",")];
  for (const d of docs) {
    const status = computeDocumentStatus(d.expiryDate);
    lines.push(
      [
        csvEscape(d.name),
        csvEscape(d.type),
        csvEscape(status),
        csvEscape(d.expiryDate.toISOString().split("T")[0] ?? ""),
        csvEscape((d.notes ?? "").replace(/\r?\n/g, " ")),
      ].join(","),
    );
  }

  const csv = lines.join("\r\n") + "\r\n";

  await onExportGenerated({
    workspaceId,
    actorUserId: user.id,
    rowCount: docs.length,
  });

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="exmind-documents-${workspaceId.slice(0, 8)}.csv"`,
    },
  });
}
