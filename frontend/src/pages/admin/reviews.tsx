import { GitPullRequest, Layers, MessageSquare, Tags } from "lucide-react";
import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import useSWR from "swr";

import { PageIcon } from "@/components/page-icon";
import { Skeleton } from "@/components/ui/skeleton";
import { keys, type Batch, type Review } from "@/lib/api";
import { REVIEW_STATUS } from "@/lib/reviews";
import { cn, timeAgo } from "@/lib/utils";
import { useAdmin } from "@/pages/admin/admin-layout";

const TABS = [
  { id: "active", label: "Ativas" },
  { id: "done", label: "Concluídas" },
] as const;

export function ReviewStatusBadge({ status, className }: { status: Review["status"]; className?: string }) {
  const s = REVIEW_STATUS[status];
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold ring-1", s.className, className)}>{s.label}</span>;
}

export default function ReviewsPage() {
  const [tab, setTab] = useState<"active" | "done">("active");
  const { data: all, isLoading } = useSWR<Review[]>(keys.reviews(tab));
  const { data: batches } = useSWR<Batch[]>(keys.batches(tab));
  // as propostas de um pacote aparecem juntas, num item só
  const reviews = useMemo(() => (all ? all.filter((r) => !r.batch_id) : all), [all]);
  const entries = useMemo(
    () =>
      reviews
        ? [
            ...reviews.map((r) => ({ kind: "review" as const, at: r.updated_at, review: r })),
            ...(batches ?? []).map((b) => ({ kind: "batch" as const, at: b.updated_at, batch: b })),
          ].sort((a, b) => b.at.localeCompare(a.at))
        : undefined,
    [reviews, batches],
  );
  const { tree } = useAdmin();
  const iconOf = (pageId: string) => {
    const stack = [...tree];
    while (stack.length) {
      const node = stack.pop()!;
      if (node.id === pageId) return node.icon;
      stack.push(...node.children);
    }
    return null;
  };

  return (
    <div className="mx-auto max-w-[1100px] space-y-6 p-5 lg:p-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 font-display text-3xl font-semibold tracking-tight">
            <span className="brand-tile flex h-11 w-11 items-center justify-center rounded-2xl">
              <GitPullRequest className="h-5 w-5" />
            </span>
            Revisões
          </h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            Propostas de alteração em páginas publicadas. Um administrador revisa, aprova e aplica — a página só muda depois disso.
          </p>
        </div>
        <div className="relative flex rounded-xl bg-muted p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "relative z-10 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors",
                tab === t.id ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tab === t.id && <motion.span layoutId="reviews-tab" className="absolute inset-0 -z-10 rounded-lg bg-background shadow-sm" />}
              {t.label}
            </button>
          ))}
        </div>
      </header>

      <div className="space-y-3">
        {isLoading && Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-24 rounded-3xl" />)}
        {entries?.length === 0 && (
          <div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed py-16 text-center">
            <span className="brand-tile flex h-12 w-12 items-center justify-center rounded-2xl">
              <Tags className="h-5 w-5" />
            </span>
            <p className="font-display text-lg font-bold">{tab === "active" ? "Nenhuma proposta aguardando" : "Nada concluído ainda"}</p>
            <p className="max-w-md text-sm text-muted-foreground">
              No editor de uma página publicada, use “Enviar para revisão” para propor alterações sem publicar direto.
            </p>
          </div>
        )}
        {entries?.map((entry) => {
          if (entry.kind === "batch") {
            const b = entry.batch;
            const comments = b.events.filter((e) => e.type === "comment").length;
            return (
              <Link
                key={b.id}
                to={`/admin/reviews/lote/${b.id}`}
                className="group flex flex-wrap items-center gap-4 rounded-3xl border bg-card p-5 transition-all hover:border-brand/40 hover:shadow-glow"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border bg-background transition-colors group-hover:brand-tile group-hover:border-transparent">
                  <Layers className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-bold text-muted-foreground">#{b.number}</span>
                    <span className="font-display text-[17px] font-bold group-hover:text-brand-ink">{b.title}</span>
                    <ReviewStatusBadge status={b.status} />
                    <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-bold text-muted-foreground ring-1 ring-border">
                      {b.pages.length} páginas
                    </span>
                  </p>
                  <p className="mt-1 truncate text-sm text-muted-foreground">
                    {b.author} propõe alterações em{" "}
                    <span className="font-semibold text-foreground">{b.pages.map((p) => p.page_title).join(", ")}</span> · atualizado {timeAgo(b.updated_at)}
                  </p>
                </div>
                <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <MessageSquare className="h-4 w-4" /> {comments}
                </span>
              </Link>
            );
          }
          const r = entry.review;
          const comments = r.events.filter((e) => e.type === "comment").length;
          return (
            <Link
              key={r.id}
              to={`/admin/reviews/${r.id}`}
              className="group flex flex-wrap items-center gap-4 rounded-3xl border bg-card p-5 transition-all hover:border-brand/40 hover:shadow-glow"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border bg-background transition-colors group-hover:brand-tile group-hover:border-transparent">
                <PageIcon name={iconOf(r.page_id)} className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-bold text-muted-foreground">#{r.number}</span>
                  <span className="font-display text-[17px] font-bold group-hover:text-brand-ink">{r.title}</span>
                  <ReviewStatusBadge status={r.status} />
                </p>
                <p className="mt-1 truncate text-sm text-muted-foreground">
                  {r.author} propõe alterações em <span className="font-semibold text-foreground">{r.page_title}</span> · atualizada {timeAgo(r.updated_at)}
                </p>
              </div>
              <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <MessageSquare className="h-4 w-4" /> {comments}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
