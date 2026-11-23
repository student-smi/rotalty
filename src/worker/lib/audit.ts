import type { Context } from "hono";
import { auditLogs } from "../db/schema";
import type { AppEnv } from "../types";

interface AuditEntry {
  businessId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}

/** Returns an insert statement so callers can include it in the same `db.batch()` as the change it records. */
export function auditInsert(c: Context<AppEnv>, entry: AuditEntry) {
  return c.get("db").insert(auditLogs).values({
    businessId: entry.businessId ?? null,
    actorUserId: c.get("user")?.id ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    metadata: entry.metadata,
    ipAddress: c.req.header("cf-connecting-ip") ?? null,
    userAgent: c.req.header("user-agent")?.slice(0, 300) ?? null,
  });
}
