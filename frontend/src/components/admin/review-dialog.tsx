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

export interface ReviewDraft {
  title: string;
  description: string;
  requestPublish: boolean;
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

function ReviewForm({ pageTitle, changed, existing, canRequestPublish, saving, onSubmit, onDone }: Omit<Props, "open" | "onOpenChange"> & { onDone: () => void }) {
  // em rascunho, o motivo de abrir uma proposta é publicar: já vem marcado
  const [requestPublish, setRequestPublish] = useState(existing ? !!existing.fields.published : canRequestPublish);
  const nothing = changed.length === 0 && !requestPublish;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const ok = await onSubmit({
      title: String(form.get("title")).trim(),
      description: String(form.get("description") ?? "").trim(),
      requestPublish,
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
