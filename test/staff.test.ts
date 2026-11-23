import { describe, expect, it } from "vitest";
import { inviteAndAccept, ownerWithBusiness, signUp } from "./helpers";

describe("staff invitations", () => {
  it("lets an invited user join with the role's default permissions", async () => {
    const owner = await ownerWithBusiness();
    const staff = await inviteAndAccept(owner.client, owner.business.id, "staff");

    const me = await staff.client.get("/api/me");
    expect(me.json.memberships[0]).toMatchObject({ businessId: owner.business.id, role: "staff" });
    expect(me.json.memberships[0].permissions.sort()).toEqual(["customers.view", "points.issue", "rewards.redeem"]);
  });

  it("refuses acceptance from a different email address", async () => {
    const owner = await ownerWithBusiness();
    const inv = await owner.client.post(`/api/businesses/${owner.business.id}/invitations`, { email: "invitee@example.com", role: "staff" });
    const token = inv.json.inviteUrl.split("/").pop();
    const intruder = await signUp("Intruder");
    const res = await intruder.client.post(`/api/invitations/${token}/accept`);
    expect(res.status).toBe(403);
  });

  it("cannot reuse an accepted invitation or use a revoked one", async () => {
    const owner = await ownerWithBusiness();
    const member = await signUp("Member");
    const inv = await owner.client.post(`/api/businesses/${owner.business.id}/invitations`, { email: member.email, role: "staff" });
    const token = inv.json.inviteUrl.split("/").pop();
    expect((await member.client.post(`/api/invitations/${token}/accept`)).status).toBe(200);
    expect((await member.client.post(`/api/invitations/${token}/accept`)).status).toBe(404);

    const other = await signUp("Other");
    const inv2 = await owner.client.post(`/api/businesses/${owner.business.id}/invitations`, { email: other.email, role: "staff" });
    await owner.client.delete(`/api/businesses/${owner.business.id}/invitations/${inv2.json.invitationId}`);
    const token2 = inv2.json.inviteUrl.split("/").pop();
    expect((await other.client.post(`/api/invitations/${token2}/accept`)).status).toBe(404);
  });

  it("rejects delegating owner-only permissions", async () => {
    const owner = await ownerWithBusiness();
    const res = await owner.client.post(`/api/businesses/${owner.business.id}/invitations`, {
      email: "m@example.com",
      role: "manager",
      permissions: ["billing.manage"],
    });
    expect(res.status).toBe(400);
  });

  it("does not let users invite themselves twice into the team", async () => {
    const owner = await ownerWithBusiness();
    const res = await owner.client.post(`/api/businesses/${owner.business.id}/invitations`, { email: owner.email, role: "staff" });
    expect(res.status).toBe(409);
  });
});

describe("staff permissions", () => {
  it("restricts staff to their permissions", async () => {
    const owner = await ownerWithBusiness();
    const staff = await inviteAndAccept(owner.client, owner.business.id, "staff");
    const id = owner.business.id;

    expect((await staff.client.get(`/api/businesses/${id}`)).status).toBe(200);
    expect((await staff.client.get(`/api/businesses/${id}/locations`)).status).toBe(200);
    expect((await staff.client.patch(`/api/businesses/${id}`, { name: "Nope" })).status).toBe(403);
    expect((await staff.client.get(`/api/businesses/${id}/staff`)).status).toBe(403);
    expect((await staff.client.post(`/api/businesses/${id}/locations`, { name: "Rogue" })).status).toBe(403);
  });

  it("never lets a manager manage staff, even with custom permissions", async () => {
    const owner = await ownerWithBusiness();
    const manager = await inviteAndAccept(owner.client, owner.business.id, "manager");
    expect((await manager.client.post(`/api/businesses/${owner.business.id}/locations`, { name: "Branch 2" })).status).toBe(201);
    expect((await manager.client.get(`/api/businesses/${owner.business.id}/staff`)).status).toBe(403);
  });

  it("applies owner-customised permissions and disabling", async () => {
    const owner = await ownerWithBusiness();
    const staff = await inviteAndAccept(owner.client, owner.business.id, "staff");
    const id = owner.business.id;
    const list = await owner.client.get(`/api/businesses/${id}/staff`);
    const row = list.json.staff.find((s: { email: string }) => s.email === staff.email);

    await owner.client.patch(`/api/businesses/${id}/staff/${row.id}`, { permissions: ["locations.manage"] });
    expect((await staff.client.post(`/api/businesses/${id}/locations`, { name: "Allowed now" })).status).toBe(201);
    const me = await staff.client.get("/api/me");
    expect(me.json.memberships[0].permissions).toEqual(["locations.manage"]);

    await owner.client.patch(`/api/businesses/${id}/staff/${row.id}`, { status: "disabled" });
    expect((await staff.client.get(`/api/businesses/${id}`)).status).toBe(404);
  });

  it("protects the owner's membership", async () => {
    const owner = await ownerWithBusiness();
    const list = await owner.client.get(`/api/businesses/${owner.business.id}/staff`);
    const ownerRow = list.json.staff.find((s: { role: string }) => s.role === "owner");
    const res = await owner.client.patch(`/api/businesses/${owner.business.id}/staff/${ownerRow.id}`, { status: "disabled" });
    expect(res.status).toBe(403);
  });
});
