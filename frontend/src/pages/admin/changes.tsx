import { ArrowRight, Check, CheckCircle2, FileDiff, FilePen, GitPullRequest, Layers, Loader2, Minus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";
import useSWR, { mutate } from "swr";

import { ChangesDialog } from "@/components/admin/changes-dialog";
import { PageIcon } from "@/components/page-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Hint } from "@/components/ui/tooltip";
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

function Tick({
  state,
  disabled,
  label,
  onChange,
}: {
  state: boolean | "mixed";
  disabled?: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={state}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={cn(
        "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md border transition-colors disabled:cursor-not-allowed disabled:opacity-35",
        state ? "border-brand bg-brand text-navy-900" : "border-foreground/25 bg-background hover:border-brand/70",
      )}
    >
      {state === "mixed" ? <Minus className="h-3 w-3" strokeWidth={3} /> : state ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
    </button>
  );
}

/** Tamanho da mudança: três opções lado a lado, no mesmo desenho dos seletores do editor. */
function BumpPicker({ value, onChange, label }: { value: Bump; onChange: (b: Bump) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg bg-muted p-0.5">
      {BUMP_OPTIONS.map((o) => (
        <Hint key={o.value} label={o.hint}>
          <button
            type="button"
            role="radio"
            aria-checked={value === o.value}
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-md px-2 py-1 text-[11px] font-bold transition-colors",
              value === o.value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        </Hint>
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
    <li data-testid="change-row" className={cn("px-4 py-3 transition-colors", active && "bg-brand/[0.05]", (!ready || done) && "bg-muted/30")}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Tick state={active} disabled={!ready || done} label={`Selecionar ${page.title}`} onChange={onToggle} />
        <PageIcon name={icon} className={cn("h-4 w-4 shrink-0", ready && !done ? "text-brand-ink" : "text-muted-foreground")} />
        <div className="min-w-0 flex-1 basis-48">
          <p className="truncate text-sm font-semibold">{page.title}</p>
          <p className="truncate text-xs text-muted-foreground">
            {done ? (
              <span className="inline-flex items-center gap-1 font-semibold text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="h-3 w-3" /> Enviada para revisão
              </span>
            ) : reason ? (
              reason
            ) : kind === "publish" ? (
              "Publica a página"
            ) : (
              `Altera ${changes.map((c) => LABEL[c]).join(", ")}`
            )}
          </p>
        </div>

        {ready && !done && kind === "edit" && <BumpPicker value={bump} onChange={onBump} label={`Tamanho da mudança em ${page.title}`} />}
        {ready && !done && (
          <span className="flex items-center gap-1 font-mono text-xs text-muted-foreground" title="Versão da página depois de aplicada">
            {page.semver} <ArrowRight className="h-3 w-3" /> <span className="font-semibold text-foreground">{next}</span>
          </span>
        )}

        <span className="flex items-center">
          {local && kind === "edit" && (
            <>
              <Hint label="Ver alterações">
                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Ver alterações" onClick={() => setDiffOpen(true)}>
                  <FileDiff />
                </Button>
              </Hint>
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
          <Hint label="Abrir no editor">
            <Button asChild variant="ghost" size="icon" className="h-8 w-8">
              <Link to={`/admin/pages/${page.id}`} aria-label={`Abrir ${page.title} no editor`}>
                <FilePen />
              </Link>
            </Button>
          </Hint>
        </span>
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
  const [query, setQuery] = useState("");
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
  const q = query.trim().toLowerCase();
  const visible = q ? shown.filter((i) => `${i.page.title} ${i.page.path}`.toLowerCase().includes(q)) : shown;
  const edits = visible.filter((i) => i.kind === "edit");
  const publishes = visible.filter((i) => i.kind === "publish");

  const sendable = shown.filter((i) => i.ready && !done[i.id]);
  const chosen = sendable.filter((i) => picked[i.id]);
  const bumpOf = (id: string) => bumps[id] ?? "patch";

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

  const sentCount = Object.keys(done).length;
  /** marca ou desmarca um grupo inteiro (só as páginas visíveis que podem ir) */
  const groupState = (list: Item[]): boolean | "mixed" => {
    const ok = list.filter((i) => i.ready && !done[i.id]);
    const on = ok.filter((i) => picked[i.id]).length;
    return ok.length > 0 && on === ok.length ? true : on > 0 ? "mixed" : false;
  };
  const toggleGroup = (list: Item[]) => {
    const ok = list.filter((i) => i.ready && !done[i.id]);
    const value = groupState(list) !== true;
    setPicked((p) => ({ ...p, ...Object.fromEntries(ok.map((i) => [i.id, value])) }));
  };

  const group = (title: string, list: Item[]) =>
    list.length > 0 && (
      <section className="overflow-hidden rounded-2xl border bg-card">
        <header className="flex items-center gap-3 border-b bg-muted/40 px-4 py-2.5">
          <Tick
            state={groupState(list)}
            disabled={!list.some((i) => i.ready && !done[i.id])}
            label={`Selecionar todas em ${title}`}
            onChange={() => toggleGroup(list)}
          />
          <h2 className="text-sm font-bold">{title}</h2>
          <span className="rounded-md bg-background px-1.5 font-mono text-[11px] text-muted-foreground ring-1 ring-border">{list.length}</span>
        </header>
        <ul className="divide-y">
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
    <div className="mx-auto max-w-[900px] space-y-5 p-5 lg:p-8">
      <header className="space-y-1">
        <h1 className="flex items-center gap-3 font-display text-3xl font-semibold tracking-tight">
          <span className="brand-tile flex h-11 w-11 items-center justify-center rounded-2xl">
            <Layers className="h-5 w-5" />
          </span>
          Alterações
        </h1>
        <p className="max-w-2xl text-muted-foreground">
          Marque o que vai para revisão. Cada página vira uma proposta, e nada é publicado até um administrador aprovar e aplicar.
        </p>
      </header>

      {isLoading && !pages ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-14 rounded-2xl" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed py-16 text-center">
          <span className="brand-tile flex h-12 w-12 items-center justify-center rounded-2xl">
            <CheckCircle2 className="h-5 w-5" />
          </span>
          <p className="font-display text-lg font-bold">Nenhuma alteração pendente</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Edite uma página publicada e use Salvar, ou crie um rascunho para pedir a publicação. O que estiver pronto aparece aqui.
          </p>
        </div>
      ) : (
        <>
          {shown.length > 6 && (
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filtrar por título ou endereço"
                aria-label="Filtrar páginas"
                className="pl-9"
              />
            </div>
          )}

          {visible.length === 0 ? (
            <p className="rounded-2xl border border-dashed py-10 text-center text-sm text-muted-foreground">Nenhuma página corresponde ao filtro.</p>
          ) : (
            <div className="space-y-4">
              {group("Páginas publicadas", edits)}
              {group("Rascunhos", publishes)}
            </div>
          )}

          {/* barra de envio: acompanha a rolagem, então funciona igual com 1 ou com 100 páginas */}
          <div className="sticky bottom-4 z-10 flex flex-wrap items-end gap-3 rounded-2xl border bg-card/95 p-3 shadow-lg backdrop-blur">
            <div className="min-w-0 flex-1 basis-64 space-y-1">
              <label htmlFor="batch-description" className="text-xs font-semibold text-muted-foreground">
                O que mudou e por quê <span className="font-normal">(obrigatório, vale para todas)</span>
              </label>
              <textarea
                id="batch-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={1}
                maxLength={2000}
                placeholder="Contexto para quem vai revisar…"
                className="max-h-32 min-h-[38px] w-full resize-y rounded-xl border bg-background/60 px-3 py-2 text-sm outline-none focus:border-brand/50 focus:ring-4 focus:ring-brand/10"
              />
            </div>
            <div className="flex items-center gap-2">
              {sentCount > 0 && (
                <Button asChild variant="ghost">
                  <Link to="/admin/reviews">Ver revisões</Link>
                </Button>
              )}
              <Button onClick={() => void send()} disabled={sending || chosen.length === 0 || !description.trim()}>
                {sending ? <Loader2 className="animate-spin" /> : <GitPullRequest />} Enviar para revisão ({chosen.length})
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
