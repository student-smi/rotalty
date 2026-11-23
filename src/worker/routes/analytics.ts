import { Hono } from "hono";
import { z } from "zod";
import { requireBusiness } from "../middleware/auth";
import { AppError } from "../lib/errors";
import { validate } from "../lib/validation";
import { getPlanForBusiness } from "../services/plans";
import { IST_OFFSET_MS, istDateString, istDayStart } from "../../shared/domain";
import type { AppEnv } from "../types";

const DAY_MS = 86_400_000;
/** SQL expression turning a ms timestamp column into an IST `YYYY-MM-DD` string. */
const istDay = (col: string) => `date((${col} + ${IST_OFFSET_MS}) / 1000, 'unixepoch')`;

function weekStart(day: string) {
  const d = new Date(`${day}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(d.getTime() - dow * DAY_MS).toISOString().slice(0, 10);
}

async function first<T>(stmt: D1PreparedStatement) {
  return (await stmt.first<T>()) as T;
}

async function all<T>(stmt: D1PreparedStatement) {
  return (await stmt.all<T>()).results;
}

export const analyticsRoutes = new Hono<AppEnv>().get(
  "/:businessId/analytics/overview",
  requireBusiness({ permission: "analytics.view" }),
  validate("query", z.object({ days: z.coerce.number().pipe(z.union([z.literal(7), z.literal(30), z.literal(90)])).default(30) })),
  async (c) => {
    const { days } = c.req.valid("query");
    const db = c.get("db");
    const D1 = c.env.DB;
    const bid = c.get("membership").business.id;
    const { plan } = await getPlanForBusiness(db, bid);
    const advancedAvailable = plan.limits.advancedAnalytics;
    if (days === 90 && !advancedAvailable) {
      throw new AppError(403, "PLAN_LIMIT_REACHED", `90-day analytics are not included in the ${plan.name} plan. Upgrade to use it.`, {
        limit: "advancedAnalytics",
      });
    }

    const end = new Date();
    const start = new Date(istDayStart(end).getTime() - (days - 1) * DAY_MS).getTime();

    const [customersRow, newRow, visitsRow, returningRow, unlockedRow, redeemedRow, retentionRow, dailyRows] = await Promise.all([
      first<{ n: number }>(D1.prepare("SELECT count(DISTINCT customer_id) AS n FROM customer_cards WHERE business_id = ?1").bind(bid)),
      first<{ n: number }>(
        D1.prepare(
          "SELECT count(*) AS n FROM (SELECT customer_id FROM customer_cards WHERE business_id = ?1 GROUP BY customer_id HAVING min(created_at) >= ?2)",
        ).bind(bid, start),
      ),
      first<{ visits: number; points: number | null }>(
        D1.prepare(
          "SELECT count(*) AS visits, sum(points) AS points FROM stamp_transactions WHERE business_id = ?1 AND type = 'earn' AND created_at >= ?2",
        ).bind(bid, start),
      ),
      first<{ n: number }>(
        D1.prepare(
          `SELECT count(*) AS n FROM (SELECT customer_id FROM stamp_transactions WHERE business_id = ?1 AND type = 'earn'
           GROUP BY customer_id HAVING count(*) >= 2 AND max(created_at) >= ?2)`,
        ).bind(bid, start),
      ),
      first<{ n: number }>(
        D1.prepare("SELECT count(*) AS n FROM interaction_events WHERE business_id = ?1 AND type = 'reward_unlocked' AND created_at >= ?2").bind(bid, start),
      ),
      first<{ n: number }>(D1.prepare("SELECT count(*) AS n FROM reward_redemptions WHERE business_id = ?1 AND created_at >= ?2").bind(bid, start)),
      first<{ repeat: number; any: number }>(
        D1.prepare(
          `SELECT sum(CASE WHEN n >= 2 THEN 1 ELSE 0 END) AS repeat, count(*) AS any FROM
           (SELECT customer_id, count(*) AS n FROM stamp_transactions WHERE business_id = ?1 AND type = 'earn' GROUP BY customer_id)`,
        ).bind(bid),
      ),
      all<{ day: string; n: number }>(
        D1.prepare(
          `SELECT ${istDay("created_at")} AS day, count(*) AS n FROM stamp_transactions
           WHERE business_id = ?1 AND type = 'earn' AND created_at >= ?2 GROUP BY day`,
        ).bind(bid, start),
      ),
    ]);

    const byDay = new Map(dailyRows.map((r) => [r.day, r.n]));
    const daily: { date: string; visits: number }[] = [];
    for (let i = 0; i < days; i++) {
      const date = istDateString(new Date(start + i * DAY_MS));
      daily.push({ date, visits: byDay.get(date) ?? 0 });
    }
    const weeklyMap = new Map<string, number>();
    const monthlyMap = new Map<string, number>();
    for (const d of daily) {
      weeklyMap.set(weekStart(d.date), (weeklyMap.get(weekStart(d.date)) ?? 0) + d.visits);
      monthlyMap.set(d.date.slice(0, 7), (monthlyMap.get(d.date.slice(0, 7)) ?? 0) + d.visits);
    }

    const any = retentionRow?.any ?? 0;
    const basic = {
      totalCustomers: customersRow?.n ?? 0,
      newCustomers: newRow?.n ?? 0,
      returningCustomers: returningRow?.n ?? 0,
      totalVisits: visitsRow?.visits ?? 0,
      pointsIssued: visitsRow?.points ?? 0,
      rewardsUnlocked: unlockedRow?.n ?? 0,
      rewardsRedeemed: redeemedRow?.n ?? 0,
      retentionRate: any ? Math.round(((retentionRow?.repeat ?? 0) / any) * 1000) / 10 : 0,
      daily,
      weekly: [...weeklyMap].map(([weekStart, visits]) => ({ weekStart, visits })),
      monthly: [...monthlyMap].map(([month, visits]) => ({ month, visits })),
    };

    if (!advancedAvailable) {
      return c.json({ days, range: { start: new Date(start), end }, ...basic, advancedAvailable: false, advanced: null });
    }

    const [programs, channels, events, failures, firstJoins, activeDays] = await Promise.all([
      all<{ id: string; name: string; status: string; cards: number; visits: number; redemptions: number }>(
        D1.prepare(
          `SELECT p.id, p.name, p.status,
             (SELECT count(*) FROM customer_cards cc WHERE cc.program_id = p.id) AS cards,
             (SELECT count(*) FROM stamp_transactions t WHERE t.program_id = p.id AND t.type = 'earn' AND t.created_at >= ?2) AS visits,
             (SELECT count(*) FROM reward_redemptions r WHERE r.program_id = p.id AND r.created_at >= ?2) AS redemptions
           FROM loyalty_programs p WHERE p.business_id = ?1 AND p.deleted_at IS NULL ORDER BY visits DESC`,
        ).bind(bid, start),
      ),
      all<{ channel: string; n: number }>(
        D1.prepare(
          "SELECT channel, count(*) AS n FROM stamp_transactions WHERE business_id = ?1 AND type = 'earn' AND created_at >= ?2 GROUP BY channel",
        ).bind(bid, start),
      ),
      all<{ type: string; n: number }>(
        D1.prepare(
          `SELECT type, count(*) AS n FROM interaction_events WHERE business_id = ?1 AND created_at >= ?2
           AND type IN ('qr_scan','nfc_tap','nfc_request','device_unsupported','issue_failed','redeem_failed') GROUP BY type`,
        ).bind(bid, start),
      ),
      all<{ reason: string | null; n: number }>(
        D1.prepare(
          `SELECT reason, count(*) AS n FROM interaction_events WHERE business_id = ?1 AND created_at >= ?2
           AND type IN ('issue_failed','redeem_failed') GROUP BY reason ORDER BY n DESC`,
        ).bind(bid, start),
      ),
      all<{ customer_id: string; first: number }>(
        D1.prepare("SELECT customer_id, min(created_at) AS first FROM customer_cards WHERE business_id = ?1 GROUP BY customer_id").bind(bid),
      ),
      all<{ customer_id: string; day: string }>(
        D1.prepare(
          `SELECT DISTINCT customer_id, ${istDay("created_at")} AS day FROM stamp_transactions
           WHERE business_id = ?1 AND type = 'earn' AND created_at >= ?2`,
        ).bind(bid, start),
      ),
    ]);

    const ev = Object.fromEntries(events.map((e) => [e.type, e.n]));
    const channelCounts = { qr: 0, nfc_tag: 0, nfc_phone: 0, manual: 0, ...Object.fromEntries(channels.map((r) => [r.channel, r.n])) };

    // New vs returning active customers per IST week.
    const firstJoinWeek = new Map(firstJoins.map((f) => [f.customer_id, weekStart(istDateString(new Date(f.first)))]));
    const trend = new Map<string, { newCustomers: Set<string>; returningCustomers: Set<string> }>();
    for (const w of weeklyMap.keys()) trend.set(w, { newCustomers: new Set(), returningCustomers: new Set() });
    for (const f of firstJoins) {
      const w = firstJoinWeek.get(f.customer_id)!;
      trend.get(w)?.newCustomers.add(f.customer_id);
    }
    for (const a of activeDays) {
      const w = weekStart(a.day);
      const bucket = trend.get(w);
      if (bucket && firstJoinWeek.get(a.customer_id)! < w) bucket.returningCustomers.add(a.customer_id);
    }

    return c.json({
      days,
      range: { start: new Date(start), end },
      ...basic,
      advancedAvailable: true,
      advanced: {
        programs,
        channels: channelCounts,
        qrScans: ev.qr_scan ?? 0,
        nfcTagTaps: ev.nfc_tap ?? 0,
        nfcRequests: ev.nfc_request ?? 0,
        failedTransactions: (ev.issue_failed ?? 0) + (ev.redeem_failed ?? 0),
        failuresByReason: failures.map((f) => ({ reason: f.reason ?? "UNKNOWN", count: f.n })),
        duplicateAttempts: failures.find((f) => f.reason === "DUPLICATE")?.n ?? 0,
        deviceCompatibilityFailures: ev.device_unsupported ?? 0,
        customerTrend: [...trend].map(([weekStart, v]) => ({
          weekStart,
          newCustomers: v.newCustomers.size,
          returningCustomers: v.returningCustomers.size,
        })),
      },
    });
  },
);
