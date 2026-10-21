import { Check } from "lucide-react";

import type { MergeChoice, MergeConflict } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Props {
  conflicts: MergeConflict[];
  choices: (MergeChoice | null)[];
  onChange: (index: number, choice: MergeChoice) => void;
  /** versão x.y.z em que a proposta se baseou e versão atual da página */
  baseSemver: string;
  currentSemver: string;
}

const OPTIONS: { value: MergeChoice; label: string; hint: string }[] = [
  { value: "ours", label: "Manter a página", hint: "Descarta o trecho da proposta" },
  { value: "theirs", label: "Usar a proposta", hint: "Substitui o trecho da página" },
  { value: "both", label: "Manter os dois", hint: "A página, depois a proposta" },
];

/** Bloco de texto de um lado do conflito (vazio = o trecho foi removido). */
function Snippet({ text, tone }: { text: string; tone: "ours" | "theirs" | "context" | "base" }) {
  return (
    <pre
      className={cn(
        "whitespace-pre-wrap break-words rounded-lg px-3 py-2 font-mono text-[12.5px] leading-relaxed",
        tone === "context" && "text-muted-foreground",
        tone === "base" && "bg-muted/60 text-muted-foreground",
        tone === "ours" && "bg-sky-500/10",
        tone === "theirs" && "bg-emerald-500/10",
      )}
    >
      {text === "" ? <span className="italic text-muted-foreground">(trecho removido)</span> : text.replace(/\n$/, "")}
    </pre>
  );
}

/** Um conflito de cada vez: mostra o contexto, os dois lados e as três opções de resolução. */
export function MergeConflicts({ conflicts, choices, onChange, baseSemver, currentSemver }: Props) {
  const resolved = choices.filter(Boolean).length;
  return (
    <section aria-label="Conflitos a resolver" className="rounded-3xl border border-amber-500/40 bg-card">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-5 py-3.5">
        <h2 className="font-display text-lg font-semibold tracking-tight">Resolver conflitos</h2>
        <span className="text-sm text-muted-foreground">
          {resolved} de {conflicts.length} resolvidos
        </span>
      </header>
      <ol className="divide-y">
        {conflicts.map((c, i) => {
          const choice = choices[i];
          return (
            <li key={c.index} className="space-y-3 px-5 py-4">
              <p className="text-sm font-semibold">
                Conflito {i + 1}
                {choice && <Check className="ml-1.5 inline h-4 w-4 text-emerald-600" aria-label="resolvido" />}
              </p>
              {c.before && <Snippet text={c.before} tone="context" />}
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-sky-700 dark:text-sky-300">Na página ({currentSemver})</p>
                  <Snippet text={c.ours} tone="ours" />
                </div>
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">Na proposta</p>
                  <Snippet text={c.theirs} tone="theirs" />
                </div>
              </div>
              {c.after && <Snippet text={c.after} tone="context" />}
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer select-none">Como era na {baseSemver}</summary>
                <div className="mt-1.5">
                  <Snippet text={c.base} tone="base" />
                </div>
              </details>
              <div role="radiogroup" aria-label={`Escolha para o conflito ${i + 1}`} className="grid gap-2 sm:grid-cols-3">
                {OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={choice === o.value}
                    onClick={() => onChange(i, o.value)}
                    className={cn(
                      "rounded-2xl border px-3.5 py-2.5 text-left transition-colors",
                      choice === o.value ? "border-foreground bg-muted" : "hover:border-foreground/30 hover:bg-muted/50",
                    )}
                  >
                    <span className="block text-sm font-semibold">{o.label}</span>
                    <span className="block text-xs text-muted-foreground">{o.hint}</span>
                  </button>
                ))}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
