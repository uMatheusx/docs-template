import { ArrowLeft, ArrowRight, Check, ChevronDown, ChevronRight, FilePen, GitMerge, Layers, Loader2, MessageSquare, TriangleAlert, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import useSWR, { useSWRConfig } from "swr";

import { DiffView } from "@/components/admin/diff-view";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useSession } from "@/hooks/use-session";
import { ApiError, docsApi, keys, type BatchDetail, type ReviewDetail } from "@/lib/api";
import { collapseDiff, diffLines, diffStats } from "@/lib/diff";
import { ACTIVE_STATUSES, describeFields } from "@/lib/reviews";
import { cn, timeAgo } from "@/lib/utils";
import { Timeline } from "@/pages/admin/review-detail";
import { ReviewStatusBadge } from "@/pages/admin/reviews";

/** O que a página terá depois de aplicar: a mesclagem automática, quando existe. */
const shownContent = (r: ReviewDetail) =>
  r.merge?.state === "clean" && r.merge.merged_content != null ? r.merge.merged_content : r.proposed_content;

function PageChanges({ review, open, onToggle }: { review: ReviewDetail; open: boolean; onToggle: () => void }) {
  const active = ACTIVE_STATUSES.includes(review.status);
  const diff = useMemo(() => {
    if (!open) return null;
    const ops = diffLines(review.current_content, shownContent(review));
    return { hunks: collapseDiff(ops), stats: diffStats(ops) };
  }, [open, review]);
  const fields = describeFields(review.fields);
  const conflicts = active && review.merge?.state === "conflicts";
  const unavailable = active && review.merge?.state === "unavailable";

  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left transition-colors hover:bg-muted/40"
      >
        {open ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
        <span className="min-w-0 flex-1 basis-40">
          <span className="block truncate text-sm font-semibold">{review.page_title}</span>
          <span className="block truncate font-mono text-xs text-muted-foreground">/docs/{review.page_path}</span>
        </span>
        {fields.map((f) => (
          <span key={f.label} className="rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-semibold text-brand-ink">
            {f.label}: {f.value}
          </span>
        ))}
        {(conflicts || unavailable) && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold text-amber-700 dark:text-amber-300">
            <TriangleAlert className="h-3 w-3" /> {conflicts ? "Conflito" : "Página mudou"}
          </span>
        )}
        {review.status === "merged" && review.merged_semver ? (
          <span className="font-mono text-xs font-semibold text-violet-700 dark:text-violet-300">Aplicada como {review.merged_semver}</span>
        ) : (
          active &&
          review.next_semver && (
            <span className="flex items-center gap-1 font-mono text-xs text-muted-foreground">
              {review.current_semver} <ArrowRight className="h-3 w-3" /> <span className="font-semibold text-foreground">{review.next_semver}</span>
            </span>
          )
        )}
      </button>
      {open && (
        <div className="border-t bg-background">
          {(conflicts || unavailable) && (
            <div className="flex flex-wrap items-center gap-3 border-b bg-amber-500/10 px-4 py-3 text-sm">
              <TriangleAlert className="h-4 w-4 shrink-0 text-amber-600" />
              <p className="min-w-0 flex-1">
                {conflicts
                  ? "A página mudou desde a proposta e os mesmos trechos foram mudados. Resolva os conflitos na proposta desta página antes de aplicar o pacote."
                  : "A página mudou desde a proposta e não foi possível combinar as mudanças. Abra a proposta desta página para decidir."}
              </p>
              <Button asChild size="sm" variant="outline">
                <Link to={`/admin/reviews/${review.id}`}>Abrir proposta da página</Link>
              </Button>
            </div>
          )}
          {diff && (
            <>
              <div className="flex items-center gap-2 px-4 pt-3 text-xs">
                <span className="rounded-full bg-emerald-500/12 px-2 py-0.5 font-bold text-emerald-700 dark:text-emerald-300">+{diff.stats.added}</span>
                <span className="rounded-full bg-red-500/12 px-2 py-0.5 font-bold text-red-700 dark:text-red-300">−{diff.stats.removed}</span>
                <Link to={`/admin/pages/${review.page_id}`} className="ml-auto inline-flex items-center gap-1 font-semibold text-muted-foreground hover:text-foreground">
                  <FilePen className="h-3.5 w-3.5" /> Abrir página
                </Link>
              </div>
              <div className="max-h-[60vh] overflow-auto">
                <DiffView
                  hunks={diff.hunks}
                  empty={review.has_content ? "O conteúdo proposto é igual ao atual." : "Esta página só tem mudanças de propriedades."}
                  legend={
                    review.status === "merged" ? `Antes de aplicar → ${review.merged_semver}` : `Versão ${review.current_semver} → proposta`
                  }
                />
              </div>
            </>
          )}
        </div>
      )}
    </li>
  );
}

export default function BatchDetailPage() {
  const { id = "" } = useParams();
  const { user, site } = useSession();
  const { mutate } = useSWRConfig();
  const { data: batch, error, isLoading, mutate: refresh } = useSWR<BatchDetail>(keys.batch(id));
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [opened, setOpened] = useState<Record<string, boolean>>({});

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-32 text-center">
        <p className="font-display text-2xl font-bold">{error instanceof ApiError && error.status === 404 ? "Pacote não encontrado" : "Algo deu errado"}</p>
        <Button asChild variant="outline">
          <Link to="/admin/reviews">
            <ArrowLeft /> Voltar às revisões
          </Link>
        </Button>
      </div>
    );
  }
  if (isLoading || !batch) {
    return (
      <div className="mx-auto max-w-[1100px] space-y-4 p-8">
        <Skeleton className="h-6 w-40 rounded-full" />
        <Skeleton className="h-12 w-2/3 rounded-xl" />
        <Skeleton className="h-60 rounded-3xl" />
      </div>
    );
  }

  const isAdmin = user?.role === "admin";
  const isAuthor = user?.username === batch.author;
  const active = ACTIVE_STATUSES.includes(batch.status);
  const canDecide = active && isAdmin && (!isAuthor || !!site?.review_self_approval);
  const total = batch.reviews.length;
  // com poucas páginas já abre tudo; com muitas, o revisor abre uma a uma
  const isOpen = (reviewId: string) => opened[reviewId] ?? total <= 3;

  const run = async (name: string, action: () => Promise<unknown>, success: string) => {
    setBusy(name);
    try {
      await action();
      await refresh();
      mutate((k) => typeof k === "string" && (k.startsWith("/api/admin/reviews") || k.startsWith("/api/admin/review-batches") || k === keys.stats || k === keys.adminTree));
      toast.success(success);
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha na operação", { duration: 9000 });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const sendComment = async () => {
    if (!comment.trim()) return;
    if (await run("comment", () => docsApi.commentBatch(batch.id, comment.trim()), "Comentário publicado")) setComment("");
  };
  const requestChanges = async () => {
    if (!comment.trim()) {
      toast.error("Explique no comentário o que precisa mudar");
      return;
    }
    if (await run("changes", () => docsApi.requestBatchChanges(batch.id, comment.trim()), "Alterações pedidas")) setComment("");
  };
  const approve = async () => {
    if (await run("approve", () => docsApi.approveBatch(batch.id, comment.trim()), "Pacote aprovado")) setComment("");
  };

  return (
    <div className="mx-auto max-w-[1100px] space-y-6 p-5 lg:p-8">
      <Link to="/admin/reviews" className="inline-flex items-center gap-1.5 text-xs font-bold text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Revisões
      </Link>

      <header className="rounded-3xl border bg-card p-6 sm:p-8">
        <div className="flex flex-wrap items-center gap-2">
          <ReviewStatusBadge status={batch.status} />
          <span className="font-mono text-xs font-bold text-muted-foreground">#{batch.number}</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-bold text-muted-foreground ring-1 ring-border">
            <Layers className="h-3 w-3" /> {total} {total === 1 ? "página" : "páginas"}
          </span>
        </div>
        <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight">{batch.title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">{batch.author}</span> propõe alterações em {total} {total === 1 ? "página" : "páginas"} · aberta{" "}
          {timeAgo(batch.created_at)}
        </p>
        {batch.description && <p className="mt-4 max-w-3xl whitespace-pre-wrap leading-relaxed">{batch.description}</p>}

        <div className="mt-6 flex flex-wrap items-center justify-end gap-2 border-t pt-5">
          {active && (isAuthor || isAdmin) && (
            <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => run("close", () => docsApi.closeBatch(batch.id), "Pacote fechado")}>
              <XCircle /> Fechar tudo
            </Button>
          )}
          {isAdmin && batch.status === "approved" && (
            <Button size="sm" disabled={!!busy} onClick={() => run("merge", () => docsApi.mergeBatch(batch.id), "Pacote aplicado: todas as páginas foram atualizadas")}>
              {busy === "merge" ? <Loader2 className="animate-spin" /> : <GitMerge />} Aplicar tudo
            </Button>
          )}
        </div>
      </header>

      <Tabs defaultValue="files">
        <TabsList>
          <TabsTrigger value="files">
            <Layers className="h-4 w-4" /> Páginas
            <span className="rounded-md bg-background px-1.5 font-mono text-[10px]">{total}</span>
          </TabsTrigger>
          <TabsTrigger value="conversation">
            <MessageSquare className="h-4 w-4" /> Conversa
          </TabsTrigger>
        </TabsList>

        <TabsContent value="files" className="mt-5">
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
            {batch.reviews.map((r) => (
              <PageChanges key={r.id} review={r} open={isOpen(r.id)} onToggle={() => setOpened((o) => ({ ...o, [r.id]: !isOpen(r.id) }))} />
            ))}
          </ul>
        </TabsContent>

        <TabsContent value="conversation" className="mt-5 space-y-6">
          <Timeline events={batch.events} />
          {active && (
            <div className="rounded-3xl border bg-card p-4">
              <Textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={canDecide ? "Deixe um comentário, aprove ou peça alterações…" : "Deixe um comentário…"}
                className={cn("min-h-[96px] resize-y border-0 bg-transparent p-1 shadow-none focus-visible:ring-0")}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) sendComment();
                }}
              />
              <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t pt-3">
                {isAdmin && isAuthor && !site?.review_self_approval && (
                  <span className="mr-auto text-xs text-muted-foreground">Outro administrador precisa aprovar o seu pacote.</span>
                )}
                <Button variant="outline" size="sm" disabled={!comment.trim() || !!busy} onClick={sendComment}>
                  {busy === "comment" ? <Loader2 className="animate-spin" /> : <MessageSquare />} Comentar
                </Button>
                {canDecide && (
                  <>
                    <Button variant="outline" size="sm" disabled={!!busy} onClick={requestChanges}>
                      {busy === "changes" ? <Loader2 className="animate-spin" /> : <TriangleAlert />} Pedir alterações
                    </Button>
                    {batch.status !== "approved" && (
                      <Button variant="navy" size="sm" disabled={!!busy} onClick={approve}>
                        {busy === "approve" ? <Loader2 className="animate-spin" /> : <Check />} Aprovar tudo
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
