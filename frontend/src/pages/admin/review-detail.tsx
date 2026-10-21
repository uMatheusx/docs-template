import {
  ArrowLeft,
  Check,
  CircleDot,
  ExternalLink,
  GitMerge,
  Loader2,
  MessageSquare,
  PenLine,
  Eye,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import useSWR, { useSWRConfig } from "swr";

import { DiffView } from "@/components/admin/diff-view";
import { MergeConflicts } from "@/components/admin/merge-conflicts";
import { ApiReference } from "@/components/api/api-reference";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useSession } from "@/hooks/use-session";
import { ApiError, docsApi, keys, type MergeChoice, type ReviewDetail, type ReviewEvent } from "@/lib/api";
import { collapseDiff, diffLines, diffStats } from "@/lib/diff";
import { ACTIVE_STATUSES, describeFields, EVENT_VERB } from "@/lib/reviews";
import { BUMP_LABEL } from "@/lib/semver";
import { cn, formatDate, splitLeadingH1, timeAgo } from "@/lib/utils";
import { ReviewStatusBadge } from "@/pages/admin/reviews";

const EVENT_TONE: Partial<Record<ReviewEvent["type"], { icon: typeof Check; className: string }>> = {
  approved: { icon: Check, className: "bg-emerald-500 text-white" },
  changes_requested: { icon: TriangleAlert, className: "bg-amber-500 text-white" },
  merged: { icon: GitMerge, className: "bg-violet-500 text-white" },
  closed: { icon: XCircle, className: "bg-muted-foreground text-background" },
  updated: { icon: PenLine, className: "bg-sky-500 text-white" },
};

export function Timeline({ events }: { events: ReviewEvent[] }) {
  return (
    <ol className="relative space-y-4 before:absolute before:bottom-2 before:left-[15px] before:top-2 before:w-px before:bg-border">
      {events.map((e) => {
        const tone = EVENT_TONE[e.type];
        const Icon = tone?.icon ?? (e.type === "comment" ? MessageSquare : CircleDot);
        return (
          <li key={e.id} className="relative flex gap-3">
            <span
              className={cn(
                "relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-4 ring-background",
                tone?.className ?? "brand-tile",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
            </span>
            <div className={cn("min-w-0 flex-1", e.body && "rounded-2xl border bg-card")}>
              <p className={cn("text-sm", e.body ? "border-b px-4 py-2.5" : "pt-1.5")}>
                <span className="font-bold">{e.author}</span> <span className="text-muted-foreground">{EVENT_VERB[e.type]}</span>{" "}
                <span className="text-xs text-muted-foreground" title={formatDate(e.at)}>
                  {timeAgo(e.at)}
                </span>
              </p>
              {e.body && <p className="whitespace-pre-wrap px-4 py-3 text-[14.5px] leading-relaxed">{e.body}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export default function ReviewDetailPage() {
  const { id = "" } = useParams();
  const { user, site } = useSession();
  const { mutate } = useSWRConfig();
  const { data: review, error, isLoading, mutate: refresh } = useSWR<ReviewDetail>(keys.review(id));
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  // escolha do revisor para cada conflito (null = ainda não escolheu); recomeça quando os conflitos mudam
  const [choices, setChoices] = useState<{ key: string; values: (MergeChoice | null)[] }>({ key: "", values: [] });


  const mergeInfo = review?.merge ?? null;
  const conflictList = mergeInfo?.state === "conflicts" ? mergeInfo.conflicts : [];
  const conflictsKey = `${review?.id}:${mergeInfo?.current_version}:${conflictList.length}`;
  const picked = choices.key === conflictsKey ? choices.values : conflictList.map(() => null);
  const unresolved = picked.filter((c) => c === null).length;
  // texto que a página terá depois de aplicar: a mesclagem automática, quando existe
  const shownContent =
    mergeInfo?.state === "clean" && mergeInfo.merged_content != null ? mergeInfo.merged_content : review?.proposed_content;

  const diff = useMemo(() => {
    if (!review || shownContent === undefined) return null;
    const ops = diffLines(review.current_content, shownContent);
    return { hunks: collapseDiff(ops), stats: diffStats(ops) };
  }, [review, shownContent]);

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-32 text-center">
        <p className="font-display text-2xl font-bold">{error instanceof ApiError && error.status === 404 ? "Proposta não encontrada" : "Algo deu errado"}</p>
        <Button asChild variant="outline">
          <Link to="/admin/reviews">
            <ArrowLeft /> Voltar às revisões
          </Link>
        </Button>
      </div>
    );
  }
  if (isLoading || !review || !diff) {
    return (
      <div className="mx-auto max-w-[1100px] space-y-4 p-8">
        <Skeleton className="h-6 w-40 rounded-full" />
        <Skeleton className="h-12 w-2/3 rounded-xl" />
        <Skeleton className="h-80 rounded-3xl" />
      </div>
    );
  }

  const isAdmin = user?.role === "admin";
  const isAuthor = user?.username === review.author;
  const active = ACTIVE_STATUSES.includes(review.status);
  const canDecide = active && isAdmin && (!isAuthor || !!site?.review_self_approval);
  const outdated = review.current_version !== review.base_version;
  const fields = describeFields(review.fields);

  const run = async (name: string, action: () => Promise<unknown>, success: string) => {
    setBusy(name);
    try {
      await action();
      await refresh();
      mutate((k) => typeof k === "string" && (k.startsWith("/api/admin/reviews") || k === keys.stats || k === keys.adminTree));
      toast.success(success);
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && name === "merge") setConflict(true);
      else toast.error(err instanceof Error ? err.message : "Falha na operação");
      return false;
    } finally {
      setBusy(null);
    }
  };

  const sendComment = async () => {
    if (!comment.trim()) return;
    if (await run("comment", () => docsApi.commentReview(review.id, comment.trim()), "Comentário publicado")) setComment("");
  };
  const requestChanges = async () => {
    if (!comment.trim()) {
      toast.error("Explique no comentário o que precisa mudar");
      return;
    }
    if (await run("changes", () => docsApi.requestChanges(review.id, comment.trim()), "Alterações pedidas")) setComment("");
  };
  const approve = async () => {
    if (await run("approve", () => docsApi.approveReview(review.id, comment.trim()), "Proposta aprovada")) setComment("");
  };
  const merge = (force = false) =>
    run(
      "merge",
      () =>
        docsApi.mergeReview(review.id, {
          force,
          resolutions: conflictList.length > 0 && !force ? (picked as MergeChoice[]) : undefined,
        }),
      mergeInfo?.state === "clean"
        ? "Proposta aplicada, combinada com as mudanças da página"
        : conflictList.length > 0 && !force
          ? "Proposta aplicada com os conflitos resolvidos"
          : "Proposta aplicada na página",
    );

  const previewContent = shownContent ?? review.proposed_content;
  const previewBody = review.page_kind === "doc" ? splitLeadingH1(previewContent).body : "";

  return (
    <div className="mx-auto max-w-[1100px] space-y-6 p-5 lg:p-8">
      <Link to="/admin/reviews" className="inline-flex items-center gap-1.5 text-xs font-bold text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Revisões
      </Link>

      <header className="relative overflow-clip rounded-3xl border bg-card p-6 sm:p-8">
        <div className="relative flex flex-wrap items-center gap-2">
          <ReviewStatusBadge status={review.status} />
          <span className="font-mono text-xs font-bold text-muted-foreground">#{review.number}</span>
        </div>
        <h1 className="relative mt-3 font-display text-3xl font-semibold tracking-tight">{review.title}</h1>
        <p className="relative mt-2 text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">{review.author}</span> propõe alterações em{" "}
          <Link to={`/admin/pages/${review.page_id}`} className="font-semibold text-brand-ink hover:underline">
            {review.page_title}
          </Link>{" "}
          a partir da versão {review.base_semver} · aberta {timeAgo(review.created_at)}
        </p>
        {review.description && <p className="relative mt-4 max-w-3xl whitespace-pre-wrap leading-relaxed">{review.description}</p>}

        <div className="relative mt-6 flex flex-wrap items-center gap-2 border-t pt-5">
          <span className="rounded-full bg-emerald-500/12 px-2.5 py-1 text-xs font-bold text-emerald-700 dark:text-emerald-300">+{diff.stats.added}</span>
          <span className="rounded-full bg-red-500/12 px-2.5 py-1 text-xs font-bold text-red-700 dark:text-red-300">−{diff.stats.removed}</span>
          {review.status === "merged" && review.merged_semver ? (
            <span className="rounded-full border bg-background/70 px-2.5 py-1 text-xs font-semibold">
              Aplicada como <span className="font-mono">{review.merged_semver}</span>
            </span>
          ) : (
            active &&
            review.next_semver && (
              <span className="rounded-full border bg-background/70 px-2.5 py-1 text-xs font-semibold">
                {BUMP_LABEL[review.bump]}: <span className="font-mono">{review.current_semver}</span> →{" "}
                <span className="font-mono">{review.next_semver}</span>
              </span>
            )
          )}
          {fields.map((f) => (
            <span key={f.label} className="rounded-full border bg-background/70 px-2.5 py-1 text-xs font-semibold">
              {f.label}: <span className="text-muted-foreground">{f.value}</span>
            </span>
          ))}
          <span className="ml-auto flex flex-wrap gap-2">
            {active && (isAuthor || isAdmin) && (
              <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => run("close", () => docsApi.closeReview(review.id), "Proposta fechada")}>
                <XCircle /> Fechar
              </Button>
            )}
            {active && isAuthor && (
              <Button asChild variant="outline" size="sm">
                <Link to={`/admin/pages/${review.page_id}`}>
                  <PenLine /> Continuar editando
                </Link>
              </Button>
            )}
            {review.status === "merged" && (
              <Button asChild variant="outline" size="sm">
                <a href={`/docs/${review.page_path}`} target="_blank" rel="noreferrer">
                  <ExternalLink /> Ver página
                </a>
              </Button>
            )}
            {isAdmin && review.status === "approved" && (
              <Button
                size="sm"
                disabled={!!busy || unresolved > 0}
                title={unresolved > 0 ? `Resolva os ${unresolved} conflito(s) pendente(s) antes de aplicar` : undefined}
                onClick={() => merge()}
              >
                {busy === "merge" ? <Loader2 className="animate-spin" /> : <GitMerge />}{" "}
                {unresolved > 0 ? `Resolva ${unresolved} conflito(s)` : "Aplicar na página"}
              </Button>
            )}
          </span>
        </div>
      </header>

      {isAdmin && review.status === "approved" && review.current_semver && (
        <section aria-label="Versão resultante" className="rounded-3xl border bg-card p-5">
          <h2 className="font-display text-base font-semibold tracking-tight">Versão resultante</h2>
          <p className="mb-3 mt-1 text-sm text-muted-foreground">
            Ao aplicar, a página vai de <span className="font-mono font-semibold text-foreground">{review.current_semver}</span> para{" "}
            <span className="font-mono font-semibold text-foreground">{review.next_semver}</span>.
          </p>
        </section>
      )}
      {active && outdated && mergeInfo?.state === "clean" && (
        <div className="flex items-start gap-3 rounded-2xl border border-sky-500/40 bg-sky-500/10 p-4 text-sm">
          <GitMerge className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
          <p>
            A página mudou desde que a proposta foi aberta (versão {review.base_semver} → {review.current_semver}), mas as mudanças não se
            sobrepõem: elas se combinam sozinhas. A aba Alterações mostra o resultado, com o que mudou na página e o que a proposta traz.
          </p>
        </div>
      )}
      {active && outdated && mergeInfo?.state === "conflicts" && (
        <>
          <div className="flex items-start gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <p>
              A página mudou desde que a proposta foi aberta (versão {review.base_semver} → {review.current_semver}) e{" "}
              {conflictList.length === 1 ? "1 trecho foi mudado" : `${conflictList.length} trechos foram mudados`} dos dois lados. O restante
              se combina sozinho; escolha abaixo o que fica em cada conflito.
            </p>
          </div>
          {isAdmin && review.status === "approved" ? (
            <MergeConflicts
              conflicts={conflictList}
              choices={picked}
              baseSemver={review.base_semver}
              currentSemver={review.current_semver}
              onChange={(i, value) => {
                const next = [...picked];
                next[i] = value;
                setChoices({ key: conflictsKey, values: next });
              }}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Depois de aprovada, quem for aplicar escolhe o que fica em cada conflito.</p>
          )}
        </>
      )}
      {active && outdated && (!mergeInfo || mergeInfo.state === "unavailable") && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p>
            A página mudou desde que a proposta foi aberta (versão {review.base_semver} → {review.current_semver}) e não foi possível
            combinar as mudanças automaticamente. As alterações abaixo comparam com a versão atual; aplicar vai sobrescrever o que mudou nesse
            meio-tempo.
          </p>
        </div>
      )}

      <Tabs defaultValue="conversation">
        <TabsList>
          <TabsTrigger value="conversation">
            <MessageSquare className="h-4 w-4" /> Conversa
          </TabsTrigger>
          <TabsTrigger value="changes">
            <PenLine className="h-4 w-4" /> Alterações
          </TabsTrigger>
          <TabsTrigger value="preview">
            <Eye className="h-4 w-4" /> Visualizar
          </TabsTrigger>
        </TabsList>

        <TabsContent value="conversation" className="mt-5 space-y-6">
          <Timeline events={review.events} />
          {active && (
            <div className="rounded-3xl border bg-card p-4">
              <Textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={canDecide ? "Deixe um comentário, aprove ou peça alterações…" : "Deixe um comentário…"}
                className="min-h-[96px] resize-y border-0 bg-transparent p-1 shadow-none focus-visible:ring-0"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) sendComment();
                }}
              />
              <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t pt-3">
                {isAdmin && isAuthor && !site?.review_self_approval && (
                  <span className="mr-auto text-xs text-muted-foreground">Outro administrador precisa aprovar a sua proposta.</span>
                )}
                <Button variant="outline" size="sm" disabled={!comment.trim() || !!busy} onClick={sendComment}>
                  {busy === "comment" ? <Loader2 className="animate-spin" /> : <MessageSquare />} Comentar
                </Button>
                {canDecide && (
                  <>
                    <Button variant="outline" size="sm" disabled={!!busy} onClick={requestChanges}>
                      {busy === "changes" ? <Loader2 className="animate-spin" /> : <TriangleAlert />} Pedir alterações
                    </Button>
                    {review.status !== "approved" && (
                      <Button variant="navy" size="sm" disabled={!!busy} onClick={approve}>
                        {busy === "approve" ? <Loader2 className="animate-spin" /> : <Check />} Aprovar
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="changes" className="mt-5">
          <div className="max-h-[70vh] overflow-auto rounded-3xl border bg-background">
            <DiffView
              hunks={diff.hunks}
              empty={review.has_content ? "O conteúdo proposto é igual ao atual." : "Esta proposta só altera propriedades da página."}
              legend={
                review.status === "merged"
                  ? `Antes de aplicar → ${review.merged_semver}`
                  : `Versão ${review.current_semver} → proposta`
              }
              notice={outdated ? (mergeInfo?.state === "clean" ? "combinada com a página" : "página mudou") : undefined}
            />
          </div>
        </TabsContent>

        <TabsContent value="preview" className="mt-5">
          <div className="rounded-3xl border bg-card p-6 sm:p-9">
            {review.page_kind === "doc" ? (
              <Markdown content={previewBody} />
            ) : (
              <ApiReference kind={review.page_kind} content={previewContent} />
            )}
          </div>
        </TabsContent>
      </Tabs>

      <AlertDialog open={conflict} onOpenChange={setConflict}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>A página mudou desde a proposta</AlertDialogTitle>
            <AlertDialogDescription>
              Alguém publicou outra versão de “{review.page_title}” depois que esta proposta foi aberta. Aplicar agora substitui o conteúdo atual
              pelo conteúdo proposto — o que mudou no meio-tempo continua no histórico de versões.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => merge(true)}>Aplicar mesmo assim</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
