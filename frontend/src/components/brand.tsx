import { Link } from "react-router";

import { cn } from "@/lib/utils";

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("h-8 w-8 shrink-0", className)} aria-hidden>
      <defs>
        <linearGradient id="ah-logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FF9A1F" />
          <stop offset=".55" stopColor="#EC7000" />
          <stop offset="1" stopColor="#C75C00" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#ah-logo)" />
      <path d="M16 7.5l7.4 4.25v8.5L16 24.5l-7.4-4.25v-8.5z" fill="none" stroke="#071030" strokeWidth="2.2" strokeLinejoin="round" />
      <circle cx="16" cy="16" r="2.6" fill="#071030" />
    </svg>
  );
}

export function Brand({ to = "/docs", tag = "docs", compact }: { to?: string; tag?: string; compact?: boolean }) {
  return (
    <Link to={to} onClick={() => window.scrollTo({ top: 0 })} className="group flex items-center gap-2.5" aria-label="Account Hub">
      <Logo className="transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-105" />
      {!compact && (
        <span className="flex items-center gap-1.5 font-display text-[15px] font-semibold tracking-[-0.01em]">
          Account Hub
          <span className="hidden font-normal text-muted-foreground sm:inline">
            {tag}
          </span>
        </span>
      )}
    </Link>
  );
}
