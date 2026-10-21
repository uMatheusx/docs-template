import {
  BookOpen,
  Command,
  FilePlus2,
  FileUp,
  GitPullRequest,
  Layers,
  Images,
  LayoutGrid,
  Loader2,
  LogOut,
  Moon,
  PenSquare,
  type LucideIcon,
} from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { Navigate, NavLink, Outlet, useLocation, useNavigate, useOutletContext } from "react-router";
import useSWR from "swr";

import { ImportDialog } from "@/components/admin/import-dialog";
import { NewPageDialog } from "@/components/admin/new-page-dialog";
import { Logo } from "@/components/brand";
import { CommandCenter, type CommandAction } from "@/components/command-center";
import { ThemeSegmented, ThemeToggle } from "@/components/theme-toggle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Hint } from "@/components/ui/tooltip";
import { modKey, useKeys, useModHotkey } from "@/hooks/use-hotkey";
import { useSession } from "@/hooks/use-session";
import { useTheme } from "@/hooks/use-theme";
import { keys, type Stats, type TreeNode } from "@/lib/api";
import { cn } from "@/lib/utils";

interface AdminContext {
  tree: TreeNode[];
  treeLoading: boolean;
  openNewPage: (parentId?: string | null) => void;
  openImport: () => void;
  openPalette: () => void;
}

// eslint-disable-next-line react-refresh/only-export-components
export const useAdmin = () => useOutletContext<AdminContext>();

const NAV: { to: string; label: string; icon: LucideIcon; end: boolean }[] = [
  { to: "/admin", label: "Visão geral", icon: LayoutGrid, end: true },
  { to: "/admin/pages", label: "Studio", icon: PenSquare, end: false },
  { to: "/admin/changes", label: "Alterações", icon: Layers, end: false },
  { to: "/admin/reviews", label: "Revisões", icon: GitPullRequest, end: false },
  { to: "/admin/media", label: "Arquivos", icon: Images, end: true },
];

function RailButton({ label, children, onClick }: { label: string; children: React.ReactNode; onClick?: () => void }) {
  return (
    <Hint label={label} side="right">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className="flex h-10 w-10 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground [&_svg]:h-[18px] [&_svg]:w-[18px]"
      >
        {children}
      </button>
    </Hint>
  );
}

export default function AdminLayout() {
  const { user, isLoading, logout } = useSession();
  const { resolved, setTheme } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [newParent, setNewParent] = useState<string | null | undefined>(undefined);
  const [importOpen, setImportOpen] = useState(false);
  const { data: tree, isLoading: treeLoading } = useSWR<TreeNode[]>(user ? keys.adminTree : null);
  const { data: stats } = useSWR<Stats>(user ? keys.stats : null, { refreshInterval: 60_000 });

  useModHotkey("k", () => setPaletteOpen((o) => !o), !!user);
  useKeys({ n: () => setNewParent(null), "/": () => setPaletteOpen(true) }, !!user);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-brand" />
      </div>
    );
  }
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;

  const signOut = async () => {
    await logout();
    navigate("/docs");
  };

  const actions: CommandAction[] = [
    { id: "new", label: "Nova página", icon: FilePlus2, shortcut: "N", keywords: "criar adicionar", run: () => setNewParent(null) },
    { id: "import", label: "Importar .md ou especificação (OpenAPI/AsyncAPI)", icon: FileUp, keywords: "upload arquivo url", run: () => setImportOpen(true) },
    { id: "overview", label: "Ir para Visão geral", icon: LayoutGrid, keywords: "dashboard painel", run: () => navigate("/admin") },
    { id: "studio", label: "Ir para o Studio", icon: PenSquare, keywords: "editor páginas", run: () => navigate("/admin/pages") },
    { id: "reviews", label: "Ir para Revisões", icon: GitPullRequest, keywords: "propostas aprovar pull request", run: () => navigate("/admin/reviews") },
    { id: "media", label: "Ir para Arquivos", icon: Images, keywords: "imagens arquivos s3 mídia contratos openapi asyncapi", run: () => navigate("/admin/media") },
    { id: "docs", label: "Abrir a documentação", icon: BookOpen, run: () => window.open("/docs", "_blank") },
    { id: "theme", label: resolved === "dark" ? "Usar tema claro" : "Usar tema escuro", icon: Moon, run: () => setTheme(resolved === "dark" ? "light" : "dark") },
    { id: "logout", label: "Sair", icon: LogOut, run: signOut },
  ];

  const context: AdminContext = {
    tree: tree ?? [],
    treeLoading,
    openNewPage: (parentId = null) => setNewParent(parentId),
    openImport: () => setImportOpen(true),
    openPalette: () => setPaletteOpen(true),
  };

  return (
    <div className="flex h-screen flex-col bg-sidebar md:flex-row">
      <aside className="flex shrink-0 items-center gap-1 px-2 py-2 md:w-[76px] md:flex-col md:px-0 md:py-4">
        <NavLink to="/admin" aria-label="Account Hub Studio" className="mb-0 md:mb-5">
          <Logo className="h-9 w-9 transition-transform hover:-rotate-6" />
        </NavLink>
        <nav className="flex gap-1 md:flex-col md:gap-2">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className="group relative flex flex-col items-center gap-1 px-1.5 md:px-0">
              {({ isActive }) => (
                <>
                  <span
                    className={cn(
                      "relative flex h-10 w-10 items-center justify-center rounded-xl transition-colors",
                      isActive ? "text-brand-ink" : "text-muted-foreground group-hover:bg-foreground/[0.06] group-hover:text-foreground",
                    )}
                  >
                    {isActive && (
                      <motion.span
                        layoutId="rail-pill"
                        transition={{ type: "spring", stiffness: 500, damping: 36 }}
                        className="absolute inset-0 rounded-xl bg-brand/[0.12]"
                      />
                    )}
                    <Icon className="relative h-[18px] w-[18px]" />
                    {to === "/admin/reviews" && !!stats?.open_reviews && (
                      <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brand px-1 text-[10px] font-semibold text-navy-900 ring-2 ring-sidebar">
                        {stats.open_reviews}
                      </span>
                    )}
                  </span>
                  <span className={cn("hidden text-[10px] font-medium md:block", isActive ? "text-foreground" : "text-muted-foreground")}>
                    {label}
                  </span>
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1 md:ml-0 md:mt-auto md:flex-col md:gap-2">
          <RailButton label={`Command Center (${modKey} K)`} onClick={() => setPaletteOpen(true)}>
            <Command />
          </RailButton>
          <RailButton label="Ver documentação" onClick={() => window.open("/docs", "_blank")}>
            <BookOpen />
          </RailButton>
          <ThemeToggle className="h-10 w-10 rounded-xl text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="mt-1 flex h-10 w-10 items-center justify-center rounded-full bg-foreground text-xs font-semibold uppercase text-background ring-2 ring-sidebar transition-opacity hover:opacity-85"
                aria-label="Conta"
              >
                {user.username.slice(0, 2)}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="end" className="w-72">
              <DropdownMenuLabel className="flex flex-col">
                <span className="text-sm font-bold text-foreground">{user.username}</span>
                <span>{user.role === "admin" ? "Administrador" : "Editor"}</span>
              </DropdownMenuLabel>
              <div className="px-1.5 py-1">
                <ThemeSegmented layoutId="theme-seg-admin" />
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={signOut}>
                <LogOut /> Sair
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      <main className="min-h-0 min-w-0 flex-1 overflow-hidden bg-background md:my-2 md:mr-2 md:rounded-xl md:border md:border-border/70">
        <div className="h-full overflow-y-auto">
          <Outlet context={context} />
        </div>
      </main>

      <CommandCenter
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        tree={tree ?? []}
        actions={actions}
        placeholder="Ir para uma página ou executar uma ação…"
        onOpenPage={(p) => navigate(`/admin/pages/${p.id}`)}
      />
      <NewPageDialog open={newParent !== undefined} onOpenChange={(o) => !o && setNewParent(undefined)} parentId={newParent} />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}
