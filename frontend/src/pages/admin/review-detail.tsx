import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDot,
  ExternalLink,
  Eye,
  FilePen,
  GitMerge,
  GitPullRequest,
  Layers,
  Loader2,
  MessageSquare,
  PenLine,
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
import { ApiError, docsApi, keys, type MergeChoice, type ReviewDetail, type ReviewEvent, type ReviewItemDetail } from "@/lib/api";
import { collapseDiff, diffLines, diffStats } from "@/lib/diff";
import { ACTIVE_STATUSES, describeFields, EVENT_VERB } from "@/lib/reviews";
import { BUMP_LABEL } from "@/lib/semver";
import { cn, formatDate, splitLeadingH1, timeAgo } from "@/lib/utils";
import { ReviewStatusBadge } from "@/pages/admin/reviews";

const EVENT_TONE: Partial<Record<ReviewEvent["type"], { icon: typeof Check; className: string }>> = {
  created: { icon: GitPullRequest, className: "bg-brand text-navy-900" },
  comment: { icon: MessageSquare, className: "bg-foreground/80 text-background" },
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

/** O que a página terá depois de aplicar: a mesclagem automática, quando existe. */
const shownContent = (item: ReviewItemDetail) =>
  item.merge?.state === "clean" && item.merge.merged_content != null ? item.merge.merged_content : item.proposed_content;

/** Uma página da proposta: resumo na linha e, aberta, o diff ou a prévia do resultado. */
function PageChanges({ item, status, open, onToggle }: { item: ReviewItemDetail; status: ReviewDetail["status"]; open: boolean; onToggle: () => void }) {
  const active = ACTIVE_STATUSES.includes(status);
  const ops = useMemo(() => diffLines(item.current_content, shownContent(item)), [item]);
  const diff = useMemo(() => (open ? collapseDiff(ops) : null), [open, ops]);
  const stats = useMemo(() => diffStats(ops), [ops]);
  const [view, setView] = useState<"diff" | "preview">("diff");
  const fields = describeFields(item.fields);
  const state = active ? item.merge?.state : undefined;
  const outdated = active && item.current_version !== item.base_version;

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
          <span className="block truncate text-sm font-semibold">{item.page_title}</span>
          <span className="block truncate font-mono text-xs text-muted-foreground">/docs/{item.page_path}</span>
        </span>
        <span className="rounded-full bg-emerald-500/12 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-300">+{stats.added}</span>
        <span className="rounded-full bg-red-500/12 px-2 py-0.5 text-[11px] font-bold text-red-700 dark:text-red-300">−{stats.removed}</span>
        {fields.map((f) => (
          <span key={f.label} className="rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-semibold text-brand-ink">
            {f.label}: {f.value}
          </span>
        ))}
        {state === "conflicts" && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold text-amber-700 dark:text-amber-300">
            <TriangleAlert className="h-3 w-3" /> Conflito
          </span>
        )}
        {outdated && state !== "conflicts" && (
          <span className="rounded-full bg-sky-500/12 px-2 py-0.5 text-[11px] font-bold text-sky-700 dark:text-sky-300">
            {state === "clean" ? "Combinada com a página" : "Página mudou"}
          </span>
        )}
        {status === "merged" && item.merged_semver ? (
          <span className="font-mono text-xs font-semibold text-violet-700 dark:text-violet-300">Aplicada como {item.merged_semver}</span>
        ) : (
          active &&
          item.next_semver && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              {BUMP_LABEL[item.bump]}: <span className="font-mono">{item.current_semver}</span> <ArrowRight className="h-3 w-3" />{" "}
              <span className="font-mono font-semibold text-foreground">{item.next_semver}</span>
            </span>
          )
        )}
      </button>
      {open && diff && (
        <div className="border-t bg-background">
          <div className="flex flex-wrap items-center gap-2 px-4 pt-3 text-xs">
            <div role="tablist" aria-label={`Ver ${item.page_title}`} className="flex rounded-lg bg-muted p-0.5">
              {(
                [
                  ["diff", "Alterações", PenLine],
                  ["preview", "Visualizar", Eye],
                ] as const
              ).map(([id, label, Icon]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={view === id}
                  onClick={() => setView(id)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-2.5 py-1 font-bold transition-colors",
                    view === id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" /> {label}
                </button>
              ))}
            </div>
            <Link to={`/admin/pages/${item.page_id}`} className="ml-auto inline-flex items-center gap-1 font-semibold text-muted-foreground hover:text-foreground">
              <FilePen className="h-3.5 w-3.5" /> Abrir página
            </Link>
          </div>
          {view === "diff" ? (
            <div className="mt-3 max-h-[60vh] overflow-auto">
              <DiffView
                hunks={diff}
                empty={item.has_content ? "O conteúdo proposto é igual ao atual." : "Esta página só tem mudanças de propriedades."}
                legend={status === "merged" ? `Antes de aplicar → ${item.merged_semver}` : `Versão ${item.current_semver} → proposta`}
                notice={outdated ? (state === "clean" ? "combinada com a página" : "página mudou") : undefined}
              />
            </div>
          ) : (
            <div className="m-4 rounded-2xl border bg-card p-6 sm:p-8">
              {item.page_kind === "doc" ? (
                <Markdown content={splitLeadingH1(shownContent(item)).body} />
              ) : (
                <ApiReference kind={item.page_kind} content={shownContent(item)} />
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export default function ReviewDetailPage() {
  const { id = "" } = useParams();
  const { user, site } = useSession();
  const { mutate } = useSWRConfig();
  const { data: review, error, isLoading, mutate: refresh } = useSWR<ReviewDetail>(keys.review(id));
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [forceDialog, setForceDialog] = useState(false);
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  // escolhas do revisor por página e por conflito (null = ainda não escolheu); recomeçam quando os conflitos mudam
  const [choices, setChoices] = useState<Record<string, { key: string; values: (MergeChoice | null)[] }>>({});

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
  if (isLoading || !review) {
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
  const total = review.items.length;
  const single = total === 1 ? review.items[0] : null;
  // com poucas páginas já abre tudo; com muitas, o revisor abre uma a uma
  const isOpen = (pageId: string) => opened[pageId] ?? total <= 3;

  const withConflicts = active ? review.items.filter((i) => i.merge?.state === "conflicts") : [];
  const conflictsKey = (item: ReviewItemDetail) => `${item.page_id}:${item.merge?.current_version}:${item.merge?.conflicts.length}`;
  const pickedFor = (item: ReviewItemDetail) => {
    const saved = choices[item.page_id];
    return saved && saved.key === conflictsKey(item) ? saved.values : (item.merge?.conflicts ?? []).map(() => null);
  };
  const unresolved = withConflicts.reduce((n, item) => n + pickedFor(item).filter((c) => c === null).length, 0);
  const combined = active ? review.items.filter((i) => i.current_version !== i.base_version && i.merge?.state === "clean") : [];
  const unmergeable = active ? review.items.filter((i) => i.current_version !== i.base_version && i.merge?.state === "unavailable") : [];

  const run = async (name: string, action: () => Promise<unknown>, success: string) => {
    setBusy(name);
    try {
      await action();
      await refresh();
      mutate((k) => typeof k === "string" && (k.startsWith("/api/admin/reviews") || k === keys.stats || k === keys.adminTree));
      toast.success(success);
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && name === "merge" && unmergeable.length > 0) setForceDialog(true);
      else toast.error(err instanceof Error ? err.message : "Falha na operação", { duration: 9000 });
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
          resolutions: force ? undefined : Object.fromEntries(withConflicts.map((i) => [i.page_id, pickedFor(i) as MergeChoice[]])),
        }),
      total > 1
        ? `Proposta aplicada: ${total} páginas atualizadas`
        : combined.length > 0
          ? "Proposta aplicada, combinada com as mudanças da página"
          : withConflicts.length > 0 && !force
            ? "Proposta aplicada com os conflitos resolvidos"
            : "Proposta aplicada na página",
    );

  return (
    <div className="mx-auto max-w-[1100px] space-y-6 p-5 lg:p-8">
      <Link to="/admin/reviews" className="inline-flex items-center gap-1.5 text-xs font-bold text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Revisões
      </Link>

      <header className="relative overflow-clip rounded-3xl border bg-card p-6 sm:p-8">
        <div className="relative flex flex-wrap items-center gap-2">
          <ReviewStatusBadge status={review.status} />
          <span className="font-mono text-xs font-bold text-muted-foreground">#{review.number}</span>
          {total > 1 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-bold text-muted-foreground ring-1 ring-border">
              <Layers className="h-3 w-3" /> {total} páginas
            </span>
          )}
        </div>
        <h1 className="relative mt-3 font-display text-3xl font-semibold tracking-tight">{review.title}</h1>
        <p className="relative mt-2 text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">{review.author}</span> propõe alterações em{" "}
          {single ? (
            <>
              <Link to={`/admin/pages/${single.page_id}`} className="font-semibold text-brand-ink hover:underline">
                {single.page_title}
              </Link>{" "}
              {single.base_semver && `a partir da versão ${single.base_semver} `}
            </>
          ) : (
            `${total} páginas `
          )}
          · aberta {timeAgo(review.created_at)}
        </p>
        {review.description && <p className="relative mt-4 max-w-3xl whitespace-pre-wrap leading-relaxed">{review.description}</p>}

        <div className="relative mt-6 flex flex-wrap items-center gap-2 border-t pt-5">
          {single &&
            (review.status === "merged" && single.merged_semver ? (
              <span className="rounded-full border bg-background/70 px-2.5 py-1 text-xs font-semibold">
                Aplicada como <span className="font-mono">{single.merged_semver}</span>
              </span>
            ) : (
              active &&
              single.next_semver && (
                <span className="rounded-full border bg-background/70 px-2.5 py-1 text-xs font-semibold">
                  {BUMP_LABEL[single.bump]}: <span className="font-mono">{single.current_semver}</span> →{" "}
                  <span className="font-mono">{single.next_semver}</span>
                </span>
              )
            ))}
          {single &&
            describeFields(single.fields).map((f) => (
              <span key={f.label} className="rounded-full border bg-background/70 px-2.5 py-1 text-xs font-semibold">
                {f.label}: <span className="text-muted-foreground">{f.value}</span>
              </span>
            ))}
          <span className="ml-auto" />
          {active && (isAuthor || isAdmin) && (
            <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => run("close", () => docsApi.closeReview(review.id), "Proposta fechada")}>
              <XCircle /> Fechar
            </Button>
          )}
          {active && isAuthor && single && (
            <Button asChild variant="outline" size="sm">
              <Link to={`/admin/pages/${single.page_id}`}>
                <PenLine /> Continuar editando
              </Link>
            </Button>
          )}
          {review.status === "merged" && single && (
            <Button asChild variant="outline" size="sm">
              <a href={`/docs/${single.page_path}`} target="_blank" rel="noreferrer">
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
              {unresolved > 0 ? `Resolva ${unresolved} conflito(s)` : single ? "Aplicar na página" : `Aplicar nas ${total} páginas`}
            </Button>
          )}
        </div>
      </header>

      {isAdmin && review.status === "approved" && (
        <section aria-label="Versão resultante" className="rounded-3xl border bg-card p-5">
          <h2 className="font-display text-base font-semibold tracking-tight">Versão resultante</h2>
          <ul className="mt-1 space-y-0.5 text-sm text-muted-foreground">
            {review.items.map((i) => (
              <li key={i.page_id}>
                {single ? "Ao aplicar, a página" : `“${i.page_title}”`} vai de <span className="font-mono font-semibold text-foreground">{i.current_semver}</span>{" "}
                para <span className="font-mono font-semibold text-foreground">{i.next_semver}</span>.
              </li>
            ))}
          </ul>
        </section>
      )}
      {combined.length > 0 && (
        <div className="flex items-start gap-3 rounded-2xl border border-sky-500/40 bg-sky-500/10 p-4 text-sm">
          <GitMerge className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
          <p>
            {single ? "A página mudou" : `${combined.map((i) => `“${i.page_title}”`).join(", ")} mudou`} desde que a proposta foi aberta, mas as mudanças não se
            sobrepõem: elas se combinam sozinhas. As alterações mostram o resultado, com o que mudou na página e o que a proposta traz.
          </p>
        </div>
      )}
      {unmergeable.length > 0 && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p>
            {single ? "A página mudou" : `${unmergeable.map((i) => `“${i.page_title}”`).join(", ")} mudou`} desde que a proposta foi aberta e não foi possível
            combinar as mudanças automaticamente. As alterações comparam com a versão atual; aplicar vai sobrescrever o que mudou nesse meio-tempo.
          </p>
        </div>
      )}
      {withConflicts.map((item) => (
        <div key={item.page_id} className="space-y-4">
          <div className="flex items-start gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <p>
              {single ? "A página" : `“${item.page_title}”`} mudou desde que a proposta foi aberta (versão {item.base_semver} → {item.current_semver}) e{" "}
              {item.merge!.conflicts.length === 1 ? "1 trecho foi mudado" : `${item.merge!.conflicts.length} trechos foram mudados`} dos dois lados. O
              restante se combina sozinho; escolha abaixo o que fica em cada conflito.
            </p>
          </div>
          {isAdmin && review.status === "approved" ? (
            <MergeConflicts
              conflicts={item.merge!.conflicts}
              choices={pickedFor(item)}
              baseSemver={item.base_semver}
              currentSemver={item.current_semver}
              onChange={(i, value) => {
                const next = [...pickedFor(item)];
                next[i] = value;
                setChoices((c) => ({ ...c, [item.page_id]: { key: conflictsKey(item), values: next } }));
              }}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Depois de aprovada, quem for aplicar escolhe o que fica em cada conflito.</p>
          )}
        </div>
      ))}

      <Tabs defaultValue="conversation">
        <TabsList>
          <TabsTrigger value="conversation">
            <MessageSquare className="h-4 w-4" /> Conversa
          </TabsTrigger>
          <TabsTrigger value="changes">
            <PenLine className="h-4 w-4" /> Alterações
            {total > 1 && <span className="rounded-md bg-background px-1.5 font-mono text-[10px]">{total}</span>}
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
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
            {review.items.map((item) => (
              <PageChanges
                key={item.page_id}
                item={item}
                status={review.status}
                open={isOpen(item.page_id)}
                onToggle={() => setOpened((o) => ({ ...o, [item.page_id]: !isOpen(item.page_id) }))}
              />
            ))}
          </ul>
        </TabsContent>
      </Tabs>

      <AlertDialog open={forceDialog} onOpenChange={setForceDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{single ? "A página mudou desde a proposta" : "Páginas mudaram desde a proposta"}</AlertDialogTitle>
            <AlertDialogDescription>
              Alguém publicou outra versão de {unmergeable.map((i) => `“${i.page_title}”`).join(", ")} depois que esta proposta foi aberta, e as
              mudanças não se combinam sozinhas. Aplicar agora substitui o conteúdo atual pelo conteúdo proposto — o que mudou no meio-tempo continua no
              histórico de versões.
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
