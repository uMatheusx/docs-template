import { Check, GitCompareArrows } from "lucide-react";

import type { DiffHunk } from "@/lib/diff";
import { cn } from "@/lib/utils";

/** Diff linha a linha com números de linha (antes / depois). */
export function DiffView({ hunks, empty, notice, legend }: { hunks: DiffHunk[]; empty: string; notice?: string; legend: string }) {
  const changed = hunks.some((h) => h.type === "add" || h.type === "del");
  if (!changed) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-10 text-center text-sm text-muted-foreground">
        <Check className="h-6 w-6 text-emerald-500" />
        {empty}
      </div>
    );
  }
  return (
    <div className="pb-6">
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background/90 px-5 py-2 text-[11px] font-semibold text-muted-foreground backdrop-blur">
        <GitCompareArrows className="h-3.5 w-3.5 text-brand" /> {legend}
        {notice && <span className="ml-2 rounded-full bg-muted px-2 py-0.5">{notice}</span>}
      </div>
      <div className="font-mono text-[12.5px] leading-6">
        {hunks.map((h, i) =>
          h.type === "skip" ? (
            <div
              key={i}
              className="my-1 flex items-center gap-2 bg-muted/50 py-1 pl-[104px] font-sans text-[11px] font-semibold text-muted-foreground"
            >
              ⋯ {h.count} {h.count === 1 ? "linha igual" : "linhas iguais"}
            </div>
          ) : (
            <div
              key={i}
              className={cn(
                "flex",
                h.type === "add" && "bg-emerald-500/[0.09]",
                h.type === "del" && "bg-red-500/[0.09]",
              )}
            >
              <span className="w-11 shrink-0 select-none border-r pr-2 text-right text-[11px] text-muted-foreground/70">{h.oldNo ?? ""}</span>
              <span className="w-11 shrink-0 select-none border-r pr-2 text-right text-[11px] text-muted-foreground/70">{h.newNo ?? ""}</span>
              <span
                className={cn(
                  "w-6 shrink-0 select-none text-center font-bold",
                  h.type === "add" && "text-emerald-600 dark:text-emerald-400",
                  h.type === "del" && "text-red-600 dark:text-red-400",
                )}
              >
                {h.type === "add" ? "+" : h.type === "del" ? "−" : ""}
              </span>
              {/* linhas longas quebram (sem rolagem horizontal) */}
              <span
                className={cn(
                  "min-w-0 flex-1 whitespace-pre-wrap pr-6 [overflow-wrap:anywhere]",
                  h.type === "add" && "text-emerald-900 dark:text-emerald-100",
                  h.type === "del" && "text-red-900 dark:text-red-100",
                )}
              >
                {h.text || " "}
              </span>
            </div>
          ),
        )}
      </div>
    </div>
  );
}
