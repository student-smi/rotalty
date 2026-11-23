import { Hono, type Context } from "hono";
import { z } from "zod";
import { and, asc, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { businesses, businessLocations, businessStaff, staffInvitations, users } from "../db/schema";
import { requireBusiness, requireUser } from "../middleware/auth";
import { auditInsert } from "../lib/audit";
import { AppError, badRequest, conflict, forbidden, notFound } from "../lib/errors";
import { randomToken, sha256Hex } from "../lib/crypto";
import { sendEmail } from "../lib/mailer";
import { validate } from "../lib/validation";
import { effectivePermissions, OWNER_ONLY_PERMISSIONS, PERMISSIONS } from "../../shared/permissions";
import { assertWithinLimit } from "../services/plans";
import type { AppEnv } from "../types";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const delegablePermissions = z
  .array(z.enum(PERMISSIONS))
  .max(PERMISSIONS.length)
  .refine((ps) => ps.every((p) => !OWNER_ONLY_PERMISSIONS.includes(p)), "Owner-only permissions cannot be delegated")
  .transform((ps) => [...new Set(ps)]);

const inviteSchema = z.object({
  email: z.email().transform((e) => e.toLowerCase()),
  role: z.enum(["manager", "staff"]),
  permissions: delegablePermissions.nullish(),
  locationId: z.string().uuid().nullish(),
});

const updateStaffSchema = z.object({
  role: z.enum(["manager", "staff"]).optional(),
  permissions: delegablePermissions.nullable().optional(),
  locationId: z.string().uuid().nullable().optional(),
  status: z.enum(["active", "disabled"]).optional(),
});

async function assertLocationInBusiness(c: Context<AppEnv>, businessId: string, locationId: string | null | undefined) {
  if (!locationId) return;
  const loc = await c
    .get("db")
    .select({ id: businessLocations.id })
    .from(businessLocations)
    .where(
      and(eq(businessLocations.id, locationId), eq(businessLocations.businessId, businessId), isNull(businessLocations.deletedAt)),
    )
    .get();
  if (!loc) throw badRequest("Location does not belong to this business");
}

const inviteUrl = (env: Env, token: string) => `${new URL(env.BETTER_AUTH_URL).origin}/invite/${token}`;

export const staffRoutes = new Hono<AppEnv>()
  .get("/:businessId/staff", requireBusiness({ permission: "staff.manage" }), async (c) => {
    const { business } = c.get("membership");
    const rows = await c
      .get("db")
      .select({ staff: businessStaff, user: { name: users.name, email: users.email } })
      .from(businessStaff)
      .innerJoin(users, eq(users.id, businessStaff.userId))
      .where(eq(businessStaff.businessId, business.id))
      .orderBy(asc(businessStaff.createdAt))
      .all();
    return c.json({
      staff: rows.map(({ staff, user }) => ({
        id: staff.id,
        userId: staff.userId,
        name: user.name,
        email: user.email,
        role: staff.role,
        status: staff.status,
        locationId: staff.locationId,
        customPermissions: staff.permissions !== null,
        permissions: effectivePermissions(staff.role, staff.permissions),
        createdAt: staff.createdAt,
      })),
    });
  })

  .patch(
    "/:businessId/staff/:staffId",
    requireBusiness({ permission: "staff.manage" }),
    validate("json", updateStaffSchema),
    async (c) => {
      const input = c.req.valid("json");
      if (Object.keys(input).length === 0) throw badRequest("Nothing to update");
      const db = c.get("db");
      const { business, staffId: myStaffId } = c.get("membership");
      const scope = and(eq(businessStaff.id, c.req.param("staffId")), eq(businessStaff.businessId, business.id));
      const target = await db.select().from(businessStaff).where(scope).get();
      if (!target) throw notFound("Staff member");
      if (target.role === "owner") throw forbidden("The business owner's access cannot be changed");
      if (target.id === myStaffId) throw forbidden("You cannot change your own access");
      await assertLocationInBusiness(c, business.id, input.locationId);

      await db.batch([
        db.update(businessStaff).set(input).where(scope),
        auditInsert(c, {
          businessId: business.id,
          action: "staff.updated",
          entityType: "staff",
          entityId: target.id,
          metadata: { changes: input },
        }),
      ]);
      return c.json({ ok: true });
    },
  )

  .get("/:businessId/invitations", requireBusiness({ permission: "staff.manage" }), async (c) => {
    const { business } = c.get("membership");
    const rows = await c
      .get("db")
      .select({
        id: staffInvitations.id,
        email: staffInvitations.email,
        role: staffInvitations.role,
        locationId: staffInvitations.locationId,
        expiresAt: staffInvitations.expiresAt,
        createdAt: staffInvitations.createdAt,
      })
      .from(staffInvitations)
      .where(
        and(
          eq(staffInvitations.businessId, business.id),
          isNull(staffInvitations.acceptedAt),
          isNull(staffInvitations.revokedAt),
          gt(staffInvitations.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(staffInvitations.createdAt))
      .all();
    return c.json({ invitations: rows });
  })

  .post(
    "/:businessId/invitations",
    requireBusiness({ permission: "staff.manage" }),
    validate("json", inviteSchema),
    async (c) => {
      const input = c.req.valid("json");
      const db = c.get("db");
      const { business } = c.get("membership");
      await assertLocationInBusiness(c, business.id, input.locationId);

      const existingMember = await db
        .select({ id: businessStaff.id })
        .from(businessStaff)
        .innerJoin(users, eq(users.id, businessStaff.userId))
        .where(
          and(
            eq(businessStaff.businessId, business.id),
            eq(businessStaff.status, "active"),
            sql`lower(${users.email}) = ${input.email}`,
          ),
        )
        .get();
      if (existingMember) throw conflict("This person is already a member of your team");
      await assertWithinLimit(db, "staffPerBusiness", { businessId: business.id });

      const token = randomToken();
      const id = crypto.randomUUID();
      await db.batch([
        // A new invite replaces any older pending invite for the same email.
        db
          .update(staffInvitations)
          .set({ revokedAt: new Date() })
          .where(
            and(
              eq(staffInvitations.businessId, business.id),
              eq(staffInvitations.email, input.email),
              isNull(staffInvitations.acceptedAt),
              isNull(staffInvitations.revokedAt),
            ),
          ),
        db.insert(staffInvitations).values({
          id,
          businessId: business.id,
          email: input.email,
          role: input.role,
          permissions: input.permissions ?? null,
          locationId: input.locationId ?? null,
          tokenHash: await sha256Hex(token),
          expiresAt: new Date(Date.now() + INVITE_TTL_MS),
          invitedByUserId: c.get("user")!.id,
        }),
        auditInsert(c, {
          businessId: business.id,
          action: "staff.invited",
          entityType: "invitation",
          entityId: id,
          metadata: { email: input.email, role: input.role },
        }),
      ]);

      const url = inviteUrl(c.env, token);
      const emailSent = await sendEmail(c.env, {
        to: input.email,
        subject: `You're invited to join ${business.name}`,
        text: `You have been invited to join ${business.name} as ${input.role}.\n\nAccept the invitation (valid for 7 days):\n${url}`,
        html: `<p>You have been invited to join <strong>${business.name.replace(/</g, "&lt;")}</strong> as ${input.role}.</p><p><a href="${url}">Accept the invitation</a> (valid for 7 days).</p>`,
      });
      // The raw token is returned once so the owner can share the link directly (e.g. on WhatsApp) when email isn't configured.
      return c.json({ invitationId: id, inviteUrl: url, emailSent }, 201);
    },
  )

  .delete("/:businessId/invitations/:invitationId", requireBusiness({ permission: "staff.manage" }), async (c) => {
    const db = c.get("db");
    const { business } = c.get("membership");
    const scope = and(
      eq(staffInvitations.id, c.req.param("invitationId")),
      eq(staffInvitations.businessId, business.id),
      isNull(staffInvitations.acceptedAt),
      isNull(staffInvitations.revokedAt),
    );
    const invite = await db.select({ id: staffInvitations.id }).from(staffInvitations).where(scope).get();
    if (!invite) throw notFound("Invitation");
    await db.batch([
      db.update(staffInvitations).set({ revokedAt: new Date() }).where(scope),
      auditInsert(c, { businessId: business.id, action: "staff.invite_revoked", entityType: "invitation", entityId: invite.id }),
    ]);
    return c.json({ ok: true });
  });

async function findValidInvitation(c: Context<AppEnv>, token: string) {
  if (token.length < 20 || token.length > 100) return null;
  return c
    .get("db")
    .select({ invite: staffInvitations, businessName: businesses.name, businessStatus: businesses.status })
    .from(staffInvitations)
    .innerJoin(businesses, eq(businesses.id, staffInvitations.businessId))
    .where(
      and(
        eq(staffInvitations.tokenHash, await sha256Hex(token)),
        isNull(staffInvitations.acceptedAt),
        isNull(staffInvitations.revokedAt),
        gt(staffInvitations.expiresAt, new Date()),
        isNull(businesses.deletedAt),
      ),
    )
    .get();
}

export const invitationRoutes = new Hono<AppEnv>()
  .get("/:token", async (c) => {
    const row = await findValidInvitation(c, c.req.param("token"));
    if (!row) throw notFound("Invitation");
    return c.json({ businessName: row.businessName, role: row.invite.role, email: row.invite.email });
  })

  .post("/:token/accept", requireUser, async (c) => {
    const user = c.get("user")!;
    const db = c.get("db");
    const row = await findValidInvitation(c, c.req.param("token"));
    if (!row) throw notFound("Invitation");
    const { invite } = row;
    if (row.businessStatus === "suspended") throw new AppError(403, "BUSINESS_SUSPENDED", "This business is suspended");
    if (user.email.toLowerCase() !== invite.email) {
      throw forbidden(`This invitation was sent to ${invite.email}. Sign in with that email to accept it.`);
    }

    const existing = await db
      .select()
      .from(businessStaff)
      .where(and(eq(businessStaff.businessId, invite.businessId), eq(businessStaff.userId, user.id)))
      .get();
    if (existing?.role === "owner") throw conflict("You already own this business");

    const membership = {
      role: invite.role,
      permissions: invite.permissions,
      locationId: invite.locationId,
      status: "active" as const,
    };
    await db.batch([
      existing
        ? db.update(businessStaff).set(membership).where(eq(businessStaff.id, existing.id))
        : db.insert(businessStaff).values({ businessId: invite.businessId, userId: user.id, ...membership }),
      db.update(staffInvitations).set({ acceptedAt: new Date() }).where(eq(staffInvitations.id, invite.id)),
      auditInsert(c, {
        businessId: invite.businessId,
        action: "staff.invite_accepted",
        entityType: "invitation",
        entityId: invite.id,
      }),
    ]);
    return c.json({ businessId: invite.businessId });
  });
