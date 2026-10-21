import {
  Command,
  Focus,
  Keyboard,
  LayoutDashboard,
  Link2,
  LogIn,
  Menu,
  Moon,
  PanelLeftClose,
  Search,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Link, Navigate, Outlet, useLocation, useNavigate, useOutletContext } from "react-router";
import { toast } from "sonner";
import useSWR from "swr";

import { Brand } from "@/components/brand";
import { CommandCenter, type CommandAction } from "@/components/command-center";
import { NavTree } from "@/components/docs/nav-tree";
import { ShortcutsDialog } from "@/components/docs/shortcuts-dialog";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Hint } from "@/components/ui/tooltip";
import { modKey, useKeys, useModHotkey } from "@/hooks/use-hotkey";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { useSession } from "@/hooks/use-session";
import { useTheme } from "@/hooks/use-theme";
import { ApiError, keys, type TreeNode } from "@/lib/api";
import { DocsBaseContext, parseDocsPath } from "@/lib/docs-base";
import { cn } from "@/lib/utils";

interface DocsContext {
  tree: TreeNode[];
  treeLoading: boolean;
  focus: boolean;
  setFocus: (focus: boolean) => void;
  openSearch: () => void;
}

// eslint-disable-next-line react-refresh/only-export-components
export const useDocsContext = () => useOutletContext<DocsContext>();

export default function DocsLayout() {
  const { user } = useSession();
  const { resolved, setTheme } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [focus, setFocus] = usePersistedState("ah-focus", false);
  const { path: activePath } = parseDocsPath(location.pathname);
  const { data: tree, error, isLoading } = useSWR<TreeNode[]>(keys.tree);
  const onDocPage = activePath.length > 0;

  const toggleTheme = () => setTheme(resolved === "dark" ? "light" : "dark");
  useModHotkey("k", () => setSearchOpen((o) => !o));
  useKeys({
    "/": () => setSearchOpen(true),
    "?": () => setShortcutsOpen(true),
    f: () => onDocPage && setFocus((f) => !f),
    t: toggleTheme,
    Escape: () => focus && setFocus(false),
  });

  if (error instanceof ApiError && error.status === 401) {
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  }

  const actions: CommandAction[] = [
    { id: "theme", label: resolved === "dark" ? "Usar tema claro" : "Usar tema escuro", icon: Moon, shortcut: "T", keywords: "tema dark light", run: toggleTheme },
    { id: "focus", label: focus ? "Sair do modo foco" : "Ativar modo foco", icon: Focus, shortcut: "F", hint: "Esconde a navegação para leitura imersiva.", run: () => setFocus(!focus) },
    { id: "shortcuts", label: "Atalhos de teclado", icon: Keyboard, shortcut: "?", run: () => setShortcutsOpen(true) },
    {
      id: "copy",
      label: "Copiar link desta página",
      icon: Link2,
      run: () => navigator.clipboard.writeText(window.location.href).then(() => toast.success("Link copiado")),
    },
    user
      ? { id: "studio", label: "Abrir o Studio (admin)", icon: LayoutDashboard, keywords: "admin editar painel", run: () => navigate("/admin") }
      : { id: "login", label: "Entrar para editar", icon: LogIn, keywords: "login admin", run: () => navigate("/login") },
  ];

  const sidebar = (onNavigate?: () => void) => (
    <>
      <ScrollArea className="flex-1">
        <div className="px-2.5 pb-4">
          {isLoading ? (
            <div className="space-y-2 p-2">
              {Array.from({ length: 9 }, (_, i) => (
                <Skeleton key={i} className="h-7 rounded-lg" style={{ width: `${62 + ((i * 37) % 38)}%` }} />
              ))}
            </div>
          ) : (
            <NavTree
              nodes={tree ?? []}
              base="/docs"
              activePath={activePath}
              onNavigate={onNavigate}
              layoutId={onNavigate ? "nav-mobile" : "nav"}
            />
          )}
        </div>
      </ScrollArea>
      <div className="flex items-center gap-1.5 border-t border-border/70 px-4 py-2.5 text-xs text-muted-foreground">
        <kbd>{modKey}</kbd>
        <kbd>K</kbd>
        <span>buscar</span>
        <span className="ml-auto flex items-center gap-1.5">
          <kbd>?</kbd> atalhos
        </span>
      </div>
    </>
  );

  return (
    <DocsBaseContext.Provider value={{ base: "/docs" }}>
    <div className="relative min-h-screen bg-background font-sans text-foreground">
      <header className="docs-bar sticky top-0 z-40 border-b border-border/70 print:hidden">
        <div className="mx-auto flex h-[52px] max-w-[1480px] items-center gap-2 px-4 sm:gap-3">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Abrir navegação">
            <Menu />
          </Button>
          <Brand />
          <button
            onClick={() => setSearchOpen(true)}
            className="group mx-auto hidden h-9 w-full min-w-0 max-w-sm items-center gap-2.5 rounded-full bg-muted px-4 text-[13px] text-muted-foreground transition-colors hover:bg-foreground/[0.07] sm:flex"
          >
            <Search className="h-3.5 w-3.5" />
            <span className="flex-1 truncate text-left">Buscar ou executar um comando…</span>
            <span className="hidden gap-1 lg:flex">
              <kbd>{modKey}</kbd>
              <kbd>K</kbd>
            </span>
          </button>
          <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:ml-0">
            <Button variant="ghost" size="icon" className="sm:hidden" onClick={() => setSearchOpen(true)} aria-label="Buscar">
              <Search />
            </Button>
            {onDocPage && (
              <Hint label={focus ? "Sair do modo foco (F)" : "Modo foco (F)"}>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn("hidden lg:inline-flex", focus && "bg-foreground/[0.06] text-foreground")}
                  onClick={() => setFocus(!focus)}
                  aria-label="Modo foco"
                  aria-pressed={focus}
                >
                  {focus ? <PanelLeftClose /> : <Focus />}
                </Button>
              </Hint>
            )}
            <Hint label="Atalhos (?)">
              <Button variant="ghost" size="icon" className="hidden md:inline-flex" onClick={() => setShortcutsOpen(true)} aria-label="Atalhos">
                <Command />
              </Button>
            </Hint>
            <ThemeToggle />
            {user ? (
              <Button asChild size="sm" className="ml-1 rounded-full bg-foreground px-3.5 text-[13px] font-medium text-background shadow-none hover:bg-foreground/85 hover:shadow-none">
                <Link to="/admin">
                  <LayoutDashboard /> <span className="hidden sm:inline">Studio</span>
                </Link>
              </Button>
            ) : (
              <Button asChild size="sm" className="ml-1 rounded-full bg-foreground px-3.5 text-[13px] font-medium text-background shadow-none hover:bg-foreground/85 hover:shadow-none">
                <Link to={`/login?next=${encodeURIComponent(location.pathname)}`}>
                  <LogIn /> <span className="hidden sm:inline">Entrar</span>
                </Link>
              </Button>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1480px] gap-8 px-4 pt-6 print:block print:max-w-none print:p-0">
        <AnimatePresence initial={false}>
          {!(focus && onDocPage) && (
            <motion.aside
              key="sidebar"
              initial={{ opacity: 0, x: -24, width: 0 }}
              animate={{ opacity: 1, x: 0, width: 272 }}
              exit={{ opacity: 0, x: -24, width: 0 }}
              transition={{ duration: 0.28, ease: [0.2, 0.7, 0.2, 1] }}
              className="sticky top-[76px] hidden h-[calc(100vh-92px)] shrink-0 lg:block print:!hidden"
            >
              <div className="flex h-full w-[272px] flex-col border-r border-border/70">
                {sidebar()}
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="p-0">
            <SheetTitle className="sr-only">Navegação</SheetTitle>
            <SheetDescription className="sr-only">Árvore de páginas da documentação</SheetDescription>
            <div className="border-b p-4">
              <Brand />
            </div>
            {sidebar(() => setMobileOpen(false))}
          </SheetContent>
        </Sheet>

        <main className="min-w-0 flex-1 pb-16 print:pb-0">
          <Outlet
            context={
              {
                tree: tree ?? [],
                treeLoading: isLoading,
                focus,
                setFocus,
                openSearch: () => setSearchOpen(true),
              } satisfies DocsContext
            }
          />
        </main>
      </div>

      <CommandCenter
        open={searchOpen}
        onOpenChange={setSearchOpen}
        tree={tree ?? []}
        actions={actions}
        onOpenPage={(p) => navigate(`/docs/${p.path}`)}
      />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </div>
    </DocsBaseContext.Provider>
  );
}
