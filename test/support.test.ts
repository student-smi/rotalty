import { describe, expect, it } from "vitest";
import { env, signUp, TestClient } from "./helpers";

async function superAdmin() {
  const admin = await signUp("Admin");
  await env.DB.prepare("UPDATE users SET role = 'super_admin' WHERE id = ?").bind(admin.userId).run();
  return admin;
}

const message = { name: "Riya Shah", contact: "riya@example.com", topic: "customer", message: "I changed my phone and can't find my card." };

describe("support contact form", () => {
  it("accepts a message with an email or an Indian mobile number, without login", async () => {
    expect((await new TestClient().post("/api/public/support", message)).status).toBe(201);
    expect((await new TestClient().post("/api/public/support", { ...message, contact: "98765 43210", topic: "shop_owner", businessName: "Chai Point" })).status).toBe(201);
  });

  it("validates the contact, topic and message", async () => {
    const bad = await new TestClient().post("/api/public/support", { ...message, contact: "not a contact" });
    expect(bad.status).toBe(400);
    expect((await new TestClient().post("/api/public/support", { ...message, message: "help" })).status).toBe(400);
    expect((await new TestClient().post("/api/public/support", { ...message, topic: "sales" })).status).toBe(400);
  });

  it("lets only super admins read and close messages", async () => {
    const unique = `Privacy request ${crypto.randomUUID()}`;
    await new TestClient().post("/api/public/support", { ...message, topic: "privacy", message: unique });

    const user = await signUp();
    expect((await user.client.get("/api/admin/support")).status).toBe(403);

    const admin = await superAdmin();
    const open = await admin.client.get("/api/admin/support");
    const mine = open.json.messages.find((m: { message: string }) => m.message === unique);
    expect(mine).toMatchObject({ topic: "privacy", status: "open", contact: "riya@example.com" });

    expect((await admin.client.patch(`/api/admin/support/${mine.id}`, { status: "closed" })).status).toBe(200);
    const stillOpen = await admin.client.get("/api/admin/support");
    expect(stillOpen.json.messages.some((m: { id: string }) => m.id === mine.id)).toBe(false);
    const closed = await admin.client.get("/api/admin/support?status=closed");
    expect(closed.json.messages.some((m: { id: string }) => m.id === mine.id)).toBe(true);
  });
});
