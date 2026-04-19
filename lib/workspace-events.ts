import type { NotificationType } from "@prisma/client";
import { prisma } from "@/lib/prisma";

async function notifyWorkspacePeers(args: {
  workspaceId: string;
  excludeUserId: string;
  title: string;
  message: string;
  type: NotificationType;
  relatedDocumentId?: string | null;
}) {
  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId: args.workspaceId, userId: { not: args.excludeUserId } },
    select: { userId: true },
  });
  if (members.length === 0) return;
  await prisma.notification.createMany({
    data: members.map((m) => ({
      userId: m.userId,
      title: args.title,
      message: args.message,
      type: args.type,
      relatedDocumentId: args.relatedDocumentId ?? null,
    })),
  });
}

export async function onDocumentCreated(args: {
  workspaceId: string;
  actorUserId: string;
  documentId: string;
  name: string;
}) {
  await prisma.activityFeed.create({
    data: {
      workspaceId: args.workspaceId,
      userId: args.actorUserId,
      action: "Document added",
      target: args.name,
      type: "document_added",
    },
  });
  await prisma.auditLog.create({
    data: {
      workspaceId: args.workspaceId,
      userId: args.actorUserId,
      action: "document_updated",
      targetType: "document",
      targetId: args.documentId,
      details: `Created document "${args.name}"`,
      metadata: { created: true },
    },
  });
  await notifyWorkspacePeers({
    workspaceId: args.workspaceId,
    excludeUserId: args.actorUserId,
    title: "New document",
    message: `A document "${args.name}" was added to the workspace.`,
    type: "workspace",
    relatedDocumentId: args.documentId,
  });
}

export async function onDocumentUpdated(args: {
  workspaceId: string;
  actorUserId: string;
  documentId: string;
  name: string;
}) {
  await prisma.activityFeed.create({
    data: {
      workspaceId: args.workspaceId,
      userId: args.actorUserId,
      action: "Document updated",
      target: args.name,
      type: "document_edited",
    },
  });
  await prisma.auditLog.create({
    data: {
      workspaceId: args.workspaceId,
      userId: args.actorUserId,
      action: "document_updated",
      targetType: "document",
      targetId: args.documentId,
      details: `Updated document "${args.name}"`,
    },
  });
  await notifyWorkspacePeers({
    workspaceId: args.workspaceId,
    excludeUserId: args.actorUserId,
    title: "Document updated",
    message: `"${args.name}" was updated.`,
    type: "workspace",
    relatedDocumentId: args.documentId,
  });
}

export async function onDocumentRenewed(args: {
  workspaceId: string;
  actorUserId: string;
  documentId: string;
  name: string;
}) {
  await prisma.activityFeed.create({
    data: {
      workspaceId: args.workspaceId,
      userId: args.actorUserId,
      action: "Document renewed",
      target: args.name,
      type: "document_renewed",
    },
  });
  await prisma.auditLog.create({
    data: {
      workspaceId: args.workspaceId,
      userId: args.actorUserId,
      action: "document_renewed",
      targetType: "document",
      targetId: args.documentId,
      details: `Marked renewed: "${args.name}"`,
    },
  });
  await notifyWorkspacePeers({
    workspaceId: args.workspaceId,
    excludeUserId: args.actorUserId,
    title: "Document renewed",
    message: `"${args.name}" was marked as renewed.`,
    type: "success",
    relatedDocumentId: args.documentId,
  });
}

export async function onDocumentDeleted(args: {
  workspaceId: string;
  actorUserId: string;
  documentId: string;
  name: string;
}) {
  await prisma.activityFeed.create({
    data: {
      workspaceId: args.workspaceId,
      userId: args.actorUserId,
      action: "Document deleted",
      target: args.name,
      type: "document_deleted",
    },
  });
  await prisma.auditLog.create({
    data: {
      workspaceId: args.workspaceId,
      userId: args.actorUserId,
      action: "document_deleted",
      targetType: "document",
      targetId: args.documentId,
      details: `Deleted document "${args.name}"`,
    },
  });
  await notifyWorkspacePeers({
    workspaceId: args.workspaceId,
    excludeUserId: args.actorUserId,
    title: "Document removed",
    message: `"${args.name}" was deleted from the workspace.`,
    type: "workspace",
    relatedDocumentId: null,
  });
}

export async function onExportGenerated(args: {
  workspaceId: string;
  actorUserId: string;
  rowCount: number;
}) {
  await prisma.auditLog.create({
    data: {
      workspaceId: args.workspaceId,
      userId: args.actorUserId,
      action: "export_generated",
      targetType: "workspace",
      targetId: args.workspaceId,
      details: `Exported ${args.rowCount} document row(s) as CSV`,
    },
  });
}
