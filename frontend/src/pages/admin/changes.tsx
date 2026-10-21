import { CheckCircle2, GitPullRequest, Layers, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";
import useSWR, { mutate } from "swr";

import { StatusLetter } from "@/components/status-letter";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, docsApi, keys, type Page } from "@/lib/api";
import { changedFields, reviewPayload } from "@/lib/draft";
import { clearLocal, readLocal, useLocalDrafts } from "@/lib/local-drafts";
import { BUMP_OPTIONS } from "@/lib/semver";
import type { Bump } from "@/lib/semver";
import { cn } from "@/lib/utils";

/** Uma linha por página com rascunho neste navegador. Só as publicadas e já salvas podem ir no lote. */
function Row({
  pageId,
  selected,
  onToggle,
  bump,
  onBump,
  done,
}: {
  pageId: string;
  selected: boolean;
  onToggle: (ready: boolean) => void;
  bump: Bump;
  onBump: (b: Bump) => void;
  done: boolean;
}) {
  const { data: page, isLoading } = useSWR<Page>(keys.adminPage(pageId));
  const local = readLocal(pageId);
  if (isLoading || !page) return <Skeleton className="h-16 rounded-2xl" />;
  const saved = !!local?.explicit;
  const changes = local ? changedFields(local.draft, page).length : 0;
  const ready = saved && page.published && changes > 0;
  const reason = !page.published
    ? "Rascunho: abra a página para salvar ou pedir a publicação."
    : !saved
      ? "Tem alterações não salvas: abra a página e use Salvar."
      : changes === 0
        ? "Sem diferenças em relação à página."
        : null;

  return (
    <li
      className={cn("flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3", !ready && "bg-muted/30", done && "opacity-60")}
      data-testid="change-row"
    >
      <input
        type="checkbox"
        aria-label={`Selecionar ${page.title}`}
        checked={selected && ready}
        disabled={!ready || done}
        onChange={() => onToggle(ready)}
        className="h-4 w-4 accent-brand"
      />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 truncate font-semibold">
          <StatusLetter status={!page.published ? "draft" : saved ? "saved" : "modified"} />
          {page.title}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {done ? "Enviada para revisão." : (reason ?? `${changes} ${changes === 1 ? "campo alterado" : "campos alterados"} · sobre a ${page.semver}`)}
        </p>
      </div>
      {ready && !done && (
        <select
          aria-label={`Tamanho da mudança em ${page.title}`}
          value={bump}
          onChange={(e) => onBump(e.target.value as Bump)}
          className="h-9 rounded-xl border bg-background px-2 text-sm"
        >
          {BUMP_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
      <Button asChild variant="ghost" size="sm">
        <Link to={`/admin/pages/${pageId}`}>Abrir</Link>
      </Button>
    </li>
  );
}

export default function ChangesPage() {
  const drafts = useLocalDrafts();
  const [params] = useSearchParams();
  const ids = useMemo(() => Object.keys(drafts), [drafts]);
  const [picked, setPicked] = useState<Record<string, boolean>>(() => (params.get("select") ? { [params.get("select")!]: true } : {}));
  const [bumps, setBumps] = useState<Record<string, Bump>>({});
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [description, setDescription] = useState("");
  const [sending, setSending] = useState(false);

  const chosen = ids.filter((id) => picked[id] && !done[id]);

  async function send() {
    setSending(true);
    let sent = 0;
    for (const id of chosen) {
      const local = readLocal(id);
      try {
        const page = await api<Page>(keys.adminPage(id));
        const payload = local && page.published && local.explicit
          ? reviewPayload(page, local, { title: page.title, description, bump: bumps[id] ?? "patch" })
          : null;
        if (!payload) continue;
        await docsApi.submitReview(id, payload);
        clearLocal(id);
        setDone((d) => ({ ...d, [id]: true }));
        sent++;
      } catch (err) {
        toast.error("Não foi possível enviar uma das páginas", { description: (err as Error).message });
      }
    }
    setSending(false);
    if (sent > 0) {
      mutate(keys.stats);
      mutate((key) => typeof key === "string" && key.startsWith("/api/admin/reviews"));
      toast.success(`${sent} ${sent === 1 ? "proposta enviada" : "propostas enviadas"} para revisão`);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
        <Layers className="h-6 w-6 text-brand" /> Alterações
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Páginas com alterações neste navegador. Escolha as que já estão salvas e envie todas de uma vez: cada página vira uma proposta de revisão.
      </p>

      {ids.length === 0 ? (
        <p className="mt-10 rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          <CheckCircle2 className="mx-auto mb-2 h-6 w-6" /> Nenhuma alteração pendente.
        </p>
      ) : (
        <>
          <ul className="mt-6 space-y-2">
            {ids.map((id) => (
              <Row
                key={id}
                pageId={id}
                selected={!!picked[id]}
                onToggle={() => setPicked((p) => ({ ...p, [id]: !p[id] }))}
                bump={bumps[id] ?? "patch"}
                onBump={(b) => setBumps((s) => ({ ...s, [id]: b }))}
                done={!!done[id]}
              />
            ))}
          </ul>

          <div className="mt-6 space-y-3 rounded-2xl border p-4">
            <label className="block text-sm font-semibold" htmlFor="batch-description">
              Descrição (vale para todas)
            </label>
            <textarea
              id="batch-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="Ex.: Atualiza a documentação de autenticação"
              className="w-full resize-none rounded-xl border bg-background/60 px-3 py-2 text-sm outline-none focus:border-brand/50 focus:ring-4 focus:ring-brand/10"
            />
            <div className="flex justify-end">
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
