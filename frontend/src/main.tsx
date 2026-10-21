import "./index.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate } from "react-router";
import { RouterProvider } from "react-router/dom";
import { SWRConfig } from "swr";

import { TypePreview } from "@/components/type-preview";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/hooks/use-theme";
import { ApiError, fetcher } from "@/lib/api";
import { applyTypography, PREVIEW_KEY, readTypography } from "@/lib/typography";
import CurrentVersionRedirect from "@/pages/docs/current-redirect";
import DocPage from "@/pages/docs/doc-page";
import DocsHome from "@/pages/docs/docs-home";
import DocsLayout from "@/pages/docs/docs-layout";
import LoginPage from "@/pages/login";
import NotFound from "@/pages/not-found";

// O painel admin (CodeMirror etc.) é carregado sob demanda.
const lazyPage = (load: () => Promise<{ default: React.ComponentType }>) => async () => ({
  Component: (await load()).default,
});

const router = createBrowserRouter([
  { path: "/", element: <Navigate to="/docs" replace />, errorElement: <NotFound /> },
  { path: "/login", element: <LoginPage /> },
  {
    path: "/docs",
    element: <DocsLayout />,
    errorElement: <NotFound />,
    children: [
      { index: true, element: <DocsHome /> },
      { path: "*", element: <DocPage /> },
    ],
  },
  // links antigos de releases (funcionalidade removida) levam sempre à versão atual
  { path: "/docs/v/:release/*", element: <CurrentVersionRedirect /> },
  { path: "/docs/v/:release", element: <Navigate to="/docs" replace /> },
  {
    path: "/admin",
    lazy: lazyPage(() => import("@/pages/admin/admin-layout")),
    errorElement: <NotFound />,
    children: [
      { index: true, lazy: lazyPage(() => import("@/pages/admin/dashboard")) },
      { path: "pages", lazy: lazyPage(() => import("@/pages/admin/pages")) },
      { path: "pages/:id", lazy: lazyPage(() => import("@/pages/admin/pages")) },
      { path: "media", lazy: lazyPage(() => import("@/pages/admin/media")) },
      { path: "changes", lazy: lazyPage(() => import("@/pages/admin/changes")) },
      { path: "reviews", lazy: lazyPage(() => import("@/pages/admin/reviews")) },
      { path: "reviews/:id", lazy: lazyPage(() => import("@/pages/admin/review-detail")) },
      { path: "reviews/lote/:id", lazy: lazyPage(() => import("@/pages/admin/batch-detail")) },
    ],
  },
  { path: "*", element: <NotFound /> },
]);

// pré-visualização de tipografia: ?tipografia abre o painel; a escolha fica neste navegador
if (new URLSearchParams(window.location.search).has("tipografia")) {
  try {
    localStorage.setItem(PREVIEW_KEY, "1");
  } catch {
    /* armazenamento indisponível */
  }
}
applyTypography(readTypography(), false);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <SWRConfig
        value={{
          fetcher,
          revalidateOnFocus: false,
          shouldRetryOnError: (err) => !(err instanceof ApiError && err.status < 500),
        }}
      >
        <TooltipProvider delayDuration={300}>
          <RouterProvider router={router} />
          <Toaster />
          <TypePreview />
        </TooltipProvider>
      </SWRConfig>
    </ThemeProvider>
  </StrictMode>,
);
