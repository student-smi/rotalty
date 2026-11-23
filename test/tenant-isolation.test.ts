import { describe, expect, it } from "vitest";
import { ownerWithBusiness } from "./helpers";

describe("tenant isolation", () => {
  it("prevents one business owner from reading or modifying another business", async () => {
    const a = await ownerWithBusiness();
    const b = await ownerWithBusiness();
    const aId = a.business.id;

    for (const path of [`/api/businesses/${aId}`, `/api/businesses/${aId}/locations`, `/api/businesses/${aId}/staff`, `/api/businesses/${aId}/invitations`]) {
      const res = await b.client.get(path);
      expect(res.status, path).toBe(404);
    }
    expect((await b.client.patch(`/api/businesses/${aId}`, { name: "Hijacked" })).status).toBe(404);
    expect((await b.client.post(`/api/businesses/${aId}/locations`, { name: "Rogue branch" })).status).toBe(404);
    expect((await b.client.post(`/api/businesses/${aId}/invitations`, { email: "x@example.com", role: "manager" })).status).toBe(404);

    const unchanged = await a.client.get(`/api/businesses/${aId}`);
    expect(unchanged.json.business.name).toBe("ABC Coffee House");
  });

  it("does not let a business edit another business's location through its own path", async () => {
    const a = await ownerWithBusiness();
    const b = await ownerWithBusiness();
    const aLoc = (await a.client.get(`/api/businesses/${a.business.id}/locations`)).json.locations[0];

    const res = await b.client.patch(`/api/businesses/${b.business.id}/locations/${aLoc.id}`, { name: "Stolen" });
    expect(res.status).toBe(404);
    const del = await b.client.delete(`/api/businesses/${b.business.id}/locations/${aLoc.id}`);
    expect(del.status).toBe(404);
  });

  it("rejects assigning staff to another business's location", async () => {
    const a = await ownerWithBusiness();
    const b = await ownerWithBusiness();
    const aLoc = (await a.client.get(`/api/businesses/${a.business.id}/locations`)).json.locations[0];
    const res = await b.client.post(`/api/businesses/${b.business.id}/invitations`, {
      email: "someone@example.com",
      role: "staff",
      locationId: aLoc.id,
    });
    expect(res.status).toBe(400);
  });

  it("returns the same 404 for missing and foreign businesses", async () => {
    const a = await ownerWithBusiness();
    const b = await ownerWithBusiness();
    const foreign = await b.client.get(`/api/businesses/${a.business.id}`);
    const missing = await b.client.get(`/api/businesses/${crypto.randomUUID()}`);
    expect(foreign.status).toBe(missing.status);
    expect(foreign.json).toEqual(missing.json);
  });
});
