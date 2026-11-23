import { describe, expect, it } from "vitest";
import { env, PASSWORD, signUp, TestClient, uniqueEmail } from "./helpers";
import { hashPassword, verifyPassword } from "../src/worker/lib/password";

describe("password hashing", () => {
  it("hashes with PBKDF2 and verifies", async () => {
    const hash = await hashPassword("s3cret-pass");
    expect(hash.startsWith("pbkdf2_sha256$100000$")).toBe(true);
    expect(await verifyPassword({ hash, password: "s3cret-pass" })).toBe(true);
    expect(await verifyPassword({ hash, password: "wrong" })).toBe(false);
  });

  it("uses a unique salt per hash", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });

  it("rejects malformed hashes", async () => {
    expect(await verifyPassword({ hash: "garbage", password: "x" })).toBe(false);
    expect(await verifyPassword({ hash: "pbkdf2_sha256$999999999$a$b", password: "x" })).toBe(false);
  });
});

describe("authentication", () => {
  it("signs up, creates a session and exposes /api/me", async () => {
    const { client, email } = await signUp("Asha");
    const me = await client.get("/api/me");
    expect(me.status).toBe(200);
    expect(me.json.user).toMatchObject({ email, name: "Asha", role: "user" });
    expect(me.json.memberships).toEqual([]);
  });

  it("stores only a PBKDF2 hash, never the password", async () => {
    const { userId } = await signUp();
    const row = await env.DB.prepare("SELECT password FROM accounts WHERE user_id = ?").bind(userId).first<{ password: string }>();
    expect(row!.password).toMatch(/^pbkdf2_sha256\$/);
    expect(row!.password).not.toContain(PASSWORD);
  });

  it("cannot self-assign super_admin role at sign-up", async () => {
    const client = new TestClient();
    const email = uniqueEmail();
    await client.post("/api/auth/sign-up/email", { name: "Evil", email, password: PASSWORD, role: "super_admin" });
    const row = await env.DB.prepare("SELECT role FROM users WHERE email = ?").bind(email).first<{ role: string }>();
    expect(row?.role ?? "user").toBe("user");
  });

  it("rejects a wrong password and accepts the right one", async () => {
    const { email } = await signUp();
    const client = new TestClient();
    const bad = await client.post("/api/auth/sign-in/email", { email, password: "wrong-password" });
    expect(bad.status).toBe(401);
    const good = await client.post("/api/auth/sign-in/email", { email, password: PASSWORD });
    expect(good.status).toBe(200);
    expect((await client.get("/api/me")).status).toBe(200);
  });

  it("rejects short passwords", async () => {
    const res = await new TestClient().post("/api/auth/sign-up/email", { name: "X", email: uniqueEmail(), password: "short" });
    expect(res.status).toBe(400);
  });

  it("requires a session for protected routes", async () => {
    const res = await new TestClient().get("/api/me");
    expect(res.status).toBe(401);
    expect(res.json.error.code).toBe("UNAUTHORIZED");
  });

  it("blocks sign-up when the Super Admin disables it", async () => {
    await env.DB.prepare("INSERT INTO platform_settings (key, value, updated_at) VALUES ('signupsEnabled', 'false', 0) ON CONFLICT(key) DO UPDATE SET value = 'false'").run();
    try {
      const res = await new TestClient().post("/api/auth/sign-up/email", { name: "Late", email: uniqueEmail(), password: PASSWORD });
      expect(res.status).toBe(403);
    } finally {
      await env.DB.prepare("DELETE FROM platform_settings WHERE key = 'signupsEnabled'").run();
    }
  });

  it("invalidates the session on sign-out", async () => {
    const { client } = await signUp();
    await client.post("/api/auth/sign-out");
    expect((await client.get("/api/me")).status).toBe(401);
  });
});
