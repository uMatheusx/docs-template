import { Command as CommandPrimitive } from "cmdk";
import { ArrowRight, CornerDownLeft, FileText, Loader2, Search, Sparkles, type LucideIcon } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import useSWR from "swr";

import { PageIcon } from "@/components/common/page-icon";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { keys, type SearchResult, type TreeNode } from "@/lib/api";
import { flattenTree } from "@/lib/tree";
import { cn, normalize, timeAgo } from "@/lib/utils";

export interface CommandAction {
  id: string;
  label: string;
  icon: LucideIcon;
  hint?: string;
  shortcut?: string;
  keywords?: string;
  run: () => void;
}

interface Preview {
  title: string;
  subtitle: string;
  body?: string;
  icon?: string | null;
  lucide?: LucideIcon;
  meta?: string;
  draft?: boolean;
}

interface CommandCenterProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tree: TreeNode[];
  onOpenPage: (page: { id: string; path: string }) => void;
  actions?: CommandAction[];
  placeholder?: string;
}

function Highlight({ text, query }: { text: string; query: string }) {
  const terms = query.trim().split(/\s+/).filter(Boolean).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!terms.length) return <>{text}</>;
  const parts = text.split(new RegExp(`(${terms.join("|")})`, "gi"));
  return (
    <>
      {parts.map((part, i) =>
        i % 2 ? (
          <mark key={i} className="rounded bg-brand/20 px-0.5 text-foreground">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}

export function CommandCenter({ open, onOpenChange, tree, onOpenPage, actions = [], placeholder }: CommandCenterProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");
  const q = useDeferredValue(query.trim());
  const nq = normalize(q);

  const pages = useMemo(() => flattenTree(tree), [tree]);
  const { data: hits, isLoading } = useSWR<SearchResult[]>(open && q.length >= 2 ? keys.search(q) : null, {
    keepPreviousData: true,
  });

  const pageMatches = q
    ? pages
        .filter((p) => normalize(p.title).includes(nq) || normalize(p.path).includes(nq))
        .sort((a, b) => Number(normalize(b.title).startsWith(nq)) - Number(normalize(a.title).startsWith(nq)))
        .slice(0, 8)
    : pages.slice(0, 8);
  const contentHits = q.length >= 2 ? (hits ?? []).filter((h) => !pageMatches.some((p) => p.id === h.id)) : [];
  const actionMatches = actions.filter((a) => !q || normalize(`${a.label} ${a.keywords ?? ""}`).includes(nq));

  const previews = new Map<string, Preview>();
  pageMatches.forEach((p) =>
    previews.set(`page:${p.id}`, {
      title: p.title,
      subtitle: `/${p.path}`,
      body: p.description,
      icon: p.icon,
      meta: `Atualizada ${timeAgo(p.updated_at)}`,
      draft: !p.published,
    }),
  );
  contentHits.forEach((h) =>
    previews.set(`hit:${h.id}`, { title: h.title, subtitle: `/${h.path}`, body: h.snippet, lucide: FileText }),
  );
  actionMatches.forEach((a) =>
    previews.set(`action:${a.id}`, { title: a.label, subtitle: "Ação", body: a.hint, lucide: a.icon, meta: a.shortcut }),
  );
  // o item destacado sempre existe na lista atual (cai no primeiro quando os resultados mudam)
  const activeValue = previews.has(selected) ? selected : (previews.keys().next().value ?? "");
  const preview = previews.get(activeValue);

  const close = () => {
    onOpenChange(false);
    setQuery("");
  };

  const empty = !pageMatches.length && !contentHits.length && !actionMatches.length;

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(o) : close())}>
      <DialogContent
        hideClose
        className="top-[12%] max-w-3xl translate-y-0 gap-0 overflow-hidden p-0 shadow-[0_30px_80px_-20px_rgb(7_16_48/0.5)]"
      >
        <DialogTitle className="sr-only">Command Center</DialogTitle>
        <DialogDescription className="sr-only">Busque páginas, conteúdo e ações</DialogDescription>
        <CommandPrimitive shouldFilter={false} value={activeValue} onValueChange={setSelected} loop className="flex flex-col">
          <div className="relative flex items-center gap-3 border-b px-5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-soft text-brand-ink">
              {isLoading && q.length >= 2 ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            </div>
            <CommandPrimitive.Input
              value={query}
              onValueChange={setQuery}
              placeholder={placeholder ?? "Busque páginas, conteúdo ou ações…"}
              className="h-16 flex-1 bg-transparent text-base font-medium outline-none placeholder:text-muted-foreground"
            />
            <kbd>Esc</kbd>
            <span className="absolute inset-x-0 bottom-0 h-px bg-border" />
                      </div>

          <div className="grid md:grid-cols-[1fr_270px]">
            <CommandPrimitive.List className="h-[min(420px,55vh)] overflow-y-auto p-2">
              {empty && (
                <div className="flex flex-col items-center gap-2 py-16 text-center text-sm text-muted-foreground">
                  <Sparkles className="h-6 w-6 text-brand" />
                  Nada encontrado para “{q}”.
                </div>
              )}
              {pageMatches.length > 0 && (
                <Group heading={q ? "Páginas" : "Ir para"}>
                  {pageMatches.map((p) => (
                    <Item key={p.id} value={`page:${p.id}`} onSelect={() => (close(), onOpenPage(p))}>
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border bg-background">
                        <PageIcon name={p.icon} className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0 flex-1 truncate font-semibold">
                        <Highlight text={p.title} query={q} />
                      </span>
                      <span className="hidden truncate text-xs text-muted-foreground sm:block">/{p.path}</span>
                    </Item>
                  ))}
                </Group>
              )}
              {contentHits.length > 0 && (
                <Group heading="No conteúdo">
                  {contentHits.map((h) => (
                    <Item key={h.id} value={`hit:${h.id}`} onSelect={() => (close(), onOpenPage(h))}>
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border bg-background">
                        <FileText className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{h.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          <Highlight text={h.snippet} query={q} />
                        </span>
                      </span>
                    </Item>
                  ))}
                </Group>
              )}
              {actionMatches.length > 0 && (
                <Group heading="Ações">
                  {actionMatches.map((a) => (
                    <Item key={a.id} value={`action:${a.id}`} onSelect={() => (close(), a.run())}>
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
                        <a.icon className="h-3.5 w-3.5" />
                      </span>
                      <span className="flex-1 font-semibold">{a.label}</span>
                      {a.shortcut && <kbd>{a.shortcut}</kbd>}
                    </Item>
                  ))}
                </Group>
              )}
            </CommandPrimitive.List>

            <aside className="relative hidden overflow-hidden border-l bg-muted/40 p-5 md:block">

                            {preview ? (
                <div key={activeValue} className="relative animate-fade-up space-y-3">
                  <div className="brand-tile flex h-11 w-11 items-center justify-center rounded-xl">
                    {preview.lucide ? <preview.lucide className="h-5 w-5" /> : <PageIcon name={preview.icon} className="h-5 w-5" />}
                  </div>
                  <div>
                    <p className="font-display text-lg font-bold leading-tight">{preview.title}</p>
                    <p className="mt-0.5 truncate text-xs font-medium text-brand-ink">{preview.subtitle}</p>
                  </div>
                  {preview.body && <p className="line-clamp-6 text-sm leading-relaxed text-muted-foreground">{preview.body}</p>}
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {preview.draft && (
                      <span className="rounded-full bg-amber-500/15 px-2 py-0.5 font-semibold text-amber-600">Rascunho</span>
                    )}
                    {preview.meta && <span>{preview.meta}</span>}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Selecione um item para ver detalhes.</p>
              )}
            </aside>
          </div>

          <footer className="flex items-center gap-4 border-t bg-muted/30 px-5 py-2.5 text-[11px] font-medium text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <kbd>↑</kbd>
              <kbd>↓</kbd> navegar
            </span>
            <span className="flex items-center gap-1.5">
              <kbd>
                <CornerDownLeft className="h-3 w-3" />
              </kbd>
              abrir
            </span>
            <span className="ml-auto flex items-center gap-1">
              Command Center <ArrowRight className="h-3 w-3" /> Account Hub
            </span>

          </footer>
        </CommandPrimitive>
      </DialogContent>
    </Dialog>
  );
}

function Group({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <CommandPrimitive.Group
      heading={heading}
      className="mb-1 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-bold  [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground"
    >
      {children}
    </CommandPrimitive.Group>
  );
}

function Item({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      className={cn(
        "relative flex cursor-pointer select-none items-center gap-3 rounded-xl px-3 py-2 text-sm outline-none transition-colors data-[selected=true]:bg-brand/10 data-[selected=true]:before:absolute data-[selected=true]:before:inset-y-2 data-[selected=true]:before:left-0 data-[selected=true]:before:w-[3px] data-[selected=true]:before:rounded-full data-[selected=true]:before:bg-brand",
        className,
      )}
      {...props}
    />
  );
}
