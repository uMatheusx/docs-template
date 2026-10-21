import { useState } from "react";

import { CopyButton } from "@/components/markdown/copy-button";
import { cn } from "@/lib/utils";

/** Painel de código com abas (mesmo visual dos blocos de código da documentação). */
export function CodePanel({ tabs, className }: { tabs: { label: string; code: string }[]; className?: string }) {
  const [active, setActive] = useState(0);
  const current = tabs[Math.min(active, tabs.length - 1)];
  if (!current) return null;
  return (
    <div className={cn("overflow-hidden rounded-2xl border border-[hsl(var(--code-border))] bg-[hsl(var(--code-bg))]", className)}>
      <div className="flex h-10 items-center gap-1 border-b border-[hsl(var(--code-border))] bg-[hsl(var(--code-header))] px-2">
        {tabs.map((tab, i) => (
          <button
            key={tab.label}
            type="button"
            onClick={() => setActive(i)}
            className={cn(
              "rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors",
              i === active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </button>
        ))}
        <CopyButton text={current.code} className="ml-auto text-muted-foreground hover:bg-foreground/10 hover:text-foreground" />
      </div>
      {/* quebra linhas longas (URLs, JSON) em vez de rolar na horizontal */}
      <pre className="max-h-[420px] overflow-y-auto whitespace-pre-wrap p-4 font-mono text-[12.5px] leading-[1.7] text-[hsl(var(--hl-text))] [overflow-wrap:anywhere]">
        {current.code}
      </pre>
    </div>
  );
}
