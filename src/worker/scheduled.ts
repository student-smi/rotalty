import { createDb } from "./db/client";
import { expireSubscriptions } from "./services/billing-cron";
import { processOutbox, runDailyAutomations } from "./services/marketing-cron";

export const CRON_EVERY_MINUTE = "* * * * *";
export const CRON_DAILY_9AM_IST = "30 3 * * *";

export async function runScheduled(controller: ScheduledController, env: Env) {
  const db = createDb(env.DB);
  if (controller.cron === CRON_EVERY_MINUTE) {
    await processOutbox(env, db);
  } else if (controller.cron === CRON_DAILY_9AM_IST) {
    await Promise.allSettled([runDailyAutomations(env, db), expireSubscriptions(db)]).then((results) => {
      for (const r of results) if (r.status === "rejected") console.error("daily job failed", r.reason);
    });
  }
}
