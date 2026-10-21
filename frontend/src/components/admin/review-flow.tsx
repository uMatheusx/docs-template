import { ChevronDown, ChevronRight, GitPullRequest, Layers, Loader2, Save } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Hint } from "@/components/ui/tooltip";
import { modKey } from "@/hooks/use-hotkey";
import { cn } from "@/lib/utils";

interface Props {
  /** página publicada: Salvar guarda neste navegador; em rascunho, Salvar grava uma versão no servidor */
  reviewOnly: boolean;
  /** há diferença para a página */
  dirty: boolean;
  /** há diferença que ainda não foi guardada em lugar nenhum */
  unsaved: boolean;
  saving: boolean;
  onSave: (note?: string) => Promise<boolean>;
  /** envia só esta página para revisão */
  onReview: () => void;
  /** abre a tela de alterações para enviar várias páginas de uma vez */
  onSendMany: () => void;
}

/** Número do passo (1 → 2): deixa claro que salvar vem antes de enviar. */
function Step({ n, active }: { n: number; active: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[11px] font-bold leading-none",
        active ? "bg-background/25" : "bg-foreground/10",
      )}
    >
      {n}
    </span>
  );
}

function Tip({ label, children }: { label: string; children: ReactNode }) {
  return <Hint label={label}>{children}</Hint>;
}

/**
 * Os dois passos do fluxo, em sequência: 1 Salvar → 2 Enviar para revisão.
 * O botão do próximo passo certo fica em destaque; o outro fica apagado. Salvar não envia nada.
 */
export function ReviewFlow({ reviewOnly, dirty, unsaved, saving, onSave, onReview, onSendMany }: Props) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const saveWithNote = async () => {
    if (await onSave(note)) {
      setNote("");
      setNoteOpen(false);
    }
  };

  const canSave = reviewOnly ? unsaved && !saving : dirty && !saving;
  const canSend = (reviewOnly ? dirty : true) && !unsaved && !saving; // rascunho sem mudanças ainda pode pedir publicação
  const sendLabel = reviewOnly ? "Enviar para revisão" : "Pedir publicação";
  const saveActive = canSave; // o próximo passo é salvar
  const sendActive = canSend; // o próximo passo é enviar

  return (
    <div role="group" aria-label="Salvar e enviar para revisão" className="flex items-center gap-1 rounded-full border bg-muted/40 p-1">
      {/* passo 1 */}
      <div className="flex">
        <Tip label={reviewOnly ? "Guarda as alterações neste navegador. Nada é enviado." : "Grava uma nova versão da página."}>
          <span>
            <Button
              aria-label="Salvar"
              variant={saveActive ? "default" : "ghost"}
              size="sm"
              disabled={!canSave}
              onClick={() => onSave()}
              className={cn("h-8", !reviewOnly && "rounded-r-none")}
            >
              {saving && !reviewOnly ? <Loader2 className="animate-spin" /> : <Step n={1} active={saveActive} />}
              <Save className="hidden sm:block" />
              <span>Salvar</span>
              <kbd className={cn("ml-0.5 hidden lg:inline-flex", saveActive && "border-background/25 bg-background/15 text-background/80")}>{modKey} S</kbd>
            </Button>
          </span>
        </Tip>
        {!reviewOnly && (
          <Popover open={noteOpen} onOpenChange={setNoteOpen}>
            <Hint label="Salvar com descrição">
              <PopoverTrigger asChild>
                <Button
                  size="sm"
                  variant={saveActive ? "default" : "ghost"}
                  disabled={!canSave}
                  className="h-8 rounded-l-none border-l border-background/20 px-1.5"
                  aria-label="Salvar com descrição"
                >
                  <ChevronDown />
                </Button>
              </PopoverTrigger>
            </Hint>
            <PopoverContent align="end" className="w-80">
              <p className="text-sm font-bold">Salvar com descrição</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Aparece no histórico de versões, como uma mensagem de commit.</p>
              <textarea
                autoFocus
                value={note}
                maxLength={200}
                rows={3}
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    void saveWithNote();
                  }
                }}
                placeholder="Ex.: Atualiza o fluxo de autenticação com PKCE"
                className="mt-3 w-full resize-none rounded-xl border bg-background/60 px-3 py-2 text-sm outline-none focus:border-brand/50 focus:ring-4 focus:ring-brand/10"
              />
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground">
                  {note.length}/200 · {modKey}+Enter
                </span>
                <Button size="sm" onClick={() => void saveWithNote()} disabled={saving}>
                  {saving ? <Loader2 className="animate-spin" /> : <Save />} Salvar versão
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>

      <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground/60" />

      {/* passo 2 */}
      <div className="flex">
        <Tip
          label={
            unsaved
              ? reviewOnly
                ? "Salve antes de enviar para revisão"
                : "Salve antes de pedir a publicação"
              : "Cria uma proposta de revisão com o que você salvou"
          }
        >
          <span>
            <Button
              aria-label={sendLabel}
              size="sm"
              variant={sendActive ? "default" : "ghost"}
              disabled={!canSend}
              onClick={onReview}
              className="h-8 rounded-r-none"
            >
              {saving && reviewOnly ? <Loader2 className="animate-spin" /> : <Step n={2} active={sendActive} />}
              <GitPullRequest className="hidden sm:block" />
              <span>{sendLabel}</span>
            </Button>
          </span>
        </Tip>
        <DropdownMenu>
          <Hint label="Mais opções de envio">
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant={sendActive ? "default" : "ghost"}
                aria-label="Mais opções de envio"
                className="h-8 rounded-l-none border-l border-background/20 px-1.5"
              >
                <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
          </Hint>
          <DropdownMenuContent align="end" className="w-72">
            <DropdownMenuItem disabled={!canSend} onSelect={onReview} className="flex-col items-start gap-0.5">
              <span className="flex items-center gap-2 font-medium">
                <GitPullRequest /> Enviar só esta página
              </span>
              <span className="pl-6 text-xs text-muted-foreground">Uma proposta, só com esta página.</span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onSendMany} className="flex-col items-start gap-0.5">
              <span className="flex items-center gap-2 font-medium">
                <Layers /> Enviar várias páginas…
              </span>
              <span className="pl-6 text-xs text-muted-foreground">Escolha entre as páginas com alterações salvas e envie juntas.</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
