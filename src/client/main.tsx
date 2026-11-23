import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./index.css";
import { authClient } from "./lib/auth";
import { ApiError } from "./lib/api";
import { PageLoader } from "./components/ui";
import { ForgotPasswordPage, LoginPage, ResetPasswordPage, SignupPage } from "./pages/auth";
import { AppHome, OverviewPage } from "./pages/business";
import { OnboardingPage } from "./pages/onboarding";
import { LandingPage } from "./pages/landing";
import { SettingsPage } from "./pages/settings";
import { StaffPage } from "./pages/staff";
import { AcceptInvitePage } from "./pages/invite";
import { AdminPage } from "./pages/admin";
import { LoyaltyProgramsPage } from "./pages/loyalty";
import { QrNfcPage } from "./pages/qr-nfc";
import { ScanPage } from "./pages/scan";
import { RewardsPage } from "./pages/rewards";
import { LinkInvalidPage, PublicBusinessPage } from "./pages/public-business";
import { CustomerCardPage, CustomerCardsPage, CustomerLoginPage, CustomerSettingsPage } from "./pages/customer";
import { ReviewsSettingsPage } from "./pages/reviews-settings";
import { ReviewAssistantPage } from "./pages/review-assistant";
import { CustomerDetailPage, CustomersPage } from "./pages/customers";
import { MarketingPage } from "./pages/marketing";
import { AnalyticsPage } from "./pages/analytics";
import { SubscriptionPage } from "./pages/subscription";
import { DashboardLayout } from "./layouts/DashboardLayout";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});

function RequireAuth() {
  const { data, isPending } = authClient.useSession();
  const location = useLocation();
  if (isPending) return <PageLoader />;
  if (!data) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return <Outlet />;
}

function GuestOnly() {
  const { data, isPending } = authClient.useSession();
  if (isPending) return <PageLoader />;
  if (data) return <Navigate to="/app" replace />;
  return <Outlet />;
}

const router = createBrowserRouter([
  { path: "/", element: <LandingPage /> },
  {
    element: <GuestOnly />,
    children: [
      { path: "/login", element: <LoginPage /> },
      { path: "/signup", element: <SignupPage /> },
      { path: "/forgot-password", element: <ForgotPasswordPage /> },
    ],
  },
  { path: "/reset-password", element: <ResetPasswordPage /> },
  { path: "/invite/:token", element: <AcceptInvitePage /> },

  // Customer-facing (no staff account needed)
  { path: "/s/:slug", element: <PublicBusinessPage /> },
  { path: "/s/:slug/review", element: <ReviewAssistantPage /> },
  { path: "/c", element: <CustomerCardsPage /> },
  { path: "/c/login", element: <CustomerLoginPage /> },
  { path: "/c/settings", element: <CustomerSettingsPage /> },
  { path: "/c/cards/:cardId", element: <CustomerCardPage /> },
  { path: "/link-invalid", element: <LinkInvalidPage /> },

  {
    element: <RequireAuth />,
    children: [
      { path: "/app", element: <AppHome /> },
      { path: "/app/onboarding", element: <OnboardingPage /> },
      {
        path: "/app/b/:businessId",
        element: <DashboardLayout />,
        children: [
          { index: true, element: <OverviewPage /> },
          { path: "scan", element: <ScanPage /> },
          { path: "loyalty", element: <LoyaltyProgramsPage /> },
          { path: "qr-nfc", element: <QrNfcPage /> },
          { path: "customers", element: <CustomersPage /> },
          { path: "customers/:customerId", element: <CustomerDetailPage /> },
          { path: "rewards", element: <RewardsPage /> },
          { path: "reviews", element: <ReviewsSettingsPage /> },
          { path: "marketing", element: <MarketingPage /> },
          { path: "analytics", element: <AnalyticsPage /> },
          { path: "staff", element: <StaffPage /> },
          { path: "settings", element: <SettingsPage /> },
          { path: "subscription", element: <SubscriptionPage /> },
        ],
      },
      { path: "/admin", element: <AdminPage /> },
    ],
  },
  { path: "*", element: <Navigate to="/" replace /> },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
