import { Hono, type Context } from "hono";
import { z } from "zod";
import { requireBusiness } from "../middleware/auth";
import { requireAnyPermission } from "../lib/scope";
import { notFound } from "../lib/errors";
import { validate } from "../lib/validation";
import { recordEvent } from "../services/events";
import { INACTIVE_DAYS } from "../services/segments";
import { CUSTOMER_SEGMENTS, IST_OFFSET_MS } from "../../shared/domain";
import type { AppEnv } from "../types";

/**
 * WhatsApp "draft" messaging: the owner opens a pre-written message in their own WhatsApp (wa.me link)
 * and taps Send. No WhatsApp Business API, no per-message cost. Only customers who opted in to
 * WhatsApp from this business are ever returned.
 */
export const WA_KINDS = ["thanks", "reward_ready", "almost_there", "miss_you", "birthday", "offer"] as const;
const DAY = 86_400_000;

export interface WaRecipient {
  customerId: string;
  name: string;
  phone: string;
  programName: string;
  stamps: number;
  stampsRequired: number;
  nextReward: string | null;
  stampsToNext: number | null;
  readyReward: string | null;
  lastVisitAt: number | null;
  lastMessagedAt: number | null;
}

interface Row {
  customerId: string;
  name: string;
  phone: string;
  birthday: string | null;
  programId: string;
  programName: string;
  stamps: number;
  stampsRequired: number;
  visits: number;
  lastVisitAt: number | null;
  joinedAt: number;
  lastMessagedAt: number | null;
}

/** One row per opted-in customer: their most recently used card at this business. */
async function recipients(c: Context<AppEnv>, businessId: string, extraWhere = "", params: unknown[] = []) {
  const sql = `
    SELECT * FROM (
      SELECT c.id AS customerId, c.name AS name, c.phone AS phone, c.birthday AS birthday,
        lp.id AS programId, lp.name AS programName, cc.points_balance AS stamps, lp.stamps_required AS stampsRequired,
        cc.visits AS visits, cc.last_visit_at AS lastVisitAt, cc.created_at AS joinedAt,
        (SELECT max(e.created_at) FROM interaction_events e WHERE e.business_id = cc.business_id AND e.customer_id = c.id AND e.type = 'wa_draft_opened') AS lastMessagedAt,
        row_number() OVER (PARTITION BY c.id ORDER BY coalesce(cc.last_visit_at, cc.created_at) DESC) AS rn
      FROM customer_cards cc
      JOIN customers c ON c.id = cc.customer_id
      JOIN loyalty_programs lp ON lp.id = cc.program_id
      JOIN customer_consents cs ON cs.business_id = cc.business_id AND cs.customer_id = c.id AND cs.channel = 'whatsapp' AND cs.status = 'granted'
      WHERE cc.business_id = ? AND c.deleted_at IS NULL AND c.phone IS NOT NULL AND cc.status = 'active'
    ) WHERE rn = 1 ${extraWhere}
    ORDER BY name COLLATE NOCASE
    LIMIT 500`;
  const { results } = await c.env.DB.prepare(sql)
    .bind(businessId, ...params)
    .all<Row>();
  const programIds = [...new Set(results.map((r) => r.programId))];
  const rewards = programIds.length
    ? (
        await c.env.DB.prepare(
          `SELECT program_id AS programId, name, points_required AS pointsRequired FROM rewards WHERE is_active = 1 AND program_id IN (${programIds.map(() => "?").join(",")}) ORDER BY points_required`,
        )
          .bind(...programIds)
          .all<{ programId: string; name: string; pointsRequired: number }>()
      ).results
    : [];
  return results.map((r) => {
    const rs = rewards.filter((x) => x.programId === r.programId);
    const ready = rs.filter((x) => r.stamps >= x.pointsRequired).at(-1);
    const next = rs.find((x) => r.stamps < x.pointsRequired);
    const out: WaRecipient & { birthday: string | null; visits: number; joinedAt: number } = {
      customerId: r.customerId,
      name: r.name,
      phone: r.phone,
      programName: r.programName,
      stamps: r.stamps,
      stampsRequired: r.stampsRequired,
      nextReward: next?.name ?? null,
      stampsToNext: next ? next.pointsRequired - r.stamps : null,
      readyReward: ready?.name ?? null,
      lastVisitAt: r.lastVisitAt,
      lastMessagedAt: r.lastMessagedAt,
      birthday: r.birthday,
      visits: r.visits,
      joinedAt: r.joinedAt,
    };
    return out;
  });
}

const strip = ({ birthday: _b, visits: _v, joinedAt: _j, ...rest }: Awaited<ReturnType<typeof recipients>>[number]): WaRecipient => rest;

export const waDraftRoutes = new Hono<AppEnv>()
  /** Customers to message for a campaign, optionally filtered by segment. */
  .get(
    "/:businessId/wa/audience",
    requireBusiness({ permission: "campaigns.manage" }),
    validate("query", z.object({ segment: z.enum(CUSTOMER_SEGMENTS).optional() })),
    async (c) => {
      const { segment } = c.req.valid("query");
      const now = Date.now();
      let rows = await recipients(c, c.get("membership").business.id);
      if (segment === "new") rows = rows.filter((r) => r.joinedAt >= now - 30 * DAY);
      else if (segment === "regular") rows = rows.filter((r) => r.visits >= 3 && r.visits <= 9);
      else if (segment === "loyal") rows = rows.filter((r) => r.visits >= 10);
      else if (segment === "inactive") rows = rows.filter((r) => (r.lastVisitAt ?? r.joinedAt) < now - INACTIVE_DAYS * DAY);
      else if (segment === "reward_eligible") rows = rows.filter((r) => r.readyReward);
      return c.json({ recipients: rows.map(strip) });
    },
  )

  /** Today's to-do: birthdays, rewards waiting, and customers who stopped coming. Skips anyone messaged in the last 7 days. */
  .get("/:businessId/wa/today", requireBusiness({ permission: "campaigns.manage" }), async (c) => {
    const now = Date.now();
    const ist = new Date(now + IST_OFFSET_MS);
    const mmdd = `${String(ist.getUTCMonth() + 1).padStart(2, "0")}-${String(ist.getUTCDate()).padStart(2, "0")}`;
    const fresh = (await recipients(c, c.get("membership").business.id)).filter((r) => !r.lastMessagedAt || r.lastMessagedAt < now - 7 * DAY);
    return c.json({
      birthdays: fresh.filter((r) => r.birthday === mmdd).map(strip),
      rewardReady: fresh.filter((r) => r.readyReward).map(strip),
      missYou: fresh
        .filter((r) => !r.readyReward && r.birthday !== mmdd && (r.lastVisitAt ?? r.joinedAt) < now - INACTIVE_DAYS * DAY)
        .slice(0, 50)
        .map(strip),
    });
  })

  /** One customer (scanner "thank you" button, customer page). null when they haven't opted in. */
  .get("/:businessId/wa/customers/:customerId", requireBusiness(), async (c) => {
    requireAnyPermission(c, "points.issue", "customers.view", "campaigns.manage");
    const rows = await recipients(c, c.get("membership").business.id, "AND customerId = ?", [c.req.param("customerId")]);
    return c.json({ recipient: rows[0] ? strip(rows[0]) : null });
  })

  /** Record that the owner opened a draft (we can't know if it was actually sent). */
  .post(
    "/:businessId/wa/log",
    requireBusiness(),
    validate("json", z.object({ customerId: z.string().uuid(), kind: z.enum(WA_KINDS) })),
    async (c) => {
      requireAnyPermission(c, "points.issue", "customers.view", "campaigns.manage");
      const { customerId, kind } = c.req.valid("json");
      const businessId = c.get("membership").business.id;
      const ok = await recipients(c, businessId, "AND customerId = ?", [customerId]);
      if (!ok.length) throw notFound("Customer");
      await recordEvent(c.get("db"), { businessId, type: "wa_draft_opened", channel: "whatsapp", customerId, actorUserId: c.get("user")?.id, metadata: { kind } });
      return c.json({ ok: true });
    },
  );
