import { ArrowUpRight, Clock, Loader2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import useSWR from "swr";

import { PageIcon } from "@/components/page-icon";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { keys, type Page } from "@/lib/api";
import { readingTime, splitLeadingH1 } from "@/lib/utils";

function excerpt(markdown: string): string {
  return splitLeadingH1(markdown)
    .body.replace(/```[\s\S]*?```/g, " ")
    .replace(/^>\s*\[!\w+\]/gm, "")
    .replace(/[#>*_`|[\]()-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

/** Link interno com prévia da página ao passar o mouse. */
export function LinkPreview({ href, children }: { href: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const internal = href.startsWith("/docs/") && !href.startsWith("/docs/v/");
  const path = internal ? href.replace(/^\/docs\/?/, "").split("#")[0] : "";
  const target = href;
  const key = !open || !path ? null : keys.pageByPath(path);
  const { data: page, error } = useSWR<Page>(key);

  if (!internal || !path) return <Link to={href}>{children}</Link>;

  return (
    <HoverCard openDelay={250} closeDelay={80} open={open} onOpenChange={setOpen}>
      <HoverCardTrigger asChild>
        <Link to={target}>{children}</Link>
      </HoverCardTrigger>
      <HoverCardContent className="not-prose">
        {error ? (
          <p className="text-sm text-muted-foreground">Página não encontrada.</p>
        ) : !page ? (
          <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
        ) : (
          <Link
            to={target}
            onClick={() => {
              setOpen(false);
              window.scrollTo({ top: 0 });
            }}
            className="group -m-1 block space-y-2.5 rounded-xl p-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="flex items-center gap-3">
              <span className="brand-tile flex h-9 w-9 items-center justify-center rounded-lg">
                <PageIcon name={page.icon} className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="truncate font-display font-bold">{page.title}</p>
                <p className="truncate text-xs text-muted-foreground">/{page.path}</p>
              </div>
            </div>
            <p className="line-clamp-3 text-sm leading-relaxed text-muted-foreground">
              {page.description || (page.kind === "doc" ? excerpt(page.content) : "Referência de API")}
            </p>
            <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
              <span className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" /> {readingTime(page.content)} min de leitura
              </span>
              <span className="flex items-center gap-0.5 font-semibold text-brand-ink group-hover:underline">
                Abrir <ArrowUpRight className="h-3.5 w-3.5" />
              </span>
            </div>
          </Link>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}
