import { it, expect } from "vitest";
import { env, signUp } from "./helpers";
it("saves the settings form exactly as the admin page sends it", async () => {
  const a = await signUp("Admin");
  await env.DB.prepare("UPDATE users SET role = 'super_admin' WHERE id = ?").bind(a.userId).run();
  const res = await a.client.request("PUT", "/api/admin/settings", {
    maintenanceMessage: null, signupsEnabled: true, upiId: "smitpanchal0812@okhdfcbank", upiPayeeName: "repeatly", paymentMethod: "upi", provisionalAccess: true,
  });
  expect(res.status).toBe(200);
  expect(res.json.settings).toMatchObject({ maintenanceMessage: null, upiId: "smitpanchal0812@okhdfcbank", paymentMethod: "upi" });
});
