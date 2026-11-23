import { Hono } from "hono";
import { z } from "zod";
import { and, asc, desc, eq, inArray, isNull, max } from "drizzle-orm";
import { loyaltyPrograms, rewards } from "../db/schema";
import { requireBusiness } from "../middleware/auth";
import { auditInsert } from "../lib/audit";
import { badRequest, notFound } from "../lib/errors";
import { optionalText, validate } from "../lib/validation";
import { assertWithinLimit } from "../services/plans";
import { PROGRAM_STATUSES } from "../../shared/domain";
import type { AppEnv } from "../types";
import type { DB } from "../db/client";

const STAMP_ICONS = ["star", "coffee", "heart", "scissors", "cake", "dumbbell", "bag", "leaf", "gift", "drop"] as const;

const dateField = z.coerce.date().nullish();

const rewardSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: optionalText(300),
  pointsRequired: z.number().int().min(1).max(100),
  isActive: z.boolean().optional(),
});

const programFields = {
  name: z.string().trim().min(2).max(80),
  description: optionalText(500),
  stampIcon: z.enum(STAMP_ICONS).default("star"),
  stampsRequired: z.number().int().min(1).max(100),
  minPurchaseAmount: z.number().int().min(0).max(10_000_000).nullish(),
  startsAt: dateField,
  endsAt: dateField,
  eligibility: optionalText(500),
  terms: optionalText(2000),
  status: z.enum(PROGRAM_STATUSES).optional(),
  dailyLimitPerCustomer: z.number().int().min(1).max(20).optional(),
  cooldownMinutes: z.number().int().min(0).max(1440).optional(),
};

const createSchema = z
  .object({ ...programFields, rewards: z.array(rewardSchema).min(1).max(10) })
  .refine((v) => !v.startsAt || !v.endsAt || v.endsAt > v.startsAt, { message: "End date must be after start date", path: ["endsAt"] })
  .refine((v) => v.rewards.every((r) => r.pointsRequired <= v.stampsRequired), {
    message: "A reward can't need more points than the card has stamps",
    path: ["rewards"],
  });

const updateSchema = z.object(programFields).partial();

async function programsWithRewards(db: DB, businessId: string, programIds?: string[]) {
  const programs = await db
    .select()
    .from(loyaltyPrograms)
    .where(
      and(
        eq(loyaltyPrograms.businessId, businessId),
        isNull(loyaltyPrograms.deletedAt),
        programIds ? inArray(loyaltyPrograms.id, programIds) : undefined,
      ),
    )
    .orderBy(desc(loyaltyPrograms.createdAt))
    .all();
  if (!programs.length) return [];
  const rs = await db
    .select()
    .from(rewards)
    .where(inArray(rewards.programId, programs.map((p) => p.id)))
    .orderBy(asc(rewards.pointsRequired))
    .all();
  return programs.map((p) => ({ ...p, rewards: rs.filter((r) => r.programId === p.id) }));
}

export { programsWithRewards, STAMP_ICONS };

export const programRoutes = new Hono<AppEnv>()
  .get("/:businessId/programs", requireBusiness(), async (c) => {
    return c.json({ programs: await programsWithRewards(c.get("db"), c.get("membership").business.id) });
  })

  .post("/:businessId/programs", requireBusiness({ permission: "loyalty.manage" }), validate("json", createSchema), async (c) => {
    const { rewards: rewardInputs, ...input } = c.req.valid("json");
    const db = c.get("db");
    const { business } = c.get("membership");
    await assertWithinLimit(db, "programsPerBusiness", { businessId: business.id });
    const programId = crypto.randomUUID();
    await db.batch([
      db.insert(loyaltyPrograms).values({ id: programId, businessId: business.id, ...input, status: input.status ?? "active" }),
      db.insert(rewards).values(rewardInputs.map((r) => ({ ...r, businessId: business.id, programId }))),
      auditInsert(c, { businessId: business.id, action: "program.created", entityType: "program", entityId: programId }),
    ]);
    const [program] = await programsWithRewards(db, business.id, [programId]);
    return c.json({ program }, 201);
  })

  .patch(
    "/:businessId/programs/:programId",
    requireBusiness({ permission: "loyalty.manage" }),
    validate("json", updateSchema),
    async (c) => {
      const input = c.req.valid("json");
      if (Object.keys(input).length === 0) throw badRequest("Nothing to update");
      const db = c.get("db");
      const { business } = c.get("membership");
      const scope = and(
        eq(loyaltyPrograms.id, c.req.param("programId")),
        eq(loyaltyPrograms.businessId, business.id),
        isNull(loyaltyPrograms.deletedAt),
      );
      const existing = await db.select().from(loyaltyPrograms).where(scope).get();
      if (!existing) throw notFound("Program");

      const startsAt = input.startsAt === undefined ? existing.startsAt : input.startsAt;
      const endsAt = input.endsAt === undefined ? existing.endsAt : input.endsAt;
      if (startsAt && endsAt && endsAt <= startsAt) throw badRequest("End date must be after start date");
      if (input.stampsRequired !== undefined) {
        const top = await db
          .select({ m: max(rewards.pointsRequired) })
          .from(rewards)
          .where(and(eq(rewards.programId, existing.id), eq(rewards.isActive, true)))
          .get();
        if (top?.m && input.stampsRequired < top.m) throw badRequest(`A reward needs ${top.m} points; stamps can't be fewer than that`);
      }
      // Archived programs don't count toward the plan limit, so un-archiving must re-check it.
      if (existing.status === "archived" && input.status && input.status !== "archived") {
        await assertWithinLimit(db, "programsPerBusiness", { businessId: business.id });
      }

      await db.batch([
        db.update(loyaltyPrograms).set(input).where(scope),
        auditInsert(c, {
          businessId: business.id,
          action: "program.updated",
          entityType: "program",
          entityId: existing.id,
          metadata: { fields: Object.keys(input) },
        }),
      ]);
      const [program] = await programsWithRewards(db, business.id, [existing.id]);
      return c.json({ program });
    },
  )

  .post(
    "/:businessId/programs/:programId/rewards",
    requireBusiness({ permission: "loyalty.manage" }),
    validate("json", rewardSchema),
    async (c) => {
      const input = c.req.valid("json");
      const db = c.get("db");
      const { business } = c.get("membership");
      const program = await db
        .select()
        .from(loyaltyPrograms)
        .where(and(eq(loyaltyPrograms.id, c.req.param("programId")), eq(loyaltyPrograms.businessId, business.id), isNull(loyaltyPrograms.deletedAt)))
        .get();
      if (!program) throw notFound("Program");
      if (input.pointsRequired > program.stampsRequired) throw badRequest("A reward can't need more points than the card has stamps");
      const id = crypto.randomUUID();
      await db.batch([
        db.insert(rewards).values({ id, businessId: business.id, programId: program.id, ...input }),
        auditInsert(c, { businessId: business.id, action: "reward.created", entityType: "reward", entityId: id }),
      ]);
      return c.json({ reward: await db.select().from(rewards).where(eq(rewards.id, id)).get() }, 201);
    },
  )

  .patch(
    "/:businessId/rewards/:rewardId",
    requireBusiness({ permission: "loyalty.manage" }),
    validate("json", rewardSchema.partial()),
    async (c) => {
      const input = c.req.valid("json");
      if (Object.keys(input).length === 0) throw badRequest("Nothing to update");
      const db = c.get("db");
      const { business } = c.get("membership");
      const row = await db
        .select({ reward: rewards, program: loyaltyPrograms })
        .from(rewards)
        .innerJoin(loyaltyPrograms, eq(loyaltyPrograms.id, rewards.programId))
        .where(and(eq(rewards.id, c.req.param("rewardId")), eq(rewards.businessId, business.id)))
        .get();
      if (!row) throw notFound("Reward");
      if (input.pointsRequired && input.pointsRequired > row.program.stampsRequired) {
        throw badRequest("A reward can't need more points than the card has stamps");
      }
      await db.batch([
        db.update(rewards).set(input).where(and(eq(rewards.id, row.reward.id), eq(rewards.businessId, business.id))),
        auditInsert(c, { businessId: business.id, action: "reward.updated", entityType: "reward", entityId: row.reward.id, metadata: input }),
      ]);
      return c.json({ reward: await db.select().from(rewards).where(eq(rewards.id, row.reward.id)).get() });
    },
  );
