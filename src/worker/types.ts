import type { Auth, AuthUser, SessionData } from "./auth";
import type { DB } from "./db/client";
import type { businesses, customers } from "./db/schema";
import type { Permission, StaffRole } from "../shared/permissions";

export interface Membership {
  staffId: string;
  role: StaffRole;
  permissions: Permission[];
  locationId: string | null;
  business: typeof businesses.$inferSelect;
}

export type AppEnv = {
  Bindings: Env;
  Variables: {
    db: DB;
    auth: Auth;
    user: AuthUser | null;
    session: SessionData["session"] | null;
    membership: Membership;
    customer: typeof customers.$inferSelect | null;
  };
};
