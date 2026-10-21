import { Server } from "lucide-react";

import type { Environment } from "@/components/api/spec";
import { CopyButton } from "@/components/markdown/copy-button";
import { cn } from "@/lib/utils";

interface EnvironmentsProps {
  environments: Environment[];
  /** quando presente, as linhas viram seletor do ambiente usado nos exemplos */
  selected?: Environment;
  onSelect?: (env: Environment) => void;
  className?: string;
}

/** Lista de ambientes com URL copiável. */
export function Environments({ environments, selected, onSelect, className }: EnvironmentsProps) {
  if (!environments.length) return null;
  return (
    <section className={cn("rounded-3xl border bg-card p-5", className)} aria-labelledby="ambientes">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="ambientes" className="flex items-center gap-2 font-display text-lg font-bold tracking-tight">
          <Server className="h-4 w-4 text-brand" /> Ambientes
        </h2>
        {onSelect && <p className="text-xs text-muted-foreground">Escolha o ambiente usado nos exemplos de código.</p>}
      </div>
      <ul className="grid gap-2">
        {environments.map((env) => {
          const active = selected?.id === env.id;
          const body = (
            <>
              <span className="flex min-w-0 flex-wrap items-center gap-2">
                {onSelect && (
                  <span
                    aria-hidden
                    className={cn(
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                      active ? "border-brand" : "border-muted-foreground/40",
                    )}
                  >
                    {active && <span className="h-1.5 w-1.5 rounded-full bg-brand" />}
                  </span>
                )}
                <span className="font-bold">{env.name}</span>
                {env.protocol && <span className="rounded bg-muted px-1.5 font-mono text-[10px] font-semibold text-muted-foreground">{env.protocol}</span>}
                {active && <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-bold text-brand-ink">nos exemplos</span>}
              </span>
              <code className="mt-1 block break-all font-mono text-[12.5px] text-foreground/90">{env.url}</code>
              {env.description && <span className="mt-0.5 block text-[12.5px] text-muted-foreground">{env.description}</span>}
            </>
          );
          return (
            <li
              key={env.id}
              className={cn(
                "flex items-start gap-2 rounded-2xl border px-3.5 py-2.5 text-sm transition-colors",
                active ? "border-brand/50 bg-brand/[0.06]" : "bg-background/50",
              )}
            >
              {onSelect ? (
                <button type="button" onClick={() => onSelect(env)} aria-pressed={active} className="min-w-0 flex-1 text-left">
                  {body}
                </button>
              ) : (
                <div className="min-w-0 flex-1">{body}</div>
              )}
              <CopyButton text={env.url} label={`Copiar URL de ${env.name}`} className="shrink-0 text-muted-foreground" />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
