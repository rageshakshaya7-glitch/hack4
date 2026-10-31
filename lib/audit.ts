import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";

export interface AuditLogParams {
  userId?: string | null;
  action: string;
  entity: string;
  entityId: string;
  meta?: Record<string, any>;
}

export async function logAudit(
  params: AuditLogParams,
  tx?: Prisma.TransactionClient
): Promise<void> {
  const db = tx ?? prisma;
  try {
    await db.auditLog.create({
      data: {
        userId: params.userId ?? null,
        action: params.action,
        entity: params.entity,
        entityId: params.entityId,
        meta: JSON.stringify(params.meta ?? {}),
      },
    });
  } catch (err) {
    console.error("Failed to write audit log:", err);
  }
}

