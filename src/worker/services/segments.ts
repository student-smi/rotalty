import type { CustomerSegment } from "../../shared/domain";

const DAY = 86_400_000;
export const NEW_DAYS = 30;
export const INACTIVE_DAYS = 45;

export interface CustomerAggregate {
  customerId: string;
  name: string;
  phone: string | null;
  email: string | null;
  birthday: string | null;
  deletedAt: number | null;
  cards: number;
  visits: number;
  pointsBalance: number;
  lifetimePoints: number;
  rewardsRedeemed: number;
  lastVisitAt: number | null;
  joinedAt: number;
  rewardEligible: number;
  whatsappConsent: "granted" | "withdrawn" | null;
}

/** One row per customer, aggregated across all of that customer's cards at one business. */
function baseQuery(extraWhere = "") {
  return `SELECT c.id AS customerId, c.name AS name, c.phone AS phone, c.email AS email, c.birthday AS birthday, c.deleted_at AS deletedAt,
      count(cc.id) AS cards,
      coalesce(sum(cc.visits), 0) AS visits,
      coalesce(sum(cc.points_balance), 0) AS pointsBalance,
      coalesce(sum(cc.lifetime_points), 0) AS lifetimePoints,
      coalesce(sum(cc.rewards_redeemed), 0) AS rewardsRedeemed,
      max(cc.last_visit_at) AS lastVisitAt,
      min(cc.created_at) AS joinedAt,
      max(CASE WHEN cc.points_balance >= (SELECT min(r.points_required) FROM rewards r WHERE r.program_id = cc.program_id AND r.is_active = 1)
          THEN 1 ELSE 0 END) AS rewardEligible,
      (SELECT cs.status FROM customer_consents cs WHERE cs.business_id = cc.business_id AND cs.customer_id = c.id AND cs.channel = 'whatsapp') AS whatsappConsent
    FROM customer_cards cc JOIN customers c ON c.id = cc.customer_id
    WHERE cc.business_id = ? ${extraWhere}
    GROUP BY c.id`;
}

export function segmentHaving(segment: CustomerSegment, now: number): { clause: string; params: unknown[] } {
  switch (segment) {
    case "new":
      return { clause: "joinedAt >= ?", params: [now - NEW_DAYS * DAY] };
    case "regular":
      return { clause: "visits BETWEEN 3 AND 9", params: [] };
    case "loyal":
      return { clause: "visits >= 10", params: [] };
    case "inactive":
      return { clause: "coalesce(lastVisitAt, joinedAt) < ?", params: [now - INACTIVE_DAYS * DAY] };
    case "reward_eligible":
      return { clause: "rewardEligible = 1", params: [] };
  }
}

export function segmentsFor(row: Pick<CustomerAggregate, "visits" | "lastVisitAt" | "joinedAt" | "rewardEligible">, now = Date.now()) {
  const out: CustomerSegment[] = [];
  if (row.joinedAt >= now - NEW_DAYS * DAY) out.push("new");
  if (row.visits >= 3 && row.visits <= 9) out.push("regular");
  if (row.visits >= 10) out.push("loyal");
  if ((row.lastVisitAt ?? row.joinedAt) < now - INACTIVE_DAYS * DAY) out.push("inactive");
  if (row.rewardEligible === 1) out.push("reward_eligible");
  return out;
}

function escapeLike(s: string) {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export async function listCustomers(
  d1: D1Database,
  businessId: string,
  opts: { q?: string; segment?: CustomerSegment; limit: number; offset: number },
  now = Date.now(),
) {
  const params: unknown[] = [businessId];
  let where = "";
  if (opts.q) {
    const term = `%${escapeLike(opts.q)}%`;
    const digits = opts.q.replace(/\D/g, "");
    where = digits.length >= 3 ? "AND (c.name LIKE ? ESCAPE '\\' OR c.phone LIKE ?)" : "AND c.name LIKE ? ESCAPE '\\'";
    params.push(term);
    if (digits.length >= 3) params.push(`%${digits}%`);
  }
  let having = "";
  if (opts.segment) {
    const h = segmentHaving(opts.segment, now);
    having = `HAVING ${h.clause}`;
    params.push(...h.params);
  }
  params.push(opts.limit, opts.offset);
  const { results } = await d1
    .prepare(`${baseQuery(where)} ${having} ORDER BY coalesce(lastVisitAt, joinedAt) DESC, customerId LIMIT ? OFFSET ?`)
    .bind(...params)
    .all<CustomerAggregate>();
  return results;
}

/** Aggregate for one customer at one business; null if they have no card there. */
export async function customerAggregate(d1: D1Database, businessId: string, customerId: string) {
  return d1.prepare(baseQuery("AND c.id = ?")).bind(businessId, customerId).first<CustomerAggregate>();
}

export async function segmentStats(d1: D1Database, businessId: string, now = Date.now()) {
  const row = await d1
    .prepare(
      `SELECT count(*) AS total,
        coalesce(sum(CASE WHEN joinedAt >= ?2 THEN 1 ELSE 0 END), 0) AS new,
        coalesce(sum(CASE WHEN visits BETWEEN 3 AND 9 THEN 1 ELSE 0 END), 0) AS regular,
        coalesce(sum(CASE WHEN visits >= 10 THEN 1 ELSE 0 END), 0) AS loyal,
        coalesce(sum(CASE WHEN coalesce(lastVisitAt, joinedAt) < ?3 THEN 1 ELSE 0 END), 0) AS inactive,
        coalesce(sum(CASE WHEN rewardEligible = 1 THEN 1 ELSE 0 END), 0) AS reward_eligible,
        coalesce(sum(CASE WHEN whatsappConsent = 'granted' AND phone IS NOT NULL AND deletedAt IS NULL THEN 1 ELSE 0 END), 0) AS optedIn
      FROM (${baseQuery().replace("cc.business_id = ?", "cc.business_id = ?1")})`,
    )
    .bind(businessId, now - NEW_DAYS * DAY, now - INACTIVE_DAYS * DAY)
    .first<Record<CustomerSegment | "total" | "optedIn", number>>();
  return row!;
}

export interface AudienceFilter {
  segment?: CustomerSegment;
  /** Extra SQL on the joined rows (aliases `c` customers, `cc` customer_cards). */
  where?: string;
  whereParams?: unknown[];
  /** Extra SQL on the aggregate aliases (e.g. lastVisitAt). */
  having?: string;
  havingParams?: unknown[];
}

/** Customers who may receive WhatsApp marketing: granted consent at this business, a phone number, not deleted. */
export async function audience(d1: D1Database, businessId: string, filter: AudienceFilter = {}, now = Date.now()) {
  const params: unknown[] = [businessId, ...(filter.whereParams ?? [])];
  const havings = ["whatsappConsent = 'granted'"];
  if (filter.segment) {
    const h = segmentHaving(filter.segment, now);
    havings.push(h.clause);
    params.push(...h.params);
  }
  if (filter.having) {
    havings.push(filter.having);
    params.push(...(filter.havingParams ?? []));
  }
  const where = `AND c.phone IS NOT NULL AND c.deleted_at IS NULL ${filter.where ?? ""}`;
  const { results } = await d1
    .prepare(`${baseQuery(where)} HAVING ${havings.join(" AND ")} ORDER BY customerId`)
    .bind(...params)
    .all<CustomerAggregate>();
  return results;
}
