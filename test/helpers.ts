import { exports } from "cloudflare:workers";
import { env } from "cloudflare:workers";

const BASE = "http://localhost";
let ipCounter = 0;

export class TestClient {
  private cookies = new Map<string, string>();
  private ip = `10.0.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;

  async request(method: string, path: string, body?: unknown, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set("Origin", BASE);
    headers.set("cf-connecting-ip", this.ip);
    if (this.cookies.size) headers.set("Cookie", [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "));
    let payload = init.body;
    if (body !== undefined) {
      headers.set("Content-Type", "application/json");
      payload = JSON.stringify(body);
    }
    const res = await exports.default.fetch(new Request(BASE + path, { redirect: "manual", ...init, method, headers, body: payload }));
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const idx = pair!.indexOf("=");
      const name = pair!.slice(0, idx);
      const value = pair!.slice(idx + 1);
      if (value === "" || /max-age=0/i.test(c)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("json") && !contentType.startsWith("text/")) {
      await res.arrayBuffer();
      return { status: res.status, json: null, headers: res.headers };
    }
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, json, headers: res.headers };
  }

  get = (path: string) => this.request("GET", path);
  post = (path: string, body?: unknown) => this.request("POST", path, body ?? {});
  patch = (path: string, body: unknown) => this.request("PATCH", path, body);
  delete = (path: string) => this.request("DELETE", path);
}

export const PASSWORD = "correct-horse-battery";

export function uniqueEmail(prefix = "user") {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}@example.com`;
}

export async function signUp(name = "Test User", email = uniqueEmail()) {
  const client = new TestClient();
  const res = await client.post("/api/auth/sign-up/email", { name, email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`sign-up failed ${res.status}: ${JSON.stringify(res.json)}`);
  return { client, email, userId: res.json.user.id as string };
}

export async function createBusiness(client: TestClient, overrides: Record<string, unknown> = {}) {
  const res = await client.post("/api/businesses", { name: "ABC Coffee House", category: "cafe", ...overrides });
  if (res.status !== 201) throw new Error(`create business failed ${res.status}: ${JSON.stringify(res.json)}`);
  return res.json.business as { id: string; slug: string; name: string };
}

/** Defaults to the Professional plan so feature tests aren't constrained by Free-plan limits; limit tests pass "free". */
export async function ownerWithBusiness(plan: "free" | "starter" | "professional" | "agency" = "professional") {
  const owner = await signUp("Owner");
  if (plan !== "free") await setPlan(owner.userId, plan);
  const business = await createBusiness(owner.client);
  return { ...owner, business };
}

export async function inviteAndAccept(
  owner: TestClient,
  businessId: string,
  role: "manager" | "staff",
  extra: Record<string, unknown> = {},
) {
  const member = await signUp(role === "manager" ? "Manager" : "Staff");
  const inv = await owner.post(`/api/businesses/${businessId}/invitations`, { email: member.email, role, ...extra });
  if (inv.status !== 201) throw new Error(`invite failed ${inv.status}: ${JSON.stringify(inv.json)}`);
  const token = new URL(inv.json.inviteUrl).pathname.split("/").pop()!;
  const acc = await member.client.post(`/api/invitations/${token}/accept`);
  if (acc.status !== 200) throw new Error(`accept failed ${acc.status}: ${JSON.stringify(acc.json)}`);
  return member;
}

/** Moves the user's account onto a plan (free/starter/professional/agency) for 30 days. */
export async function setPlan(userId: string, code: "free" | "starter" | "professional" | "agency") {
  await env.DB.prepare(
    `INSERT INTO subscriptions (id, user_id, plan_id, status, current_period_end, created_at, updated_at)
     VALUES (?1, ?2, (SELECT id FROM subscription_plans WHERE code = ?3), 'active', ?4, ?5, ?5)
     ON CONFLICT(user_id) DO UPDATE SET plan_id = excluded.plan_id, status = 'active', current_period_end = excluded.current_period_end`,
  )
    .bind(crypto.randomUUID(), userId, code, Date.now() + 30 * 86400_000, Date.now())
    .run();
}

export async function createProgram(client: TestClient, businessId: string, overrides: Record<string, unknown> = {}) {
  const res = await client.post(`/api/businesses/${businessId}/programs`, {
    name: "Coffee Card",
    stampsRequired: 5,
    rewards: [{ name: "Free coffee", pointsRequired: 5 }],
    ...overrides,
  });
  if (res.status !== 201) throw new Error(`create program failed ${res.status}: ${JSON.stringify(res.json)}`);
  return res.json.program as { id: string; rewards: { id: string; pointsRequired: number }[] };
}

let phoneCounter = 0;
export function uniquePhone() {
  phoneCounter++;
  return `9${String(Date.now() % 1e5).padStart(5, "0")}${String(phoneCounter).padStart(4, "0")}`.slice(0, 10);
}

/** Joins a program as a brand-new customer and returns a client holding the customer session cookie. */
export async function joinAsCustomer(slug: string, programId: string, extra: Record<string, unknown> = {}) {
  const customer = new TestClient();
  const phone = (extra.phone as string) ?? uniquePhone();
  const res = await customer.post("/api/c/join", { slug, programId, name: "Riya Shah", phone, ...extra });
  if (res.status !== 201) throw new Error(`join failed ${res.status}: ${JSON.stringify(res.json)}`);
  return { customer, cardId: res.json.cardId as string, phone };
}

export async function issueManual(staff: TestClient, businessId: string, cardId: string) {
  return staff.post(`/api/businesses/${businessId}/cards/${cardId}/points`, { idempotencyKey: crypto.randomUUID() });
}

/** Owner with a business, an active program and one joined customer. */
export async function loyaltySetup(programOverrides: Record<string, unknown> = {}) {
  const owner = await ownerWithBusiness();
  const program = await createProgram(owner.client, owner.business.id, programOverrides);
  const joined = await joinAsCustomer(owner.business.slug, program.id);
  return { owner, program, ...joined };
}

export { env };
