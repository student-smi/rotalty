import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { env, joinAsCustomer, loyaltySetup, TestClient } from "./helpers";
import { createCardToken, createWalletCode } from "../src/worker/services/card-token";

const ISSUER = "3388000000012345678";
let publicKey: CryptoKey;
let serviceAccount: string;

function toPem(der: ArrayBuffer) {
  const b64 = btoa(String.fromCharCode(...new Uint8Array(der)));
  return `-----BEGIN PRIVATE KEY-----\n${b64.match(/.{1,64}/g)!.join("\n")}\n-----END PRIVATE KEY-----\n`;
}

const b64urlDecode = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  publicKey = pair.publicKey;
  serviceAccount = JSON.stringify({
    type: "service_account",
    client_email: "wallet-issuer@test-project.iam.gserviceaccount.com",
    private_key: toPem((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer),
  });
});

interface Call {
  method: string;
  url: string;
  auth: string | null;
  body: any;
}
const realFetch = globalThis.fetch;
let calls: Call[] = [];
let classExists = false;

beforeEach(() => {
  calls = [];
  classExists = false;
  (env as Env).GOOGLE_WALLET_ISSUER_ID = ISSUER;
  (env as Env).GOOGLE_WALLET_SERVICE_ACCOUNT = serviceAccount;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const req = new Request(input as RequestInfo, init);
    if (req.url === "https://oauth2.googleapis.com/token") {
      calls.push({ method: req.method, url: req.url, auth: null, body: Object.fromEntries(new URLSearchParams(await req.text())) });
      return Response.json({ access_token: "test-access-token", expires_in: 3600, token_type: "Bearer" });
    }
    if (req.url.startsWith("https://walletobjects.googleapis.com/")) {
      const text = await req.text();
      calls.push({ method: req.method, url: req.url, auth: req.headers.get("Authorization"), body: text ? JSON.parse(text) : null });
      if (req.method === "POST" && req.url.endsWith("/loyaltyClass") && classExists) return Response.json({ error: { code: 409 } }, { status: 409 });
      return Response.json({});
    }
    return realFetch(input as RequestInfo, init);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (env as Env).GOOGLE_WALLET_ISSUER_ID;
  delete (env as Env).GOOGLE_WALLET_SERVICE_ACCOUNT;
});

const walletCalls = () => calls.filter((c) => c.url.startsWith("https://walletobjects"));

describe("Add to Google Wallet", () => {
  it("tells the card page whether Google Wallet is available", async () => {
    const { customer } = await loyaltySetup();
    expect((await customer.get("/api/c/cards")).json.cards[0].googleWallet).toBe(true);
    delete (env as Env).GOOGLE_WALLET_SERVICE_ACCOUNT;
    expect((await customer.get("/api/c/cards")).json.cards[0].googleWallet).toBe(false);
  });

  it("creates the program class and card object, then returns a signed save link", async () => {
    const { owner, program, customer, cardId } = await loyaltySetup();
    const res = await customer.post(`/api/c/cards/${cardId}/google-wallet`, {});
    expect(res.status).toBe(200);
    expect(res.json.saveUrl).toMatch(/^https:\/\/pay\.google\.com\/gp\/v\/save\/[\w-]+\.[\w-]+\.[\w-]+$/);

    // Service-account OAuth with the Wallet issuer scope.
    const token = calls.find((c) => c.url.includes("oauth2"))!;
    expect(token.body.grant_type).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    const assertion = JSON.parse(new TextDecoder().decode(b64urlDecode(token.body.assertion.split(".")[1])));
    expect(assertion).toMatchObject({ iss: "wallet-issuer@test-project.iam.gserviceaccount.com", scope: "https://www.googleapis.com/auth/wallet_object.issuer" });

    const [cls, obj] = walletCalls();
    expect(cls!.method).toBe("POST");
    expect(cls!.auth).toBe("Bearer test-access-token");
    expect(cls!.body).toMatchObject({
      id: `${ISSUER}.program-${program.id}`,
      issuerName: owner.business.name,
      programName: "Coffee Card",
      reviewStatus: "UNDER_REVIEW",
      programLogo: { sourceUri: { uri: "http://localhost/wallet-logo.png" } },
    });
    expect(obj!.body).toMatchObject({
      id: `${ISSUER}.card-${cardId}`,
      classId: `${ISSUER}.program-${program.id}`,
      state: "ACTIVE",
      loyaltyPoints: { label: "Stamps", balance: { string: "0 / 5" } },
      barcode: { type: "QR_CODE", value: await createWalletCode(env.BETTER_AUTH_SECRET, cardId) },
      textModulesData: [{ id: "next", header: "Next reward", body: "5 more for Free coffee" }],
    });
    expect(obj!.body.linksModuleData.uris[0]).toEqual({ id: "card", uri: `http://localhost/c/cards/${cardId}`, description: "Open my card" });

    // The save JWT references the object and is signed with the service account key.
    const jwt = res.json.saveUrl.split("/save/")[1] as string;
    const [h, p, s] = jwt.split(".");
    expect(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, b64urlDecode(s!), new TextEncoder().encode(`${h}.${p}`))).toBe(true);
    const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(p!)));
    expect(claims).toMatchObject({
      aud: "google",
      typ: "savetowallet",
      origins: ["http://localhost"],
      payload: { loyaltyObjects: [{ id: `${ISSUER}.card-${cardId}`, classId: `${ISSUER}.program-${program.id}` }] },
    });

    const row = await env.DB.prepare("SELECT platform, object_id FROM wallet_passes WHERE card_id = ?").bind(cardId).first();
    expect(row).toEqual({ platform: "google", object_id: `${ISSUER}.card-${cardId}` });
  });

  it("updates an existing program class instead of failing", async () => {
    classExists = true;
    const { customer, cardId, program } = await loyaltySetup();
    expect((await customer.post(`/api/c/cards/${cardId}/google-wallet`, {})).status).toBe(200);
    const patch = walletCalls().find((c) => c.method === "PATCH");
    expect(patch!.url).toContain(`/loyaltyClass/${encodeURIComponent(`${ISSUER}.program-${program.id}`)}`);
  });

  it("only works for the customer's own card and when configured", async () => {
    const { owner, program, cardId } = await loyaltySetup();
    const other = await joinAsCustomer(owner.business.slug, program.id);
    expect((await other.customer.post(`/api/c/cards/${cardId}/google-wallet`, {})).status).toBe(404);
    expect((await new TestClient().post(`/api/c/cards/${cardId}/google-wallet`, {})).status).toBe(401);

    delete (env as Env).GOOGLE_WALLET_ISSUER_ID;
    const off = await other.customer.post(`/api/c/cards/${other.cardId}/google-wallet`, {});
    expect(off.status).toBe(503);
    expect(off.json.error.code).toBe("WALLET_NOT_CONFIGURED");
  });
});

describe("wallet QR at the counter", () => {
  it("collects a stamp with the wallet code and pushes the new count to Google Wallet", async () => {
    const { owner, customer, cardId } = await loyaltySetup();
    await customer.post(`/api/c/cards/${cardId}/google-wallet`, {});
    calls = [];

    const code = await createWalletCode(env.BETTER_AUTH_SECRET, cardId);
    const res = await owner.client.post(`/api/businesses/${owner.business.id}/issue/scan`, { token: code });
    expect(res.status).toBe(200);
    expect(res.json.result.pointsBalance).toBe(1);

    await vi.waitFor(() => expect(walletCalls().some((c) => c.method === "PATCH")).toBe(true));
    const patch = walletCalls().find((c) => c.method === "PATCH")!;
    expect(patch.url).toContain(`/loyaltyObject/${encodeURIComponent(`${ISSUER}.card-${cardId}`)}`);
    expect(patch.body.loyaltyPoints.balance.string).toBe("1 / 5");
  });

  it("rejects a tampered wallet code", async () => {
    const { owner, cardId } = await loyaltySetup();
    const code = await createWalletCode(env.BETTER_AUTH_SECRET, cardId);
    const forged = `${code.slice(0, -4)}AAAA`;
    expect((await owner.client.post(`/api/businesses/${owner.business.id}/issue/scan`, { token: forged })).status).toBe(400);
  });

  it("tells the scanner when a reward is being claimed with a wallet code", async () => {
    const { owner, cardId } = await loyaltySetup();
    const url = `/api/businesses/${owner.business.id}/cards/resolve`;
    const wallet = await owner.client.post(url, { token: await createWalletCode(env.BETTER_AUTH_SECRET, cardId) });
    expect(wallet.json).toMatchObject({ source: "wallet", card: { id: cardId } });
    const rotating = await owner.client.post(url, { token: (await createCardToken(env.BETTER_AUTH_SECRET, cardId)).token });
    expect(rotating.json.source).toBe("rotating");
  });

  it("marks the pass inactive when the shop blocks the card", async () => {
    const { owner, customer, cardId } = await loyaltySetup();
    await customer.post(`/api/c/cards/${cardId}/google-wallet`, {});
    calls = [];
    expect((await owner.client.patch(`/api/businesses/${owner.business.id}/cards/${cardId}`, { status: "blocked" })).status).toBe(200);
    await vi.waitFor(() => expect(walletCalls().some((c) => c.method === "PATCH")).toBe(true));
    expect(walletCalls().find((c) => c.method === "PATCH")!.body.state).toBe("INACTIVE");
  });

  it("doesn't call Google for cards that were never added to the wallet", async () => {
    const { owner, cardId } = await loyaltySetup();
    await owner.client.post(`/api/businesses/${owner.business.id}/issue/scan`, { token: await createWalletCode(env.BETTER_AUTH_SECRET, cardId) });
    await new Promise((r) => setTimeout(r, 50));
    expect(walletCalls()).toHaveLength(0);
  });
});
