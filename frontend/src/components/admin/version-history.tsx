import {
  ArrowLeftRight,
  Check,
  Copy,
  Download,
  Eye,
  GitCompareArrows,
  History,
  Loader2,
  Minus,
  Plus,
  RotateCcw,
  TriangleAlert,
} from "lucide-react";
import { motion } from "motion/react";
import { useMemo, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";
import useSWR from "swr";

import { Markdown } from "@/components/markdown/markdown";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Hint } from "@/components/ui/tooltip";
import { docsApi, keys, type HistoryEntry, type Page } from "@/lib/api";
import { DiffView } from "@/components/admin/diff-view";
import { collapseDiff, diffLines, diffStats } from "@/lib/diff";
import { cn, downloadText, formatBytes, formatDate, timeAgo } from "@/lib/utils";

const CURRENT = "current";

interface Item {
  id: string;
  current: boolean;
  version: number | null;
  note: string;
  author: string;
  at: string;
  size?: number;
}

interface VersionHistoryProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** versão salva (baseline do editor) */
  page: Page;
  /** há alterações não salvas no editor */
  dirty: boolean;
  /** versão selecionada ao abrir (`current` ou id do histórico) */
  initialId?: string;
  onRestored: (page: Page) => Promise<void> | void;
  /** página publicada: restaurar vira "carregar no editor" e a mudança segue por revisão */
  reviewOnly?: boolean;
  onUseVersion?: (content: string, label: string) => void;
}

export function VersionHistory({ open, onOpenChange, ...props }: VersionHistoryProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent hideClose className="flex h-[90vh] max-w-[min(1240px,96vw)] flex-col gap-0 overflow-hidden p-0">
        {open && <HistoryBody {...props} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function useVersionContent(pageId: string, item: Item | undefined, currentContent: string) {
  const { data, isLoading } = useSWR(item && !item.current ? ["history", pageId, item.id] : null, () =>
    docsApi.historyVersion(pageId, item!.id),
  );
  if (!item) return { content: undefined, loading: false };
  return item.current ? { content: currentContent, loading: false } : { content: data?.content, loading: isLoading };
}

function dayLabel(iso: string): string {
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const date = new Date(iso);
  const diff = Math.round((day(new Date()) - day(date)) / 86_400_000);
  if (diff === 0) return "Hoje";
  if (diff === 1) return "Ontem";
  return date.toLocaleDateString("pt-BR", {
    day: "numeric",
    month: "long",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const versionLabel = (item: Item) =>
  item.version
    ? `v${item.version}`
    : new Date(item.at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
/** rótulo curto para o selo da linha do tempo */
const versionBadge = (item: Item) => (item.version ? `v${item.version}` : "antiga");

function HistoryBody({ page, dirty, initialId, onRestored, reviewOnly, onUseVersion, onClose }: Omit<VersionHistoryProps, "open" | "onOpenChange"> & { onClose: () => void }) {
  const { data: entries, isLoading, mutate } = useSWR<HistoryEntry[]>(keys.history(page.id));
  const [selectedId, setSelectedId] = useState(initialId ?? CURRENT);
  const [mode, setMode] = useState<"changes" | "preview">("changes");
  const [against, setAgainst] = useState<"previous" | "current">("previous");
  const [confirming, setConfirming] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const items: Item[] = useMemo(
    () => [
      { id: CURRENT, current: true, version: page.version, note: page.note, author: page.updated_by, at: page.updated_at },
      ...(entries ?? []).map((e, i, all) => ({
        id: e.id,
        current: false,
        version: e.version,
        note: e.note,
        author: e.author,
        // versões antigas não guardavam quando foram escritas: uma versão é escrita no momento
        // em que a anterior é arquivada (fallback para a criação da página na mais antiga)
        at: e.created_at !== e.archived_at ? e.created_at : (all[i + 1]?.archived_at ?? page.created_at),
        size: e.size,
      })),
    ],
    [entries, page],
  );
  const index = Math.max(0, items.findIndex((i) => i.id === selectedId));
  const selected = items[index];
  const previous = items[index + 1];
  const effectiveAgainst = selected.current ? "previous" : against;

  const target = useVersionContent(page.id, selected, page.content);
  const prior = useVersionContent(page.id, previous, page.content);

  const diff = useMemo(() => {
    if (target.content === undefined) return null;
    if (effectiveAgainst === "current") {
      const ops = diffLines(target.content, page.content);
      return { hunks: collapseDiff(ops), stats: diffStats(ops), first: false };
    }
    if (previous && prior.content === undefined) return null;
    const ops = diffLines(previous ? prior.content! : "", target.content);
    return { hunks: collapseDiff(ops), stats: diffStats(ops), first: !previous };
  }, [target.content, prior.content, previous, effectiveAgainst, page.content]);

  async function restore() {
    setRestoring(true);
    try {
      const restored = await docsApi.restoreVersion(page.id, selected.id);
      await onRestored(restored);
      await mutate();
      toast.success(`Versão ${versionLabel(selected)} restaurada`, { description: `Criada a v${restored.version}` });
      setSelectedId(CURRENT);
      setConfirming(false);
    } catch (err) {
      toast.error("Falha ao restaurar", { description: (err as Error).message });
    } finally {
      setRestoring(false);
    }
  }

  function onListKey(e: KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const next = items[Math.min(items.length - 1, Math.max(0, index + (e.key === "ArrowDown" ? 1 : -1)))];
    setSelectedId(next.id);
    document.getElementById(`version-${next.id}`)?.focus();
  }

  // agrupa por dia mantendo a ordem (mais recente primeiro)
  const groups: { label: string; items: Item[] }[] = [];
  for (const item of items) {
    const label = dayLabel(item.at);
    if (groups.at(-1)?.label === label) groups.at(-1)!.items.push(item);
    else groups.push({ label, items: [item] });
  }

  return (
    <>
      <header className="flex items-center gap-3 border-b px-6 py-4">
        <span className="brand-tile flex h-10 w-10 items-center justify-center rounded-xl">
          <History className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <DialogTitle className="text-lg">Histórico de versões</DialogTitle>
          <DialogDescription className="truncate">
            {page.title} · {items.length} {items.length === 1 ? "versão" : "versões"} · cada salvamento fica guardado no S3
          </DialogDescription>
        </div>
        <Button variant="outline" size="sm" className="ml-auto" onClick={onClose}>
          Fechar
        </Button>
      </header>

      <div className="grid min-h-0 flex-1 md:grid-cols-[320px_1fr]">
        {/* ------------------------------------------------ linha do tempo */}
        <aside className="hidden min-h-0 overflow-y-auto border-r bg-sidebar md:block" onKeyDown={onListKey}>
          {dirty && (
            <div className="m-3 flex gap-2 rounded-xl border border-brand/30 bg-brand-soft p-3 text-xs text-brand-ink">
              <TriangleAlert className="h-4 w-4 shrink-0" />
              Você tem alterações não salvas no editor. Elas não aparecem aqui até serem salvas.
            </div>
          )}
          {groups.map((group) => (
            <section key={group.label} className="px-3 pb-2 pt-3">
              <p className="px-2 pb-1.5 text-xs font-semibold text-muted-foreground">{group.label}</p>
              <ol className="relative space-y-1 before:absolute before:bottom-3 before:left-[27px] before:top-3 before:w-px before:bg-border">
                {group.items.map((item) => {
                  const active = item.id === selected.id;
                  return (
                    <li key={item.id}>
                      <button
                        id={`version-${item.id}`}
                        onClick={() => setSelectedId(item.id)}
                        className={cn(
                          "relative flex w-full items-start gap-3 rounded-xl px-2 py-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/50",
                          active ? "bg-background shadow-sm ring-1 ring-brand/25" : "hover:bg-background/70",
                        )}
                      >
                        {active && (
                          <motion.span
                            layoutId="version-marker"
                            className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-brand"
                            transition={{ type: "spring", stiffness: 500, damping: 40 }}
                          />
                        )}
                        <span
                          className={cn(
                            "relative z-10 mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold uppercase ring-4 ring-sidebar",
                            item.current ? "brand-tile" : "border bg-background text-muted-foreground",
                          )}
                          title={item.author}
                        >
                          {(item.author || "—").slice(0, 2)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="rounded-md bg-muted px-1.5 py-px font-mono text-[10px] font-bold">{versionBadge(item)}</span>
                            {item.current && (
                              <span className="rounded-md bg-emerald-500/10 px-1.5 py-px text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                                atual
                              </span>
                            )}
                            <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">{timeOf(item.at)}</span>
                          </span>
                          <span className={cn("mt-1 block truncate text-[13px]", item.note ? "font-semibold" : "italic text-muted-foreground")}>
                            {item.note || "Sem descrição"}
                          </span>
                          <span className="block text-[11px] text-muted-foreground">
                            {item.author || "—"}
                            {item.size !== undefined && ` · ${formatBytes(item.size)}`}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
          {isLoading && (
            <div className="space-y-2 p-4">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-14 rounded-xl" />
              ))}
            </div>
          )}
          {!isLoading && entries?.length === 0 && (
            <p className="mx-4 rounded-xl border border-dashed p-4 text-center text-xs text-muted-foreground">
              Ainda não há versões anteriores. Elas aparecem aqui a cada salvamento.
            </p>
          )}
        </aside>

        {/* ------------------------------------------------ detalhe */}
        <section className="flex min-h-0 flex-col">
          <div className="flex flex-wrap items-center gap-3 border-b px-5 py-3">
            {/* seletor compacto para telas pequenas */}
            <select
              value={selected.id}
              onChange={(e) => setSelectedId(e.target.value)}
              className="h-9 rounded-lg border bg-background px-2 text-sm md:hidden"
              aria-label="Versão"
            >
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {versionBadge(i)} · {timeOf(i.at)} · {i.note || "Sem descrição"}
                </option>
              ))}
            </select>
            <div className="hidden min-w-0 md:block">
              <p className="flex items-center gap-2 font-display text-base font-semibold">
                {selected.current ? `Versão atual · ${versionLabel(selected)}` : `Versão ${versionLabel(selected)}`}
                {diff && (
                  <span className="flex gap-1 text-[11px] font-bold">
                    <span className="flex items-center rounded-full bg-emerald-500/10 px-1.5 text-emerald-700 dark:text-emerald-300">
                      <Plus className="h-3 w-3" />
                      {diff.stats.added}
                    </span>
                    <span className="flex items-center rounded-full bg-red-500/10 px-1.5 text-red-600 dark:text-red-400">
                      <Minus className="h-3 w-3" />
                      {diff.stats.removed}
                    </span>
                  </span>
                )}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {selected.note || "Sem descrição"} · por {selected.author || "—"} · {formatDate(selected.at)} ({timeAgo(selected.at)})
              </p>
            </div>

            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Segmented
                value={mode}
                onChange={(v) => setMode(v as typeof mode)}
                options={[
                  { value: "changes", label: "Alterações", icon: GitCompareArrows },
                  { value: "preview", label: "Visualizar", icon: Eye },
                ]}
                layoutId="history-mode"
              />
              {mode === "changes" && !selected.current && (
                <Segmented
                  value={against}
                  onChange={(v) => setAgainst(v as typeof against)}
                  options={[
                    { value: "previous", label: "vs. anterior", icon: ArrowLeftRight },
                    { value: "current", label: "vs. atual", icon: ArrowLeftRight },
                  ]}
                  layoutId="history-against"
                />
              )}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {target.loading || target.content === undefined || (mode === "changes" && !diff) ? (
              <div className="flex h-full items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-brand" />
              </div>
            ) : mode === "preview" ? (
              <div className="mx-auto max-w-3xl px-8 py-8">
                <Markdown content={target.content} />
              </div>
            ) : (
              <DiffView
                hunks={diff!.hunks}
                empty={
                  effectiveAgainst === "current"
                    ? "Esta versão é idêntica à versão atual."
                    : "Nenhuma mudança de conteúdo nesta versão (só propriedades foram alteradas)."
                }
                notice={diff!.first ? "Primeira versão registrada: todo o conteúdo aparece como adicionado." : undefined}
                legend={
                  effectiveAgainst === "current"
                    ? `${versionLabel(selected)} → atual (v${page.version})`
                    : previous
                      ? `${versionLabel(previous)} → ${versionLabel(selected)}`
                      : `início → ${versionLabel(selected)}`
                }
              />
            )}
          </div>

          <footer className="flex flex-wrap items-center gap-2 border-t bg-muted/30 px-5 py-3">
            <Hint label="Copiar o markdown desta versão">
              <Button
                variant="outline"
                size="sm"
                disabled={target.content === undefined}
                onClick={() => target.content && navigator.clipboard.writeText(target.content).then(() => toast.success("Conteúdo copiado"))}
              >
                <Copy /> Copiar
              </Button>
            </Hint>
            <Button
              variant="outline"
              size="sm"
              disabled={target.content === undefined}
              onClick={() => target.content && downloadText(`${page.slug}-${versionLabel(selected)}.md`, target.content)}
            >
              <Download /> Baixar .md
            </Button>
            <span className="ml-auto hidden text-xs text-muted-foreground lg:inline">
              {reviewOnly
                ? "A página está publicada: a versão vai para o editor e segue por revisão."
                : "Restaurar cria uma nova versão; nada é apagado."}
            </span>
            {selected.current ? (
              <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                <Check className="h-4 w-4" /> Esta é a versão publicada agora
              </span>
            ) : (
              <Button
                size="sm"
                onClick={() => {
                  if (reviewOnly && target.content !== undefined) {
                    onUseVersion?.(target.content, versionLabel(selected));
                    onClose();
                  } else {
                    setConfirming(true);
                  }
                }}
                disabled={target.content === undefined}
              >
                <RotateCcw /> {reviewOnly ? `Usar ${versionLabel(selected)} no editor` : `Restaurar ${versionLabel(selected)}`}
              </Button>
            )}
          </footer>
        </section>
      </div>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restaurar a versão {versionLabel(selected)}?</AlertDialogTitle>
            <AlertDialogDescription>
              O conteúdo dela vira uma nova versão (v{page.version + 1}). A versão atual continua no histórico.
              {dirty && " As alterações não salvas no editor serão substituídas."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                restore();
              }}
              disabled={restoring}
            >
              {restoring ? <Loader2 className="animate-spin" /> : <RotateCcw />} Restaurar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function Segmented({
  value,
  onChange,
  options,
  layoutId,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; icon: typeof Eye }[];
  layoutId: string;
}) {
  return (
    <div className="flex rounded-xl bg-muted p-1" role="radiogroup">
      {options.map(({ value: v, label, icon: Icon }) => (
        <button
          key={v}
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={cn(
            "relative z-10 flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold transition-colors",
            value === v ? "text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {value === v && <motion.span layoutId={layoutId} className="absolute inset-0 -z-10 rounded-lg bg-background shadow-sm" />}
          <Icon className="h-3.5 w-3.5" /> {label}
        </button>
      ))}
    </div>
  );
}
