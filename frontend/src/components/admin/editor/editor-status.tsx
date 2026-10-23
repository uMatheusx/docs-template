import { Check, GitPullRequest, Loader2, Save } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import { Button } from "@/components/ui/button";
import { modKey } from "@/hooks/use-hotkey";
import { cn } from "@/lib/utils";

export function SaveState({
  saving,
  dirty,
  changed,
  version,
  persisted,
}: {
  saving: boolean;
  dirty: boolean;
  changed: number;
  version: string;
  /** o que já está guardado fora do editor: uma proposta carregada ou um "Salvar" local */
  persisted?: { kind: "proposal" | "local"; number?: number };
}) {
  const proposal = persisted?.kind === "proposal" ? persisted.number : undefined;
  const state = saving ? "saving" : dirty ? "dirty" : persisted?.kind === "local" ? "local" : proposal ? "proposal" : "saved";
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.span
        key={state}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.15 }}
        className={cn(
          "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold",
          state === "saved" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
          state === "dirty" && "bg-brand/10 text-brand-ink",
          state === "local" && "bg-sky-500/10 text-sky-700 dark:text-sky-300",
          state === "proposal" && "bg-violet-500/10 text-violet-700 dark:text-violet-300",
          state === "saving" && "bg-muted text-muted-foreground",
        )}
      >
        {state === "saving" && <Loader2 className="h-3 w-3 animate-spin" />}
        {state === "dirty" && <span aria-hidden className="font-mono text-[11px] font-bold leading-none">M</span>}
        {state === "saved" && <Check className="h-3 w-3" />}
        {state === "proposal" && <span aria-hidden className="font-mono text-[11px] font-bold leading-none">E</span>}
        {state === "local" && <span aria-hidden className="font-mono text-[11px] font-bold leading-none">S</span>}
        {state === "saving"
          ? "Salvando…"
          : state === "dirty"
            ? proposal
              ? `${changed} alteração(ões) além da proposta #${proposal}`
              : persisted?.kind === "local"
                ? `${changed} alteração(ões) além do que foi salvo`
                : `${changed} alteração(ões) não salva(s)`
            : state === "local"
              ? "Salvo neste navegador · não enviado"
              : state === "proposal"
                ? `Proposta #${proposal} carregada`
                : `Salvo · ${version}`}
      </motion.span>
    </AnimatePresence>
  );
}

/**
 * Salvar à esquerda, enviar à direita, igual em página publicada e em rascunho.
 * Publicada: Salvar guarda neste navegador. Rascunho: Salvar grava no servidor (só a última versão, sem histórico).
 * Em ambos o envio vai para a tela Alterações e só vale para o que já foi salvo.
 */
export function SaveButton({
  dirty,
  unsaved,
  saving,
  onSave,
  reviewOnly,
  onReview,
}: {
  /** há diferença para a página */
  dirty: boolean;
  /** há diferença que ainda não foi guardada em lugar nenhum */
  unsaved: boolean;
  saving: boolean;
  onSave: (note?: string) => Promise<boolean>;
  reviewOnly: boolean;
  onReview: () => void;
}) {
  const sendLabel = reviewOnly ? "Enviar para revisão" : "Pedir publicação";
  return (
    <div className="flex items-center gap-2">
      <Button variant="secondary" onClick={() => onSave()} disabled={!unsaved || saving}>
        {saving && !reviewOnly ? <Loader2 className="animate-spin" /> : <Save />} Salvar
        <kbd className="ml-0.5 hidden lg:inline-flex">{modKey} S</kbd>
      </Button>
      <span title={unsaved ? `Salve antes de ${reviewOnly ? "enviar para revisão" : "pedir a publicação"}` : undefined}>
        <Button onClick={onReview} disabled={(reviewOnly && !dirty) || unsaved || saving}>
          <GitPullRequest /> {sendLabel}
        </Button>
      </span>
    </div>
  );
}
