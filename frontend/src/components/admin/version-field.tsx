import { isGreater } from "@/lib/semver";
import { cn } from "@/lib/utils";

interface Props {
  /** versão que a página tem agora: a nova precisa ser maior */
  current: string;
  /** a que o sistema recomenda pelo tamanho da mudança */
  recommended: string;
  value: string;
  onChange: (value: string) => void;
  idPrefix?: string;
}

const PARTS = [
  { label: "Principal (x)", hint: "x" },
  { label: "Secundário (y)", hint: "y" },
  { label: "Correção (z)", hint: "z" },
] as const;

/** Edita a versão número a número (x.y.z). O padrão é a recomendada; qualquer número pode ser trocado. */
export function VersionField({ current, recommended, value, onChange, idPrefix = "version" }: Props) {
  const parts = value.split(".").map((p) => Number(p) || 0);
  const valid = isGreater(value, current);

  const setPart = (index: number, raw: string) => {
    const next = [...parts];
    next[index] = Math.max(0, Math.floor(Number(raw) || 0));
    onChange(next.join("."));
  };

  return (
    <div className="space-y-1.5">
      <div role="group" aria-label="Versão resultante" className="flex items-center gap-1.5">
        {PARTS.map((part, i) => (
          <span key={part.hint} className="flex items-center gap-1.5">
            {i > 0 && <span aria-hidden className="font-mono text-lg text-muted-foreground">.</span>}
            <input
              id={`${idPrefix}-${part.hint}`}
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              aria-label={part.label}
              value={parts[i] ?? 0}
              onChange={(e) => setPart(i, e.target.value)}
              className={cn(
                "h-10 w-[4.5rem] rounded-lg border bg-background px-2 text-center font-mono text-base font-semibold tabular-nums",
                "focus-visible:border-brand/70 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand/15",
                !valid && "border-destructive/60",
              )}
            />
          </span>
        ))}
        {value !== recommended && (
          <button
            type="button"
            onClick={() => onChange(recommended)}
            className="ml-2 text-xs font-medium text-brand-ink underline-offset-4 hover:underline"
          >
            Usar a recomendada ({recommended})
          </button>
        )}
      </div>
      {valid ? (
        <p className="text-xs text-muted-foreground">
          {value === recommended ? "Recomendada para o tamanho da mudança." : `Escolhida por você. A recomendada seria ${recommended}.`}
        </p>
      ) : (
        <p role="alert" className="text-xs font-medium text-destructive">
          Precisa ser maior que a versão atual ({current}).
        </p>
      )}
    </div>
  );
}
