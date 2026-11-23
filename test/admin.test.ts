import { describe, expect, it } from "vitest";
import { env, ownerWithBusiness, signUp } from "./helpers";

async function superAdmin() {
  const admin = await signUp("Admin");
  await env.DB.prepare("UPDATE users SET role = 'super_admin' WHERE id = ?").bind(admin.userId).run();
  return admin;
}

describe("super admin", () => {
  it("blocks regular users from admin endpoints", async () => {
    const user = await signUp();
    expect((await user.client.get("/api/admin/overview")).status).toBe(403);
    expect((await user.client.get("/api/admin/businesses")).status).toBe(403);
  });

  it("lists businesses with owner details", async () => {
    const admin = await superAdmin();
    const owner = await ownerWithBusiness();
    const res = await admin.client.get(`/api/admin/businesses?q=${encodeURIComponent(owner.email)}`);
    expect(res.status).toBe(200);
    expect(res.json.businesses).toHaveLength(1);
    expect(res.json.businesses[0]).toMatchObject({ id: owner.business.id, ownerEmail: owner.email, staffCount: 1 });
  });

  it("suspends and reactivates a business", async () => {
    const admin = await superAdmin();
    const owner = await ownerWithBusiness();
    const id = owner.business.id;

    const s = await admin.client.patch(`/api/admin/businesses/${id}/status`, { status: "suspended", reason: "Payment overdue" });
    expect(s.status).toBe(200);

    const view = await owner.client.get(`/api/businesses/${id}`);
    expect(view.status).toBe(200);
    expect(view.json.business).toMatchObject({ status: "suspended", suspendedReason: "Payment overdue" });

    const blocked = await owner.client.get(`/api/businesses/${id}/locations`);
    expect(blocked.status).toBe(403);
    expect(blocked.json.error.code).toBe("BUSINESS_SUSPENDED");

    await admin.client.patch(`/api/admin/businesses/${id}/status`, { status: "active" });
    expect((await owner.client.get(`/api/businesses/${id}/locations`)).status).toBe(200);
  });
});
