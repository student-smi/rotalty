import { lazy, StrictMode, Suspense, type ComponentType, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@fontsource-variable/inter";
import "./index.css";
import { initPwa } from "./lib/pwa";
import { ApiError } from "./lib/api";
import {
  CardDetailSkeleton,
  CardsPageSkeleton,
  DashboardPageSkeleton,
  DashboardShellSkeleton,
  EditorSkeleton,
  ShopPageSkeleton,
  SimplePageSkeleton,
} from "./components/skeletons";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});

/**
 * Lazy pages: each page's code is downloaded only when it's opened, so a customer scanning a QR never
 * downloads the dashboard. A skeleton of the right shape shows while the code arrives.
 */
type Loader = () => Promise<Record<string, unknown>>;
const cache = new Map<string, ComponentType>();
function page(load: Loader, name: string, fallback: ReactNode) {
  const key = `${load.toString()}#${name}`;
  let C = cache.get(key);
  if (!C) {
    C = lazy(() => load().then((m) => ({ default: m[name] as ComponentType })));
    cache.set(key, C);
  }
  const Component = C;
  return (
    <Suspense fallback={fallback}>
      <Component />
    </Suspense>
  );
}

const simple = <SimplePageSkeleton />;
const dash = <DashboardPageSkeleton />;
const editor = <EditorSkeleton />;

const auth = () => import("./pages/auth");
const legal = () => import("./pages/legal");
const guards = () => import("./routes/guards");
const pub = () => import("./pages/public-business");
const customer = () => import("./pages/customer");
const business = () => import("./pages/business");

const router = createBrowserRouter([
  { path: "/", element: page(() => import("./pages/landing"), "LandingPage", simple) },
  { path: "/support", element: page(legal, "SupportPage", simple) },
  { path: "/privacy", element: page(legal, "PrivacyPage", simple) },
  { path: "/terms", element: page(legal, "TermsPage", simple) },
  {
    element: page(guards, "GuestOnly", simple),
    children: [
      { path: "/login", element: page(auth, "LoginPage", simple) },
      { path: "/signup", element: page(auth, "SignupPage", simple) },
      { path: "/forgot-password", element: page(auth, "ForgotPasswordPage", simple) },
    ],
  },
  { path: "/reset-password", element: page(auth, "ResetPasswordPage", simple) },
  { path: "/invite/:token", element: page(() => import("./pages/invite"), "AcceptInvitePage", simple) },

  // Customer-facing (no staff account needed)
  { path: "/s/:slug", element: page(pub, "PublicBusinessPage", <ShopPageSkeleton />) },
  { path: "/s/:slug/review", element: page(() => import("./pages/review-assistant"), "ReviewAssistantPage", <ShopPageSkeleton />) },
  { path: "/c", element: page(customer, "CustomerCardsPage", <CardsPageSkeleton />) },
  { path: "/c/login", element: page(customer, "CustomerLoginPage", simple) },
  { path: "/c/settings", element: page(customer, "CustomerSettingsPage", simple) },
  { path: "/c/cards/:cardId", element: page(customer, "CustomerCardPage", <CardDetailSkeleton />) },
  { path: "/link-invalid", element: page(pub, "LinkInvalidPage", simple) },

  {
    element: page(guards, "RequireAuth", simple),
    children: [
      { path: "/app", element: page(business, "AppHome", simple) },
      { path: "/app/onboarding", element: page(() => import("./pages/onboarding"), "OnboardingPage", simple) },
      {
        path: "/app/b/:businessId",
        element: page(() => import("./layouts/DashboardLayout"), "DashboardLayout", <DashboardShellSkeleton />),
        children: [
          { index: true, element: page(business, "OverviewPage", dash) },
          { path: "scan", element: page(() => import("./pages/scan"), "ScanPage", dash) },
          { path: "loyalty", element: page(() => import("./pages/loyalty"), "LoyaltyProgramsPage", dash) },
          { path: "loyalty/new", element: page(() => import("./pages/program-editor"), "ProgramEditorPage", editor) },
          { path: "loyalty/:programId", element: page(() => import("./pages/program-editor"), "ProgramEditorPage", editor) },
          { path: "qr-nfc", element: page(() => import("./pages/qr-nfc"), "QrNfcPage", dash) },
          { path: "qr-nfc/poster", element: page(() => import("./pages/poster-editor"), "PosterEditorPage", editor) },
          { path: "customers", element: page(() => import("./pages/customers"), "CustomersPage", dash) },
          { path: "customers/:customerId", element: page(() => import("./pages/customers"), "CustomerDetailPage", dash) },
          { path: "rewards", element: page(() => import("./pages/rewards"), "RewardsPage", dash) },
          { path: "reviews", element: page(() => import("./pages/reviews-settings"), "ReviewsSettingsPage", editor) },
          { path: "marketing", element: page(() => import("./pages/whatsapp"), "WhatsAppPage", dash) },
          { path: "analytics", element: page(() => import("./pages/analytics"), "AnalyticsPage", dash) },
          { path: "staff", element: page(() => import("./pages/staff"), "StaffPage", dash) },
          { path: "settings", element: page(() => import("./pages/settings"), "SettingsPage", editor) },
          { path: "subscription", element: page(() => import("./pages/subscription"), "SubscriptionPage", dash) },
        ],
      },
      { path: "/admin", element: page(() => import("./pages/admin"), "AdminPage", dash) },
    ],
  },
  { path: "*", element: <Navigate to="/" replace /> },
]);

initPwa();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
