import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env, ownerWithBusiness, TestClient } from "./helpers";
import { mapCategory, normalizePlace, toIndianMobile } from "../src/worker/services/places";

const PLACE_ID = "ChIJhblfCWuFXjkRlmVfXqxRPyU";

const details = {
  id: PLACE_ID,
  displayName: { text: "Chai Corner - Navrangpura" },
  formattedAddress: "Ground Floor, Manor Maxx, Commerce College Rd, Navrangpura, Ahmedabad, Gujarat 380009",
  addressComponents: [
    { longText: "Ground Floor", shortText: "Ground Floor", types: ["subpremise"] },
    { longText: "Manor Maxx", shortText: "Manor Maxx", types: ["premise"] },
    { longText: "Commerce College Road", shortText: "Commerce College Rd", types: ["route"] },
    { longText: "Navrangpura", shortText: "Navrangpura", types: ["sublocality_level_1", "sublocality", "political"] },
    { longText: "Ahmedabad", shortText: "Ahmedabad", types: ["locality", "political"] },
    { longText: "Gujarat", shortText: "GJ", types: ["administrative_area_level_1", "political"] },
    { longText: "India", shortText: "IN", types: ["country", "political"] },
    { longText: "380009", shortText: "380009", types: ["postal_code"] },
  ],
  location: { latitude: 23.0341, longitude: 72.5551 },
  primaryType: "coffee_shop",
  primaryTypeDisplayName: { text: "Coffee shop" },
  types: ["coffee_shop", "cafe", "food", "point_of_interest", "establishment"],
  nationalPhoneNumber: "098765 43210",
  rating: 4.5,
  userRatingCount: 2610,
};

const realFetch = globalThis.fetch;
interface Sent { url: string; method: string; headers: Headers; body: string }
let calls: Sent[] = [];
let upstream: (req: Request) => Response = () => new Response("{}");

beforeEach(() => {
  calls = [];
  upstream = (req) =>
    req.url.includes(":autocomplete")
      ? Response.json({
          suggestions: [
            {
              placePrediction: {
                placeId: PLACE_ID,
                text: { text: "Chai Corner, Navrangpura, Ahmedabad" },
                structuredFormat: { mainText: { text: "Chai Corner" }, secondaryText: { text: "Navrangpura, Ahmedabad, Gujarat" } },
              },
            },
            { queryPrediction: { text: { text: "chai corner near me" } } },
          ],
        })
      : Response.json(details);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const req = new Request(input as RequestInfo, init);
    if (req.url.startsWith("https://places.googleapis.com/")) {
      calls.push({ url: req.url, method: req.method, headers: req.headers, body: await req.text() });
      return upstream(req);
    }
    return realFetch(input as RequestInfo, init);
  });
  (env as Env).GOOGLE_PLACES_API_KEY = "test-places-key";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (env as Env).GOOGLE_PLACES_API_KEY;
});

const SESSION = "0f7a3c1e-1111-4222-8333-944455556666";

describe("Google Places proxy", () => {
  it("reports whether search is available", async () => {
    expect((await new TestClient().get("/api/places/status")).json).toEqual({ enabled: true });
    delete (env as Env).GOOGLE_PLACES_API_KEY;
    expect((await new TestClient().get("/api/places/status")).json).toEqual({ enabled: false });
  });

  it("requires a signed-in user", async () => {
    const res = await new TestClient().get(`/api/places/autocomplete?q=chai&session=${SESSION}`);
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("searches India only, keeps the key server-side and returns shop suggestions", async () => {
    const { client } = await ownerWithBusiness();
    const res = await client.get(`/api/places/autocomplete?q=chai%20corner&session=${SESSION}`);
    expect(res.status).toBe(200);
    expect(res.json.suggestions).toEqual([{ placeId: PLACE_ID, name: "Chai Corner", secondary: "Navrangpura, Ahmedabad, Gujarat" }]);
    expect(JSON.stringify(res.json)).not.toContain("test-places-key");

    const sent = calls[0]!;
    expect(sent.method).toBe("POST");
    expect(sent.headers.get("X-Goog-Api-Key")).toBe("test-places-key");
    expect(JSON.parse(sent.body)).toMatchObject({ input: "chai corner", sessionToken: SESSION, includedRegionCodes: ["in"] });
  });

  it("returns normalised details for autofill, ending the billing session", async () => {
    const { client } = await ownerWithBusiness();
    const res = await client.get(`/api/places/details/${PLACE_ID}?session=${SESSION}`);
    expect(res.status).toBe(200);
    expect(res.json.place).toMatchObject({
      placeId: PLACE_ID,
      name: "Chai Corner - Navrangpura",
      category: "cafe",
      categoryLabel: "Coffee shop",
      addressLine: "Ground Floor, Manor Maxx, Commerce College Road, Navrangpura",
      city: "Ahmedabad",
      state: "Gujarat",
      pincode: "380009",
      phone: "9876543210",
      reviewUrl: `https://search.google.com/local/writereview?placeid=${PLACE_ID}`,
      rating: 4.5,
    });
    const sent = calls[0]!;
    expect(new URL(sent.url).searchParams.get("sessionToken")).toBe(SESSION);
    expect(sent.headers.get("X-Goog-FieldMask")).toContain("addressComponents");
  });

  it("rejects malformed input before calling Google", async () => {
    const { client } = await ownerWithBusiness();
    expect((await client.get(`/api/places/autocomplete?q=a&session=${SESSION}`)).status).toBe(400);
    expect((await client.get("/api/places/autocomplete?q=chai&session=bad token")).status).toBe(400);
    expect((await client.get(`/api/places/details/${encodeURIComponent("../../etc")}`)).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("explains when search isn't configured or Google fails", async () => {
    const { client } = await ownerWithBusiness();
    upstream = () => new Response("quota", { status: 429 });
    const failed = await client.get(`/api/places/autocomplete?q=chai&session=${SESSION}`);
    expect(failed.status).toBe(502);
    expect(failed.json.error.code).toBe("PLACES_UNAVAILABLE");

    delete (env as Env).GOOGLE_PLACES_API_KEY;
    const off = await client.get(`/api/places/autocomplete?q=chai&session=${SESSION}`);
    expect(off.status).toBe(503);
    expect(off.json.error.code).toBe("PLACES_NOT_CONFIGURED");
  });
});

describe("saving a business picked from Google", () => {
  it("stores the place and pre-fills the Google review link (still switched off)", async () => {
    const { client } = await ownerWithBusiness();
    const res = await client.post("/api/businesses", {
      name: "Chai Corner",
      category: "cafe",
      city: "Ahmedabad",
      pincode: "380009",
      googlePlaceId: PLACE_ID,
      latitude: 23.0341,
      longitude: 72.5551,
    });
    expect(res.status).toBe(201);
    expect(res.json.business).toMatchObject({ googlePlaceId: PLACE_ID, latitude: 23.0341 });

    const settings = await client.get(`/api/businesses/${res.json.business.id}/review-settings`);
    expect(settings.json.settings).toMatchObject({
      enabled: false,
      profileName: "Chai Corner",
      reviewUrl: `https://search.google.com/local/writereview?placeid=${PLACE_ID}`,
    });
  });

  it("never overwrites a review link the owner already set", async () => {
    const { client, business } = await ownerWithBusiness();
    const own = "https://g.page/r/my-own-link/review";
    await client.request("PUT", `/api/businesses/${business.id}/review-settings`, { enabled: true, reviewUrl: own, languages: ["en"] });
    expect((await client.patch(`/api/businesses/${business.id}`, { googlePlaceId: PLACE_ID })).status).toBe(200);
    const settings = await client.get(`/api/businesses/${business.id}/review-settings`);
    expect(settings.json.settings.reviewUrl).toBe(own);
  });

  it("fills an empty review link when a place is linked later", async () => {
    const { client, business } = await ownerWithBusiness();
    await client.patch(`/api/businesses/${business.id}`, { googlePlaceId: PLACE_ID });
    const settings = await client.get(`/api/businesses/${business.id}/review-settings`);
    expect(settings.json.settings.reviewUrl).toContain(PLACE_ID);
  });

  it("rejects invalid place ids", async () => {
    const { client } = await ownerWithBusiness();
    const res = await client.post("/api/businesses", { name: "Bad Place", category: "cafe", googlePlaceId: "x y" });
    expect(res.status).toBe(400);
  });
});

describe("place normalisation", () => {
  it("keeps only Indian mobile numbers for the phone field", () => {
    expect(toIndianMobile("098765 43210")).toBe("9876543210");
    expect(toIndianMobile("+91 98765 43210")).toBe("9876543210");
    expect(toIndianMobile("1860 266 0010")).toBeNull();
    expect(toIndianMobile("079 2656 1234")).toBeNull();
  });

  it("maps Google place types to our categories", () => {
    expect(mapCategory("hair_salon", [])).toBe("salon");
    expect(mapCategory("indian_restaurant", [])).toBe("restaurant");
    expect(mapCategory("clothing_store", [])).toBe("retail");
    expect(mapCategory("juice_shop", ["cafe"])).toBe("juice_shop");
    expect(mapCategory(undefined, ["point_of_interest"])).toBe("services");
    expect(mapCategory(undefined, [])).toBe("other");
  });

  it("falls back to the formatted address when components are missing", () => {
    const p = normalizePlace({ id: PLACE_ID, displayName: { text: "X" }, shortFormattedAddress: "Shop 4, MG Road" });
    expect(p).toMatchObject({ addressLine: "Shop 4, MG Road", city: null, pincode: null, phone: null });
  });
});
