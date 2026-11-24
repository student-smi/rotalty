import { describe, expect, it } from "vitest";
import { createProgram, joinAsCustomer, ownerWithBusiness, TestClient } from "./helpers";
import { shopLinks } from "../src/shared/shop-links";

describe("shop contact buttons", () => {
  it("cleans up Instagram links and website addresses, and validates numbers", async () => {
    const { client, business } = await ownerWithBusiness();
    const url = `/api/businesses/${business.id}`;
    const ok = await client.patch(url, { instagramHandle: "https://www.instagram.com/chai_point/", websiteUrl: "chaipoint.in", whatsappNumber: "+91 98765 43210" });
    expect(ok.status).toBe(200);
    expect(ok.json.business).toMatchObject({ instagramHandle: "chai_point", websiteUrl: "https://chaipoint.in", whatsappNumber: "9876543210" });
    expect((await client.patch(url, { instagramHandle: "@chai.point" })).json.business.instagramHandle).toBe("chai.point");
    expect((await client.patch(url, { instagramHandle: "not a handle!" })).status).toBe(400);
    expect((await client.patch(url, { websiteUrl: "javascript:alert(1)" })).status).toBe(400);
    expect((await client.patch(url, { whatsappNumber: "12345" })).status).toBe(400);
    const cleared = await client.patch(url, { instagramHandle: "", websiteUrl: "", whatsappNumber: "" });
    expect(cleared.json.business).toMatchObject({ instagramHandle: null, websiteUrl: null, whatsappNumber: null });
  });

  it("shows only filled-in buttons on the shop page and the customer's card", async () => {
    const owner = await ownerWithBusiness();
    await owner.client.patch(`/api/businesses/${owner.business.id}`, { instagramHandle: "chai_point", phone: "98765 43210", city: "Ahmedabad" });
    const program = await createProgram(owner.client, owner.business.id);
    const { customer } = await joinAsCustomer(owner.business.slug, program.id);

    const page = await new TestClient().get(`/api/public/b/${owner.business.slug}`);
    expect(page.json.business.links).toEqual({
      whatsapp: "https://wa.me/919876543210",
      instagram: "https://www.instagram.com/chai_point/",
      directions: expect.stringContaining("https://www.google.com/maps/search/?api=1&query="),
      call: "tel:+919876543210",
      website: null,
    });
    expect((await customer.get("/api/c/cards")).json.cards[0].business.links.instagram).toBe("https://www.instagram.com/chai_point/");
  });

  it("counts taps for the owner's analytics", async () => {
    const owner = await ownerWithBusiness();
    const visitor = new TestClient();
    expect((await visitor.post(`/api/public/b/${owner.business.slug}/link`, { kind: "instagram" })).status).toBe(200);
    await visitor.post(`/api/public/b/${owner.business.slug}/link`, { kind: "instagram" });
    await visitor.post(`/api/public/b/${owner.business.slug}/link`, { kind: "whatsapp" });
    expect((await visitor.post(`/api/public/b/${owner.business.slug}/link`, { kind: "telegram" })).status).toBe(400);
    expect((await visitor.post(`/api/public/b/no-such-shop/link`, { kind: "call" })).status).toBe(404);

    const res = await owner.client.get(`/api/businesses/${owner.business.id}/analytics/overview?days=7`);
    expect(res.json.shopLinkTaps).toEqual({ instagram: 2, whatsapp: 1 });
  });

  it("prefers the exact Google listing for directions and a separate WhatsApp number when set", () => {
    const links = shopLinks({
      name: "Chai Point",
      phone: "9876543210",
      whatsappNumber: "9123456789",
      instagramHandle: null,
      websiteUrl: null,
      googlePlaceId: "ChIJabc",
      latitude: 23,
      longitude: 72,
      addressLine: null,
      city: null,
    });
    expect(links.whatsapp).toBe("https://wa.me/919123456789");
    expect(links.directions).toBe("https://www.google.com/maps/search/?api=1&query=Chai%20Point&query_place_id=ChIJabc");
    expect(links.instagram).toBeNull();
  });
});
