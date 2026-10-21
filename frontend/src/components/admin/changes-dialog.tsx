import { FileDiff, RotateCcw, Undo2 } from "lucide-react";
import { useMemo, useState } from "react";

import { DiffView } from "@/components/admin/diff-view";
import type { Draft } from "@/components/admin/inspector";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { collapseDiff, diffLines, diffStats } from "@/lib/diff";
import { cn } from "@/lib/utils";

/** Um ponto de comparação: a versão publicada, o último "Salvar" ou a proposta carregada. */
export interface Reference {
  /** nome curto do botão de comparação */
  label: string;
  /** frase usada no cabeçalho do diff */
  legend: string;
  draft: Draft;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** o que está no editor agora */
  current: Draft;
  published: Reference;
  /** o que já foi guardado (último Salvar ou proposta carregada); null se nada foi */
  saved: Reference | null;
  onRestoreSaved: () => void;
  onDiscard: () => void;
}

const FIELD_LABEL: Record<Exclude<keyof Draft, "content">, string> = {
  title: "Título",
  slug: "Endereço",
  icon: "Ícone",
  description: "Descrição",
  published: "Publicação",
};

const show = (key: keyof Draft, value: Draft[keyof Draft]) =>
  key === "published" ? (value ? "Publicada" : "Rascunho") : typeof value === "string" && value ? value : "(vazio)";

export function ChangesDialog({ open, onOpenChange, ...rest }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] max-w-[min(980px,96vw)] flex-col gap-0 overflow-hidden p-0">
        {open && <ChangesBody {...rest} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function ChangesBody({ current, published, saved, onRestoreSaved, onDiscard, onClose }: Omit<Props, "open" | "onOpenChange"> & { onClose: () => void }) {
  // a versão publicada é "a última versão"; com algo já guardado, dá para ver só o que veio depois do Salvar
  const [compare, setCompare] = useState<"published" | "saved">("published");
  const reference = compare === "saved" && saved ? saved : published;

  const { hunks, stats } = useMemo(() => {
    const ops = diffLines(reference.draft.content, current.content);
    return { hunks: collapseDiff(ops), stats: diffStats(ops) };
  }, [reference, current.content]);

  const fieldChanges = (Object.keys(FIELD_LABEL) as (keyof typeof FIELD_LABEL)[]).filter((k) => reference.draft[k] !== current[k]);
  const differsFromSaved = saved !== null && JSON.stringify(saved.draft) !== JSON.stringify(current);
  const differsFromPublished = JSON.stringify(published.draft) !== JSON.stringify(current);

  return (
    <>
      <DialogHeader className="space-y-3 border-b px-6 pb-4 pt-6 pr-12">
        <DialogTitle className="flex items-center gap-2">
          <FileDiff className="h-5 w-5 text-brand" /> Alterações no editor
        </DialogTitle>
        <DialogDescription>
          {reference.legend}. Nada daqui foi enviado: isto é só o que está no seu editor.
        </DialogDescription>
        {saved && (
          <div role="radiogroup" aria-label="Comparar com" className="flex w-fit rounded-xl bg-muted p-1 text-sm">
            {(
              [
                ["published", published.label],
                ["saved", saved.label],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={compare === value}
                onClick={() => setCompare(value)}
                className={cn(
                  "rounded-lg px-3 py-1.5 font-medium transition-colors",
                  compare === value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full bg-emerald-500/12 px-2.5 py-1 font-bold text-emerald-700 dark:text-emerald-300">+{stats.added}</span>
          <span className="rounded-full bg-red-500/12 px-2.5 py-1 font-bold text-red-700 dark:text-red-300">−{stats.removed}</span>
          {fieldChanges.map((k) => (
            <span key={k} className="rounded-full border px-2.5 py-1 font-semibold">
              {FIELD_LABEL[k]}: <span className="text-muted-foreground">{show(k, reference.draft[k])} → {show(k, current[k])}</span>
            </span>
          ))}
        </div>
      </DialogHeader>

      <div className="min-h-0 flex-1 overflow-auto">
        <DiffView
          hunks={hunks}
          empty={`Nenhuma alteração no texto em relação a: ${reference.label.toLowerCase()}.`}
          legend={`${reference.label} → editor`}
        />
      </div>

      <footer className="flex flex-wrap items-center justify-end gap-2 border-t px-6 py-3">
        {saved && differsFromSaved && (
          <Button variant="outline" onClick={onRestoreSaved}>
            <RotateCcw /> Restaurar {saved.label.toLowerCase().startsWith("proposta") ? saved.label.toLowerCase() : "o último salvo"}…
          </Button>
        )}
        {differsFromPublished && (
          <Button variant="outline" onClick={onDiscard}>
            <Undo2 /> Descartar tudo…
          </Button>
        )}
        <Button onClick={onClose}>Fechar</Button>
      </footer>
    </>
  );
}
