import { describe, expect, it } from "vitest";
import { createBusiness, env, ownerWithBusiness, setPlan, signUp } from "./helpers";

describe("business registration", () => {
  it("creates a business with owner membership, default location and audit log", async () => {
    const { client, business } = await ownerWithBusiness();

    const me = await client.get("/api/me");
    expect(me.json.memberships).toHaveLength(1);
    expect(me.json.memberships[0]).toMatchObject({ businessId: business.id, role: "owner", businessStatus: "active" });
    expect(me.json.memberships[0].permissions).toContain("billing.manage");

    const locs = await client.get(`/api/businesses/${business.id}/locations`);
    expect(locs.json.locations).toHaveLength(1);
    expect(locs.json.locations[0].name).toBe("Main location");

    const audit = await env.DB.prepare("SELECT action FROM audit_logs WHERE business_id = ?").bind(business.id).all();
    expect(audit.results.map((r) => r.action)).toContain("business.created");
  });

  it("normalises Indian phone numbers and validates input", async () => {
    const { client } = await signUp();
    const ok = await client.post("/api/businesses", { name: "Juice Point", category: "juice_shop", phone: "+91 98765-43210" });
    expect(ok.status).toBe(201);
    expect(ok.json.business.phone).toBe("9876543210");

    const bad = await client.post("/api/businesses", { name: "J", category: "spaceship", phone: "12345" });
    expect(bad.status).toBe(400);
    const paths = bad.json.error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(["name", "category", "phone"]));
  });

  it("generates unique slugs for duplicate names", async () => {
    const { client, userId } = await signUp();
    await setPlan(userId, "professional");
    const a = await createBusiness(client, { name: "Same Name Salon", category: "salon" });
    const b = await createBusiness(client, { name: "Same Name Salon", category: "salon" });
    expect(a.slug).not.toBe(b.slug);
  });

  it("lets the owner update the profile", async () => {
    const { client, business } = await ownerWithBusiness();
    const res = await client.patch(`/api/businesses/${business.id}`, { city: "Ahmedabad", pincode: "380001" });
    expect(res.status).toBe(200);
    expect(res.json.business).toMatchObject({ city: "Ahmedabad", pincode: "380001" });
  });

  it("refuses to delete the last location", async () => {
    const { client, business } = await ownerWithBusiness();
    const locs = await client.get(`/api/businesses/${business.id}/locations`);
    const res = await client.delete(`/api/businesses/${business.id}/locations/${locs.json.locations[0].id}`);
    expect(res.status).toBe(400);
  });

  it("adds and soft-deletes extra locations", async () => {
    const { client, business } = await ownerWithBusiness();
    const created = await client.post(`/api/businesses/${business.id}/locations`, { name: "CG Road branch", city: "Ahmedabad" });
    expect(created.status).toBe(201);
    const del = await client.delete(`/api/businesses/${business.id}/locations/${created.json.location.id}`);
    expect(del.status).toBe(200);
    const locs = await client.get(`/api/businesses/${business.id}/locations`);
    expect(locs.json.locations).toHaveLength(1);
  });
});

describe("logo upload", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

  function form(bytes: Uint8Array, type: string) {
    const fd = new FormData();
    fd.set("logo", new File([bytes], "logo", { type }));
    return fd;
  }

  it("stores a valid PNG in R2 and serves it", async () => {
    const { client, business } = await ownerWithBusiness();
    const res = await client.request("POST", `/api/businesses/${business.id}/logo`, undefined, { body: form(png, "image/png") });
    expect(res.status).toBe(200);
    const file = await client.get(res.json.logoUrl);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("image/png");
  });

  it("rejects files whose content doesn't match the declared type", async () => {
    const { client, business } = await ownerWithBusiness();
    const html = new TextEncoder().encode("<script>alert(1)</script>");
    const res = await client.request("POST", `/api/businesses/${business.id}/logo`, undefined, { body: form(html, "image/png") });
    expect(res.status).toBe(400);
  });

  it("rejects unsupported types", async () => {
    const { client, business } = await ownerWithBusiness();
    const res = await client.request("POST", `/api/businesses/${business.id}/logo`, undefined, {
      body: form(new TextEncoder().encode("<svg/>"), "image/svg+xml"),
    });
    expect(res.status).toBe(400);
  });
});
