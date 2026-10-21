import { Hint } from "@/components/ui/tooltip";
import type { LocalSummary } from "@/lib/local-drafts";
import { pageStatuses, STATUS, type PageStatus } from "@/lib/page-status";
import { cn } from "@/lib/utils";

export function StatusLetter({ status, className }: { status: PageStatus; className?: string }) {
  const { letter, label, hint, className: tone } = STATUS[status];
  return (
    <Hint label={`${label}: ${hint}`}>
      <span
        role="img"
        aria-label={`${label}: ${hint}`}
        data-status={status}
        className={cn("inline-flex w-3.5 shrink-0 cursor-default select-none justify-center font-mono text-[11px] font-bold leading-none", tone, className)}
      >
        {letter}
      </span>
    </Hint>
  );
}

export function PageStatusLetters(props: { published: boolean; local?: LocalSummary; inReview?: boolean; className?: string }) {
  return (
    <span className={cn("flex shrink-0 items-center gap-0.5", props.className)}>
      {pageStatuses(props).map((status) => (
        <StatusLetter key={status} status={status} />
      ))}
    </span>
  );
}
