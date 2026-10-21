import { ArrowRight, Check, CheckCircle2, FileDiff, FilePen, GitPullRequest, Layers, Loader2, Rocket } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";
import useSWR, { mutate } from "swr";

import { ChangesDialog } from "@/components/admin/changes-dialog";
import { PageIcon } from "@/components/page-icon";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, docsApi, keys, type Page, type TreeNode } from "@/lib/api";
import { changedFields, rebaseLocal, reviewPayload, toDraft } from "@/lib/draft";
import { clearLocal, readLocal, useLocalDrafts, type LocalDraft } from "@/lib/local-drafts";
import { BUMP_OPTIONS, bumpSemver, type Bump } from "@/lib/semver";
import { cn } from "@/lib/utils";
import { useAdmin } from "@/pages/admin/admin-layout";

const LABEL = { title: "título", slug: "endereço", icon: "ícone", description: "descrição", published: "publicação", content: "conteúdo" } as const;

/**
 * Uma página na lista de envio:
 * - "edit": página publicada com alterações salvas neste navegador;
 * - "publish": rascunho que vai pedir a publicação (o conteúdo já está no servidor).
 */
interface Item {
  id: string;
  kind: "edit" | "publish";
  page: Page;
  local: LocalDraft | null;
  /** pode ir no envio */
  ready: boolean;
  /** por que não pode */
  reason: string | null;
  changes: (keyof typeof LABEL)[];
}

function flatten(nodes: TreeNode[], out: TreeNode[] = []) {
  for (const n of nodes) {
    out.push(n);
    flatten(n.children, out);
  }
  return out;
}

function describe(page: Page, local: LocalDraft | null): Omit<Item, "id" | "page" | "local"> {
  if (!page.published) return { kind: "publish", ready: true, reason: null, changes: ["published"] };
  const changes = local ? changedFields(rebaseLocal(local, page), page) : [];
  if (!local?.explicit) return { kind: "edit", ready: false, reason: "Tem alterações não salvas. Abra a página e use Salvar.", changes };
  if (changes.length === 0) return { kind: "edit", ready: false, reason: "Sem diferenças em relação à página publicada.", changes };
  return { kind: "edit", ready: true, reason: null, changes };
}

function Tick({ checked, disabled, label, onChange }: { checked: boolean; disabled?: boolean; label: string; onChange: () => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={cn(
        "flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border-2 transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        checked ? "border-brand bg-brand text-navy-900" : "border-border bg-background hover:border-brand/60",
      )}
    >
      {checked && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
    </button>
  );
}

function BumpPicker({ value, onChange, label }: { value: Bump; onChange: (b: Bump) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid gap-2 sm:grid-cols-3">
      {BUMP_OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-2xl border px-3 py-2 text-left transition-colors",
            value === o.value ? "border-foreground bg-muted" : "hover:border-foreground/30 hover:bg-muted/50",
          )}
        >
          <span className="block text-sm font-semibold">{o.label}</span>
          <span className="block text-xs leading-snug text-muted-foreground">{o.hint}</span>
        </button>
      ))}
    </div>
  );
}

function Row({
  item,
  icon,
  selected,
  onToggle,
  bump,
  onBump,
  done,
}: {
  item: Item;
  icon: string | null;
  selected: boolean;
  onToggle: () => void;
  bump: Bump;
  onBump: (b: Bump) => void;
  done: boolean;
}) {
  const { page, local, kind, ready, reason, changes } = item;
  const [diffOpen, setDiffOpen] = useState(false);
  const next = kind === "publish" ? bumpSemver(page.semver, "patch", true) : bumpSemver(page.semver, bump);
  const active = selected && ready && !done;

  return (
    <li
      data-testid="change-row"
      className={cn(
        "rounded-3xl border bg-card p-5 transition-all",
        active && "border-brand/50 shadow-glow",
        (!ready || done) && "bg-muted/30",
        done && "opacity-70",
      )}
    >
      <div className="flex flex-wrap items-center gap-4">
        <Tick checked={active} disabled={!ready || done} label={`Selecionar ${page.title}`} onChange={onToggle} />
        <span className="brand-tile flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl">
          <PageIcon name={icon} className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-display text-[17px] font-bold">{page.title}</span>
            {done ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/12 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700 ring-1 ring-emerald-500/25 dark:text-emerald-300">
                <CheckCircle2 className="h-3 w-3" /> Enviada para revisão
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-bold text-muted-foreground ring-1 ring-border">
                {kind === "publish" ? "Rascunho" : ready ? "Salva neste navegador" : "Não pode ser enviada"}
              </span>
            )}
          </p>
          <p className="mt-1 truncate font-mono text-xs text-muted-foreground">/docs/{page.path}</p>
        </div>
        {ready && !done && (
          <span className="flex items-center gap-1.5 rounded-xl bg-muted px-2.5 py-1.5 font-mono text-xs font-semibold" title="Versão da página depois de aplicada">
            {page.semver} <ArrowRight className="h-3 w-3 text-muted-foreground" /> <span className="text-brand-ink">{next}</span>
          </span>
        )}
      </div>

      {reason && !done && <p className="mt-3 text-sm text-muted-foreground">{reason}</p>}

      {ready && !done && (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {changes.map((c) => (
              <span key={c} className="rounded-full bg-brand/10 px-2.5 py-1 font-semibold text-brand-ink">
                {kind === "publish" ? "Publica a página" : `Altera ${LABEL[c]}`}
              </span>
            ))}
          </div>
          {kind === "edit" ? (
            <div className="space-y-2">
              <p className="text-sm font-medium leading-none">Tamanho da mudança</p>
              <BumpPicker value={bump} onChange={onBump} label={`Tamanho da mudança em ${page.title}`} />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">A primeira publicação da página é sempre a versão 1.0.0, qualquer que seja o tamanho.</p>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {local && kind === "edit" && (
          <>
            <Button variant="outline" size="sm" onClick={() => setDiffOpen(true)}>
              <FileDiff /> Ver alterações
            </Button>
            <ChangesDialog
              open={diffOpen}
              onOpenChange={setDiffOpen}
              current={rebaseLocal(local, page)}
              published={{
                label: `Desde a versão publicada (${page.semver})`,
                legend: `Comparando com a versão publicada (${page.semver})`,
                draft: toDraft(page),
              }}
              saved={null}
              onRestoreSaved={() => setDiffOpen(false)}
            />
          </>
        )}
        <Button asChild variant="ghost" size="sm">
          <Link to={`/admin/pages/${page.id}`}>
            <FilePen /> Abrir no editor
          </Link>
        </Button>
      </div>
    </li>
  );
}

export default function ChangesPage() {
  const drafts = useLocalDrafts();
  const { tree } = useAdmin();
  const [params] = useSearchParams();
  const [picked, setPicked] = useState<Record<string, boolean>>(() => (params.get("select") ? { [params.get("select")!]: true } : {}));
  const [bumps, setBumps] = useState<Record<string, Bump>>({});
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [description, setDescription] = useState("");
  const [sending, setSending] = useState(false);

  // páginas publicadas com rascunho local, rascunhos do servidor e as já enviadas nesta tela (continuam para mostrar o resultado)
  const draftNodes = useMemo(() => flatten(tree).filter((n) => !n.published), [tree]);
  const ids = useMemo(
    () => [...new Set([...Object.keys(drafts), ...Object.keys(done), ...draftNodes.map((n) => n.id)])],
    [drafts, done, draftNodes],
  );
  const iconOf = useMemo(() => new Map(flatten(tree).map((n) => [n.id, n.icon] as const)), [tree]);

  const { data: pages, isLoading } = useSWR<Page[]>(["changes", ...ids], () => Promise.all(ids.map((id) => api<Page>(keys.adminPage(id)))), {
    keepPreviousData: true,
  });

  const items: Item[] = useMemo(
    () =>
      (pages ?? []).map((page) => {
        const local = readLocal(page.id);
        return { id: page.id, page, local, ...describe(page, local) };
      }),
    // o rascunho local muda por fora do SWR: `drafts` refaz a leitura
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pages, drafts],
  );
  // páginas publicadas sem nada a enviar não entram (só as que tinham rascunho ou acabaram de ser enviadas)
  const shown = items.filter((i) => i.kind === "publish" || i.local || done[i.id]);
  const edits = shown.filter((i) => i.kind === "edit");
  const publishes = shown.filter((i) => i.kind === "publish");

  const sendable = shown.filter((i) => i.ready && !done[i.id]);
  const chosen = sendable.filter((i) => picked[i.id]);
  const allPicked = sendable.length > 0 && chosen.length === sendable.length;
  const bumpOf = (id: string) => bumps[id] ?? "patch";
  const nextOf = (i: Item) => (i.kind === "publish" ? bumpSemver(i.page.semver, "patch", true) : bumpSemver(i.page.semver, bumpOf(i.id)));

  async function send() {
    setSending(true);
    let sent = 0;
    for (const item of chosen) {
      try {
        const page = await api<Page>(keys.adminPage(item.id));
        const title = `Atualiza ${page.title}`;
        const payload =
          item.kind === "publish"
            ? { title, description, fields: { published: true }, base_version: page.version, base_semver: page.semver, bump: "patch" as Bump }
            : item.local?.explicit
              ? reviewPayload(page, item.local, { title, description, bump: bumpOf(item.id) })
              : null;
        if (!payload) continue;
        await docsApi.submitReview(item.id, payload);
        clearLocal(item.id);
        setDone((d) => ({ ...d, [item.id]: true }));
        sent++;
      } catch (err) {
        toast.error(`Não foi possível enviar “${item.page.title}”`, { description: (err as Error).message });
      }
    }
    setSending(false);
    if (sent > 0) {
      mutate(keys.stats);
      mutate(keys.adminTree);
      mutate((key) => typeof key === "string" && key.startsWith("/api/admin/reviews"));
      toast.success(`${sent} ${sent === 1 ? "proposta enviada" : "propostas enviadas"} para revisão`);
    }
  }

  const toggleAll = () => setPicked(Object.fromEntries(sendable.map((i) => [i.id, !allPicked])));
  const sentCount = Object.keys(done).length;

  const section = (title: string, hint: string, list: Item[]) =>
    list.length > 0 && (
      <section className="space-y-3">
        <div>
          <h2 className="font-display text-lg font-bold">{title}</h2>
          <p className="text-sm text-muted-foreground">{hint}</p>
        </div>
        <ul className="space-y-3">
          {list.map((item) => (
            <Row
              key={item.id}
              item={item}
              icon={iconOf.get(item.id) ?? null}
              selected={!!picked[item.id]}
              onToggle={() => setPicked((p) => ({ ...p, [item.id]: !p[item.id] }))}
              bump={bumpOf(item.id)}
              onBump={(b) => setBumps((s) => ({ ...s, [item.id]: b }))}
              done={!!done[item.id]}
            />
          ))}
        </ul>
      </section>
    );

  return (
    <div className="mx-auto max-w-[1100px] space-y-6 p-5 lg:p-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 font-display text-3xl font-semibold tracking-tight">
            <span className="brand-tile flex h-11 w-11 items-center justify-center rounded-2xl">
              <Layers className="h-5 w-5" />
            </span>
            Alterações
          </h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            Escolha o que vai para revisão. Cada página vira uma proposta; nada é publicado até um administrador aprovar e aplicar.
          </p>
        </div>
        {sendable.length > 1 && (
          <Button variant="outline" onClick={toggleAll}>
            {allPicked ? "Desmarcar todas" : "Marcar todas"}
          </Button>
        )}
      </header>

      {isLoading && !pages ? (
        <div className="space-y-3">
          {Array.from({ length: 2 }, (_, i) => (
            <Skeleton key={i} className="h-40 rounded-3xl" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed py-16 text-center">
          <span className="brand-tile flex h-12 w-12 items-center justify-center rounded-2xl">
            <CheckCircle2 className="h-5 w-5" />
          </span>
          <p className="font-display text-lg font-bold">Nenhuma alteração pendente</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Edite uma página publicada e use Salvar, ou crie um rascunho para pedir a publicação. Tudo que estiver pronto aparece aqui.
          </p>
        </div>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-8">
            {section("Páginas publicadas", "Alterações salvas neste navegador.", edits)}
            {section("Rascunhos", "Ainda não visíveis para os leitores. Peça a publicação.", publishes)}
          </div>

          <aside className="space-y-4 rounded-3xl border bg-card p-5 lg:sticky lg:top-6">
            <div className="flex items-center gap-3">
              <span className="brand-tile flex h-10 w-10 items-center justify-center rounded-xl">
                <Rocket className="h-[18px] w-[18px]" />
              </span>
              <div>
                <h2 className="font-display text-lg font-bold leading-tight">Resumo do envio</h2>
                <p className="text-xs text-muted-foreground">
                  {chosen.length === 0 ? "Nenhuma página marcada" : `${chosen.length} ${chosen.length === 1 ? "página marcada" : "páginas marcadas"}`}
                </p>
              </div>
            </div>

            {chosen.length > 0 && (
              <ul className="divide-y rounded-2xl border text-sm">
                {chosen.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="truncate font-medium">{i.page.title}</span>
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">
                      {i.page.semver} → <span className="font-semibold text-foreground">{nextOf(i)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <div className="space-y-2">
              <label className="text-sm font-medium leading-none" htmlFor="batch-description">
                O que mudou e por quê
              </label>
              <textarea
                id="batch-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={5}
                maxLength={2000}
                placeholder="Contexto para quem vai revisar: o que motivou a mudança, links de referência…"
                className="w-full resize-none rounded-xl border bg-background/60 px-3 py-2 text-sm outline-none focus:border-brand/50 focus:ring-4 focus:ring-brand/10"
              />
              <p className="text-xs text-muted-foreground">Obrigatório. Vale para todas as páginas marcadas.</p>
            </div>

            <Button className="w-full" onClick={() => void send()} disabled={sending || chosen.length === 0 || !description.trim()}>
              {sending ? <Loader2 className="animate-spin" /> : <GitPullRequest />} Enviar para revisão ({chosen.length})
            </Button>
            {sentCount > 0 && (
              <Button asChild variant="ghost" className="w-full">
                <Link to="/admin/reviews">Ver revisões</Link>
              </Button>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
