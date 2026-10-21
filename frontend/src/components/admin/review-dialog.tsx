import { GitPullRequest, Loader2 } from "lucide-react";
import { useState, type FormEvent } from "react";

import type { Draft } from "@/components/admin/inspector";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { Review } from "@/lib/api";
import { BUMP_OPTIONS, bumpSemver, isFirstRelease, type Bump } from "@/lib/semver";
import { cn } from "@/lib/utils";

export interface ReviewDraft {
  title: string;
  description: string;
  requestPublish: boolean;
  /** tamanho da mudança: define a próxima versão x.y.z quando a proposta for aplicada */
  bump: Bump;
}

const CHANGE_LABEL: Record<keyof Draft, string> = {
  title: "título",
  slug: "slug",
  icon: "ícone",
  description: "descrição",
  published: "publicação",
  content: "conteúdo",
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pageTitle: string;
  changed: (keyof Draft)[];
  /** proposta ativa do mesmo autor: enviar de novo a atualiza */
  existing?: Review;
  canRequestPublish: boolean;
  /** versão x.y.z que a página tem agora */
  currentSemver: string;
  saving: boolean;
  onSubmit: (draft: ReviewDraft) => Promise<boolean>;
}

export function ReviewDialog({ open, onOpenChange, ...rest }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>{open && <ReviewForm {...rest} onDone={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  );
}

function ReviewForm({ pageTitle, changed, existing, canRequestPublish, currentSemver, saving, onSubmit, onDone }: Omit<Props, "open" | "onOpenChange"> & { onDone: () => void }) {
  // em rascunho, o motivo de abrir uma proposta é publicar: já vem marcado
  const [requestPublish, setRequestPublish] = useState(existing ? !!existing.fields.published : canRequestPublish);
  const nothing = changed.length === 0 && !requestPublish;
  const [bump, setBump] = useState<Bump>(existing?.bump ?? "patch");
  // a primeira publicação de uma página ainda 0.x vira 1.0.0, qualquer que seja o tamanho da mudança
  const firstRelease = isFirstRelease(currentSemver, canRequestPublish && requestPublish);
  const nextSemver = bumpSemver(currentSemver, bump, canRequestPublish && requestPublish);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const ok = await onSubmit({
      title: String(form.get("title")).trim(),
      description: String(form.get("description") ?? "").trim(),
      requestPublish,
      bump,
    });
    if (ok) onDone();
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{existing ? `Atualizar a proposta #${existing.number}` : "Enviar para revisão"}</DialogTitle>
        <DialogDescription>
          A página não muda agora: a proposta precisa ser aprovada e aplicada por um administrador, que pode ser você. Tudo fica registrado em Revisões.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-wrap gap-1.5 text-xs">
        {changed.length === 0 ? (
          <span className="rounded-full bg-muted px-2.5 py-1 font-semibold text-muted-foreground">Nenhuma alteração no editor</span>
        ) : (
          changed.map((c) => (
            <span key={c} className="rounded-full bg-brand/10 px-2.5 py-1 font-semibold text-brand-ink">
              Altera {CHANGE_LABEL[c]}
            </span>
          ))
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor="rv-title">Resumo</Label>
        <Input id="rv-title" name="title" required maxLength={200} autoFocus defaultValue={existing?.title ?? `Atualiza ${pageTitle}`} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="rv-desc">O que mudou e por quê (obrigatório)</Label>
        <Textarea
          id="rv-desc"
          name="description"
          required
          maxLength={2000}
          rows={4}
          defaultValue={existing?.description ?? ""}
          placeholder="Contexto para quem vai revisar: o que motivou a mudança, links de referência…"
        />
      </div>
      <fieldset className="space-y-2" disabled={firstRelease}>
        <legend className="text-sm font-medium leading-none">Tamanho da mudança</legend>
        <div role="radiogroup" aria-label="Tamanho da mudança" className="grid gap-2 sm:grid-cols-3">
          {BUMP_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={bump === o.value}
              disabled={firstRelease}
              onClick={() => setBump(o.value)}
              className={cn(
                "rounded-2xl border px-3 py-2 text-left transition-colors disabled:opacity-50",
                bump === o.value ? "border-foreground bg-muted" : "hover:border-foreground/30 hover:bg-muted/50",
              )}
            >
              <span className="block text-sm font-semibold">{o.label}</span>
              <span className="block text-xs leading-snug text-muted-foreground">{o.hint}</span>
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {firstRelease ? "A primeira publicação da página é a versão " : "Quando aplicada, a página vai de "}
          {!firstRelease && <span className="font-mono font-semibold text-foreground">{currentSemver}</span>}
          {!firstRelease && " para "}
          <span className="font-mono font-semibold text-foreground">{nextSemver}</span>.
        </p>
      </fieldset>
      {canRequestPublish && (
        <label className="flex items-center justify-between gap-3 rounded-2xl border p-3 text-sm">
          <span>
            <span className="block font-bold">Pedir publicação</span>
            <span className="text-xs text-muted-foreground">Ao aplicar, a página sai de rascunho e fica visível para os leitores.</span>
          </span>
          <Switch checked={requestPublish} onCheckedChange={setRequestPublish} />
        </label>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" disabled={saving || nothing}>
          {saving ? <Loader2 className="animate-spin" /> : <GitPullRequest />} {existing ? "Atualizar proposta" : "Enviar proposta"}
        </Button>
      </DialogFooter>
    </form>
  );
}
