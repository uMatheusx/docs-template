import {
  AlertOctagon,
  ArrowRight,
  BookOpenCheck,
  CheckCircle2,
  ChevronDown,
  Database,
  FilePen,
  FilePlus2,
  FileText,
  FileUp,
  GitPullRequest,
  HardDrive,
  Images,
  Info,
  PenSquare,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { Link } from "react-router";
import useSWR from "swr";

import { CountUp } from "@/components/count-up";
import { PageIcon } from "@/components/page-icon";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { Hint } from "@/components/ui/tooltip";
import { useSession } from "@/hooks/use-session";
import { api, keys, type LinkReport, type Stats } from "@/lib/api";
import { contentHealth, type HealthIssue, type Severity } from "@/lib/health";
import { countNodes } from "@/lib/tree";
import { cn, greeting, timeAgo } from "@/lib/utils";
import { useAdmin } from "@/pages/admin/admin-layout";

const enter = (i: number) => ({
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { delay: i * 0.05, duration: 0.45, ease: [0.2, 0.7, 0.2, 1] as const },
});

const SEVERITY: Record<Severity, { icon: LucideIcon; label: string; className: string }> = {
  critical: { icon: AlertOctagon, label: "Crítico", className: "text-red-600 bg-red-500/10 dark:text-red-400" },
  warning: { icon: TriangleAlert, label: "Atenção", className: "text-amber-700 bg-amber-500/10 dark:text-amber-300" },
  info: { icon: Info, label: "Info", className: "text-navy-600 bg-navy-500/10 dark:text-navy-300" },
};

const SEGMENT: Record<Severity | "ok", string> = {
  ok: "bg-emerald-500",
  info: "bg-sky-500",
  warning: "bg-amber-500",
  critical: "bg-red-500",
};

/**
 * Resumo da saúde do conteúdo: a nota e uma barra com um trecho por verificação. Perto de 100 a nota sozinha parece
 * "completa"; os trechos mostram exatamente qual verificação ainda tem problema.
 */
function HealthSummary({ score, checks }: { score: number; checks: HealthIssue[] }) {
  const problems = (check: HealthIssue) => check.links?.length ?? check.pages.length;
  const failing = checks.filter((c) => problems(c) > 0).length;
  // "Ótima" só sem nada crítico ou de atenção pendente: a nota sozinha esconde um link quebrado
  const severities = checks.filter((c) => problems(c) > 0).map((c) => c.severity);
  const hasCritical = severities.includes("critical");
  const hasWarning = severities.includes("warning");
  const level = score < 60 || (hasCritical && score < 80) ? "low" : hasCritical || hasWarning || score < 80 ? "mid" : "high";
  const tone = { high: "Ótima", mid: "Boa", low: "Precisa de atenção" }[level];
  const toneClass = {
    high: "text-emerald-700 dark:text-emerald-300",
    mid: "text-amber-700 dark:text-amber-300",
    low: "text-red-700 dark:text-red-300",
  }[level];
  return (
    <div className="w-full space-y-3 lg:w-[280px]">
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        <ShieldCheck className="h-4 w-4 text-brand" /> Saúde do conteúdo
      </p>
      <div className="flex items-baseline gap-2" role="meter" aria-valuenow={score} aria-valuemin={0} aria-valuemax={100} aria-label="Saúde do conteúdo">
        <CountUp value={score} className="font-display text-5xl font-semibold tabular-nums leading-none" />
        <span className="text-lg text-muted-foreground">/100</span>
        <span className={cn("ml-auto text-sm font-semibold", toneClass)}>{tone}</span>
      </div>
      {checks.length > 0 && (
        <>
          <ul className="flex gap-1" aria-label="Verificações">
            {checks.map((check) => {
              const count = problems(check);
              return (
                <li
                  key={check.id}
                  title={count > 0 ? `${check.label}: ${count}` : check.okLabel}
                  className={cn("h-1.5 flex-1 rounded-full", SEGMENT[count > 0 ? check.severity : "ok"])}
                >
                  <span className="sr-only">{count > 0 ? `${check.label}: ${count}` : check.okLabel}</span>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-muted-foreground">
            {failing === 0
              ? `Todas as ${checks.length} verificações sem problemas.`
              : `${checks.length - failing} de ${checks.length} verificações sem problemas. Veja o checklist abaixo.`}
          </p>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, icon: Icon, note, index }: { label: string; value?: number; icon: LucideIcon; note?: string; index: number }) {
  return (
    <motion.div {...enter(index)} className="group relative overflow-hidden rounded-3xl border border-border/70 bg-card p-5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground">{label}</span>
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted text-muted-foreground transition-colors group-hover:bg-brand-soft group-hover:text-brand-ink">
          <Icon className="h-4 w-4" />
        </span>
      </div>
      {value === undefined ? (
        <Skeleton className="mt-3 h-10 w-20" />
      ) : (
        <CountUp value={value} className="mt-2 block font-display text-4xl font-semibold tracking-tight" />
      )}
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
    </motion.div>
  );
}

export default function AdminDashboard() {
  const { user } = useSession();
  const { tree, treeLoading, openNewPage, openImport } = useAdmin();
  const { data: stats } = useSWR<Stats>(keys.stats);
  const { data: health } = useSWR(keys.health, async (url: string) => {
    const started = performance.now();
    const data = await api<{ status: string; dynamodb: string; s3: string }>(url);
    return { ...data, latency: Math.round(performance.now() - started) };
  });
  const { data: linkReport, isValidating: checkingLinks, mutate: recheckLinks } = useSWR<LinkReport>(keys.linkReport);
  const [openIssue, setOpenIssue] = useState<string>();
  const { score, issues, passed, checks } = contentHealth(tree, linkReport);
  const sections = tree.map((n) => ({ node: n, count: countNodes([n]) })).sort((a, b) => b.count - a.count);
  const maxSection = Math.max(1, ...sections.map((s) => s.count));
  const publishedPct = stats?.total ? Math.round((stats.published / stats.total) * 100) : 0;

  return (
    <div className="mx-auto max-w-[1280px] space-y-5 p-5 lg:p-8">
      {/* hero */}
      <motion.section {...enter(0)} className="relative overflow-hidden rounded-3xl border border-border/70 bg-card p-7 sm:p-9">
        <div className="relative flex flex-col gap-8 lg:flex-row lg:items-center">
          <div className="flex-1">
            <p className="text-sm text-muted-foreground">
              {greeting()}, {user?.username}
            </p>
            <h1 className="mt-2 max-w-xl font-display text-3xl font-semibold leading-[1.1] tracking-[-0.025em] sm:text-[2.5rem]">
              {stats ? (
                <>
                  Sua documentação tem {stats.total} páginas e {stats.drafts} {stats.drafts === 1 ? "rascunho" : "rascunhos"}.
                </>
              ) : (
                "Carregando seu espaço…"
              )}
            </h1>
            <p className="mt-3 max-w-lg text-muted-foreground">
              Escreva, organize e publique. Use <kbd>N</kbd> para criar uma página ou{" "}
              <kbd>/</kbd> para o Command Center.
            </p>
            <div className="mt-7 flex flex-wrap gap-2.5">
              <Button onClick={() => openNewPage()} size="lg">
                <FilePlus2 /> Nova página
              </Button>
              <Button onClick={openImport} size="lg" variant="secondary">
                <FileUp /> Importar
              </Button>
              {!!stats?.open_reviews && (
                <Button asChild size="lg" variant="secondary">
                  <Link to="/admin/reviews">
                    <GitPullRequest /> {stats.open_reviews} {stats.open_reviews === 1 ? "revisão aguardando" : "revisões aguardando"}
                  </Link>
                </Button>
              )}
              <Button asChild size="lg" variant="ghost">
                <Link to="/admin/pages">
                  Abrir Studio <ArrowRight />
                </Link>
              </Button>
            </div>
          </div>
          {treeLoading ? (
            <div className="w-full space-y-3 lg:w-[280px]">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-12 w-40" />
              <Skeleton className="h-1.5 w-full rounded-full" />
            </div>
          ) : (
            <HealthSummary score={score} checks={checks} />
          )}
        </div>
      </motion.section>

      {/* números */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat index={1} label="Páginas" value={stats?.total} icon={FileText} note={`${tree.length} seções principais`} />
        <Stat index={2} label="Publicadas" value={stats?.published} icon={BookOpenCheck} note={stats ? `${publishedPct}% do total` : undefined} />
        <Stat index={3} label="Rascunhos" value={stats?.drafts} icon={FilePen} note="Só quem edita vê" />
        <Stat index={4} label="Arquivos de mídia" value={stats?.assets} icon={Images} note="Armazenados no S3" />
      </section>

      <section className="grid gap-5 lg:grid-cols-12">
        {/* saúde */}
        <motion.div {...enter(5)} className="rounded-3xl border bg-card p-6 lg:col-span-7">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-display text-lg font-bold">Checklist de qualidade</h2>
              <p className="text-sm text-muted-foreground">O que melhorar para a documentação ficar impecável.</p>
            </div>
            <Hint label={linkReport ? `Links verificados ${timeAgo(linkReport.checked_at)} em ${linkReport.pages_checked} páginas` : "Verificando links…"}>
              <Button variant="ghost" size="sm" onClick={() => recheckLinks()} disabled={checkingLinks}>
                <RefreshCw className={cn(checkingLinks && "animate-spin")} /> Verificar links
              </Button>
            </Hint>
          </div>
          <div className="mt-5 space-y-2">
            {issues.length === 0 && !treeLoading && (
              <div className="flex items-center gap-3 rounded-2xl bg-emerald-500/10 p-4 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                <ShieldCheck className="h-5 w-5" /> Tudo certo! Nenhum problema encontrado.
              </div>
            )}
            {!treeLoading &&
              passed.map((check) => (
                <div key={check.id} className="flex items-center gap-3 rounded-2xl border border-dashed p-3.5 text-sm">
                  <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
                    <CheckCircle2 className="h-3.5 w-3.5" /> OK
                  </span>
                  <span className="font-semibold text-muted-foreground">{check.okLabel}</span>
                </div>
              ))}
            {issues.map((issue) => {
              const sev = SEVERITY[issue.severity];
              return (
                <Collapsible
                  key={issue.id}
                  open={openIssue === issue.id}
                  onOpenChange={(o) => setOpenIssue(o ? issue.id : undefined)}
                  className="rounded-2xl border transition-colors data-[state=open]:border-brand/30 data-[state=open]:bg-muted/30"
                >
                  <CollapsibleTrigger className="flex w-full items-center gap-3 p-3.5 text-left">
                    <span className={cn("flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold", sev.className)}>
                      <sev.icon className="h-3.5 w-3.5" /> {sev.label}
                    </span>
                    <span className="flex-1">
                      <span className="block text-sm font-bold">{issue.label}</span>
                      <span className="block text-xs text-muted-foreground">{issue.hint}</span>
                    </span>
                    <span className="font-display text-xl font-semibold tabular-nums">{issue.links?.length ?? issue.pages.length}</span>
                    <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform [[data-state=open]_&]:rotate-180" />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    {issue.links ? (
                      <ul className="space-y-1 px-3.5 pb-3.5">
                        {issue.links.map((l, i) => (
                          <li key={`${l.page_id}-${l.line}-${i}`}>
                            <Link
                              to={`/admin/pages/${l.page_id}`}
                              className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-xl px-2.5 py-1.5 text-sm hover:bg-background"
                            >
                              <span className="font-semibold">{l.page_title}</span>
                              <span className="font-mono text-[11px] text-muted-foreground">L{l.line}</span>
                              <span className="min-w-0 basis-full truncate font-mono text-xs text-red-600 dark:text-red-400 sm:basis-auto sm:flex-1">
                                {l.text ? `${l.text} → ` : ""}
                                {l.target}
                              </span>
                              <ArrowRight className="ml-auto h-3.5 w-3.5 shrink-0 text-brand" />
                            </Link>
                          </li>
                        ))}
                      </ul>
                    ) : (
                    <ul className="grid gap-1 px-3.5 pb-3.5 sm:grid-cols-2">
                      {issue.pages.map((p) => (
                        <li key={p.id}>
                          <Link
                            to={`/admin/pages/${p.id}`}
                            className="flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-sm font-medium text-muted-foreground hover:bg-background hover:text-foreground"
                          >
                            <PageIcon name={p.icon} className="h-3.5 w-3.5" /> <span className="truncate">{p.title}</span>
                            <ArrowRight className="ml-auto h-3.5 w-3.5 shrink-0 text-brand" />
                          </Link>
                        </li>
                      ))}
                    </ul>
                    )}
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
          </div>
        </motion.div>

        {/* atividade */}
        <motion.div {...enter(6)} className="rounded-3xl border bg-card p-6 lg:col-span-5">
          <h2 className="font-display text-lg font-bold">Atividade recente</h2>
          <p className="text-sm text-muted-foreground">Últimas edições salvas.</p>
          <ol className="relative mt-5 space-y-1 before:absolute before:bottom-3 before:left-[15px] before:top-3 before:w-px before:bg-border">
            {!stats && Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="ml-10 h-10" />)}
            {stats?.recent.map((p, i) => (
              <li key={p.id}>
                <Link to={`/admin/pages/${p.id}`} className="group relative flex items-center gap-3 rounded-xl py-1.5 pr-2">
                  <span
                    className={cn(
                      "relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-card",
                      i === 0 ? "brand-tile" : "bg-muted text-muted-foreground",
                    )}
                  >
                    <PageIcon name={p.icon} className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold group-hover:text-brand-ink">{p.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {p.updated_by || "—"} · {timeAgo(p.updated_at)}
                    </span>
                  </span>
                  {!p.published && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">rascunho</span>}
                </Link>
              </li>
            ))}
          </ol>
        </motion.div>

        {/* páginas por seção */}
        <motion.div {...enter(7)} className="rounded-3xl border bg-card p-6 lg:col-span-7">
          <h2 className="font-display text-lg font-bold">Páginas por seção</h2>
          <p className="text-sm text-muted-foreground">Quantidade de páginas (incluindo subpáginas) em cada seção principal.</p>
          <ul className="mt-5 space-y-3" aria-label="Páginas por seção">
            {treeLoading && Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-6" />)}
            {sections.map(({ node, count }) => (
              <li key={node.id}>
                <Hint label={`${node.title}: ${count} página(s)`} side="top">
                  <Link to={`/admin/pages/${node.id}`} className="group grid grid-cols-[140px_1fr_32px] items-center gap-3 text-sm">
                    <span className="flex items-center gap-2 truncate font-semibold text-muted-foreground group-hover:text-foreground">
                      <PageIcon name={node.icon} className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{node.title}</span>
                    </span>
                    <span className="relative h-2.5 rounded-r bg-muted/60">
                      <motion.span
                        initial={{ width: 0 }}
                        animate={{ width: `${(count / maxSection) * 100}%` }}
                        transition={{ duration: 0.8, ease: [0.2, 0.7, 0.2, 1] }}
                        className="absolute inset-y-0 left-0 rounded-r-[4px] bg-[var(--viz-1)] transition-[filter] group-hover:brightness-110"
                      />
                    </span>
                    <span className="text-right font-bold tabular-nums">{count}</span>
                  </Link>
                </Hint>
              </li>
            ))}
          </ul>
        </motion.div>

        {/* infraestrutura */}
        <motion.div {...enter(8)} className="rounded-3xl border bg-card p-6 lg:col-span-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-display text-lg font-bold">Infraestrutura</h2>
              <p className="text-sm text-muted-foreground">Armazenamento da documentação.</p>
            </div>
            {health && <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-bold tabular-nums">{health.latency} ms</span>}
          </div>
          <div className="mt-5 space-y-3">
            {[
              { key: "dynamodb" as const, label: "DynamoDB", hint: "Metadados, árvore e busca", icon: Database },
              { key: "s3" as const, label: "S3", hint: "Markdown, histórico e mídia", icon: HardDrive },
            ].map(({ key, label, hint, icon: Icon }) => {
              const status = health?.[key];
              const ok = status === "ok";
              return (
                <div key={key} className="flex items-center gap-3 rounded-2xl border p-3.5">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold">{label}</span>
                    <span className="block truncate text-xs text-muted-foreground" title={status}>
                      {status && !ok ? status : hint}
                    </span>
                  </span>
                  {!health ? (
                    <Skeleton className="h-5 w-16 rounded-full" />
                  ) : (
                    <span
                      className={cn(
                        "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold",
                        ok ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-red-500/10 text-red-600 dark:text-red-400",
                      )}
                    >
                      <span className={cn("h-1.5 w-1.5 animate-pulse-ring rounded-full", ok ? "bg-emerald-500 text-emerald-500" : "bg-red-500 text-red-500")} />
                      {ok ? "Operacional" : "Falha"}
                    </span>
                  )}
                </div>
              );
            })}
            <Button asChild variant="soft" className="w-full">
              <Link to="/admin/pages">
                <PenSquare /> Ir para o Studio
              </Link>
            </Button>
          </div>
        </motion.div>
      </section>
    </div>
  );
}
