import { ArrowUpRight, Boxes, Clock3, Code2, Hash, History, Image, Link2, ListTree, Loader2, Radio, SlidersHorizontal, Workflow } from "lucide-react";
import { motion } from "motion/react";
import { useMemo, useState } from "react";
import useSWR from "swr";

import { IconPicker } from "@/components/admin/tree/icon-picker";
import { MethodBadge } from "@/components/api/openapi-view";
import { asyncChannels, isObj, listOperations, parseSpec } from "@/components/api/spec";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { keys, type HistoryEntry, type Page, type PageKind } from "@/lib/api";
import type { Draft } from "@/lib/drafts/draft";
import { cn, countWords, formatBytes, formatDate, readingTime, timeAgo } from "@/lib/utils";

type Tab = "props" | "outline" | "versions";
const TABS: { id: Tab; label: string; icon: typeof Hash }[] = [
  { id: "props", label: "Propriedades", icon: SlidersHorizontal },
  { id: "outline", label: "Estrutura", icon: ListTree },
  { id: "versions", label: "Versões", icon: History },
];

interface InspectorProps {
  draft: Draft;
  baseline: Page;
  onChange: <K extends keyof Draft>(key: K, value: Draft[K]) => void;
  onJump: (line: number) => void;
  /** abre o histórico completo (opcionalmente já numa versão) */
  onOpenHistory: (versionId?: string) => void;
  kind?: PageKind;
  /** editores não publicam: o interruptor fica travado com a explicação */
  publishLock?: string;
}

function outline(content: string) {
  const items: { level: number; text: string; line: number }[] = [];
  let inFence = false;
  content.split("\n").forEach((raw, i) => {
    if (/^\s*(```|~~~)/.test(raw)) inFence = !inFence;
    const m = !inFence && /^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(raw);
    if (m) items.push({ level: m[1].length, text: m[2], line: i + 1 });
  });
  return items;
}

/** Linha (1-based) onde um caminho/canal aparece na especificação, para o "pular para". */
function lineOf(content: string, key: string) {
  const i = content.split("\n").findIndex((l) => {
    const s = l.trim();
    return s.startsWith(`${key}:`) || s.startsWith(`"${key}"`) || s.startsWith(`'${key}'`);
  });
  return i >= 0 ? i + 1 : null;
}

function SpecOutline({ kind, content, onJump }: { kind: Exclude<PageKind, "doc">; content: string; onJump: (line: number) => void }) {
  const summary = useMemo(() => {
    const { spec } = parseSpec(content);
    if (!spec) return null;
    const components = isObj(spec.components) ? spec.components : {};
    const schemas = isObj(components.schemas) ? Object.keys(components.schemas).length : 0;
    if (kind === "openapi") {
      const ops = listOperations(spec);
      return {
        metrics: [
          { icon: Workflow, label: "operações", value: ops.length },
          { icon: Boxes, label: "schemas", value: schemas },
        ],
        items: ops.map((op) => ({ key: op.anchor, method: op.method, label: op.path, hint: op.summary, line: lineOf(content, op.path) })),
      };
    }
    const channels = asyncChannels(spec);
    return {
      metrics: [
        { icon: Radio, label: "canais", value: channels.length },
        { icon: Boxes, label: "schemas", value: schemas },
      ],
      items: channels.map((c) => ({ key: c.id, method: null, label: c.address, hint: c.description, line: lineOf(content, c.id) })),
    };
  }, [kind, content]);

  if (!summary) return <p className="text-xs text-muted-foreground">A especificação tem erros de sintaxe — veja a prévia.</p>;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2">
        {summary.metrics.map(({ icon: Icon, label, value }) => (
          <div key={label} className="rounded-xl border p-2.5">
            <Icon className="h-3.5 w-3.5 text-brand" />
            <p className="mt-1 font-display text-lg font-semibold tabular-nums">{value}</p>
            <p className="text-[11px] text-muted-foreground">{label}</p>
          </div>
        ))}
      </div>
      <ul className="space-y-0.5">
        {summary.items.map((item) => (
          <li key={item.key}>
            <button
              disabled={!item.line}
              onClick={() => item.line && onJump(item.line)}
              title={item.hint}
              className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left text-[12px] text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
            >
              {item.method && <MethodBadge method={item.method} className="min-w-[52px] shrink-0 px-1 text-[10px]" />}
              <span className="truncate font-mono">{item.label}</span>
              {item.line && <span className="ml-auto font-mono text-[10px] opacity-60">L{item.line}</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Inspector({ draft, baseline, onChange, onJump, onOpenHistory, kind = "doc", publishLock }: InspectorProps) {
  const [tab, setTab] = useState<Tab>("props");
  const headings = useMemo(() => outline(draft.content), [draft.content]);
  const { data: history, isLoading } = useSWR<HistoryEntry[]>(tab === "versions" ? keys.history(baseline.id) : null);

  const diagrams = (draft.content.match(/^```mermaid/gm) ?? []).length;
  const codeBlocks = Math.max(0, Math.floor((draft.content.match(/^```/gm) ?? []).length / 2) - diagrams);
  const metrics = [
    { icon: Clock3, label: "min leitura", value: readingTime(draft.content) },
    { icon: Hash, label: "palavras", value: countWords(draft.content) },
    { icon: Link2, label: "links", value: (draft.content.match(/(?<!!)\[[^\]]*\]\([^)]+\)/g) ?? []).length },
    { icon: Image, label: "imagens", value: (draft.content.match(/!\[[^\]]*\]\([^)]+\)/g) ?? []).length },
    { icon: Code2, label: "blocos de código", value: codeBlocks },
    { icon: Workflow, label: "diagramas", value: diagrams },
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="border-b p-2">
        <div className="relative grid grid-cols-3 gap-1 rounded-xl bg-muted p-1">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                "relative z-10 flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-[11px] font-bold transition-colors",
                tab === id ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tab === id && <motion.span layoutId="inspector-tab" className="absolute inset-0 -z-10 rounded-lg bg-background shadow-sm" />}
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === "props" && (
          <div className="space-y-5">
            {baseline.published ? (
              <label className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 bg-muted/50 p-3.5 text-sm">
                <span>
                  <span className="block font-bold">{draft.published ? "Publicada" : "Sairá do ar"}</span>
                  <span className="text-xs text-muted-foreground">
                    {draft.published ? "Visível para todos os leitores" : "Volta a rascunho quando a proposta for aprovada e aplicada"}
                  </span>
                </span>
                <Switch checked={draft.published} onCheckedChange={(v) => onChange("published", v)} />
              </label>
            ) : (
              <div className="rounded-2xl border border-border/70 bg-muted/50 p-3.5 text-sm">
                <span className="block font-bold">Rascunho</span>
                <span className="text-xs text-muted-foreground">{publishLock ?? "Só quem edita a documentação vê"}</span>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="in-slug">Slug</Label>
              <Input id="in-slug" value={draft.slug} onChange={(e) => onChange("slug", e.target.value)} className="font-mono text-xs" />
              <p className="break-all rounded-lg bg-muted px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground">
                /docs/{baseline.path.split("/").slice(0, -1).concat(draft.slug).join("/")}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="in-icon">Ícone</Label>
              <IconPicker id="in-icon" value={draft.icon} onChange={(v) => onChange("icon", v)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="in-desc" className="flex justify-between">
                Descrição <span className="font-normal text-muted-foreground">{draft.description.length}/500</span>
              </Label>
              <Textarea
                id="in-desc"
                rows={4}
                maxLength={500}
                value={draft.description}
                onChange={(e) => onChange("description", e.target.value)}
                placeholder="Resumo usado em cards, busca e prévias de link"
              />
            </div>
            <dl className="divide-y rounded-2xl border text-xs">
              {[
                ["Versão", baseline.semver],
                ["Criada", formatDate(baseline.created_at)],
                ["Atualizada", `${timeAgo(baseline.updated_at)} · ${baseline.updated_by || "—"}`],
                ["ID", baseline.id],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2 px-3 py-2">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="truncate text-right font-semibold">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {tab === "outline" && kind !== "doc" && <SpecOutline kind={kind} content={draft.content} onJump={onJump} />}

        {tab === "outline" && kind === "doc" && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-2">
              {metrics.map(({ icon: Icon, label, value }) => (
                <div key={label} className="rounded-xl border p-2.5">
                  <Icon className="h-3.5 w-3.5 text-brand" />
                  <p className="mt-1 font-display text-lg font-semibold tabular-nums">{value}</p>
                  <p className="text-[11px] text-muted-foreground">{label}</p>
                </div>
              ))}
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold text-muted-foreground">Títulos</p>
              {headings.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nenhum título ainda. Digite “/” no editor e escolha um título.</p>
              ) : (
                <ul className="space-y-0.5 border-l-2">
                  {headings.map((h) => (
                    <li key={`${h.line}-${h.text}`}>
                      <button
                        onClick={() => onJump(h.line)}
                        className="-ml-0.5 flex w-full items-center gap-2 border-l-2 border-transparent py-1 pr-1 text-left text-[13px] text-muted-foreground transition-colors hover:border-brand hover:text-foreground"
                        style={{ paddingLeft: 10 + (h.level - 1) * 12 }}
                      >
                        <span className="truncate">{h.text}</span>
                        <span className="ml-auto font-mono text-[10px] opacity-60">L{h.line}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {tab === "versions" && (
          <div className="space-y-4">
            <button
              onClick={() => onOpenHistory()}
              className="group flex w-full items-center gap-3 rounded-2xl border border-border/70 bg-muted/50 p-3.5 text-left transition-colors hover:border-brand/40"
            >
              <span className="brand-tile flex h-9 w-9 shrink-0 items-center justify-center rounded-xl">
                <History className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold">Histórico completo</span>
                <span className="text-xs text-muted-foreground">Compare, visualize e restaure versões</span>
              </span>
              <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-brand" />
            </button>
            {isLoading && <Loader2 className="mx-auto my-6 h-5 w-5 animate-spin text-brand" />}
            <ol className="relative space-y-0.5 before:absolute before:bottom-4 before:left-[15px] before:top-4 before:w-px before:bg-border">
              <li className="relative flex items-start gap-3 rounded-xl px-1 py-2">
                <span className="z-10 flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full brand-tile ring-4 ring-sidebar">
                  <span className="h-2 w-2 rounded-full bg-current" />
                </span>
                <span className="min-w-0 text-xs">
                  <span className="block truncate font-mono text-[11px] font-semibold">{baseline.semver} · atual</span>
                  <span className="block truncate font-bold">{baseline.note || "Versão atual"}</span>
                  <span className="text-muted-foreground">
                    {baseline.updated_by || "—"} · {timeAgo(baseline.updated_at)}
                  </span>
                </span>
              </li>
              {history?.slice(0, 8).map((entry, i) => {
                // versões antigas não guardavam quando foram escritas (ver version-history.tsx)
                const at =
                  entry.created_at !== entry.archived_at
                    ? entry.created_at
                    : (history[i + 1]?.archived_at ?? baseline.created_at);
                return (
                <li key={entry.id}>
                  <button
                    onClick={() => onOpenHistory(entry.id)}
                    className="group relative flex w-full items-start gap-3 rounded-xl px-1 py-2 text-left transition-colors hover:bg-background"
                    title={formatDate(at)}
                  >
                    <span className="z-10 flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full border bg-background text-[10px] font-bold text-muted-foreground ring-4 ring-sidebar transition-colors group-hover:border-brand group-hover:text-brand-ink">
                      <span className="h-2 w-2 rounded-full bg-current" />
                    </span>
                    <span className="min-w-0 flex-1 text-xs">
                      <span className="block truncate font-mono text-[11px] font-semibold">{entry.semver ?? "antiga"}</span>
                      <span className={cn("block truncate", entry.note ? "font-semibold" : "italic text-muted-foreground")}>
                        {entry.note || "Sem descrição"}
                      </span>
                      <span className="text-muted-foreground">
                        {entry.author || "—"} · {timeAgo(at)} · {formatBytes(entry.size)}
                      </span>
                    </span>
                  </button>
                </li>
                );
              })}
            </ol>
            {history && history.length > 8 && (
              <button onClick={() => onOpenHistory()} className="w-full text-center text-xs font-semibold text-brand-ink hover:underline">
                Ver todas as {history.length + 1} versões
              </button>
            )}
            {history?.length === 0 && (
              <p className="rounded-xl border border-dashed p-4 text-center text-xs text-muted-foreground">
                Ainda não há versões anteriores.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
