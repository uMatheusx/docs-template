import type { Element, ElementContent } from "hast";
import { AlertOctagon, AlertTriangle, Info, Lightbulb, Sparkles, Terminal, WrapText } from "lucide-react";
import { lazy, memo, Suspense, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypeHighlight from "rehype-highlight";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";

import { CopyButton } from "@/components/markdown/copy-button";
import { LinkPreview } from "@/components/markdown/link-preview";
import { Mermaid } from "@/components/markdown/mermaid";
import { remarkAlerts, type AlertType } from "@/components/markdown/remark-alerts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Hint } from "@/components/ui/tooltip";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { cn } from "@/lib/utils";

// referência de API incorporada (```openapi / ```asyncapi): carregada só quando aparece
const ApiEmbed = lazy(() => import("@/components/api/api-embed"));

const CALLOUTS: Record<AlertType, { label: string; icon: typeof Info; tone: string }> = {
  note: { label: "Nota", icon: Info, tone: "[--c:220_100%_45%] dark:[--c:220_90%_66%]" },
  tip: { label: "Dica", icon: Lightbulb, tone: "[--c:152_70%_34%] dark:[--c:152_60%_52%]" },
  important: { label: "Importante", icon: Sparkles, tone: "[--c:28_100%_44%] dark:[--c:30_100%_56%]" },
  warning: { label: "Atenção", icon: AlertTriangle, tone: "[--c:40_100%_38%] dark:[--c:44_100%_55%]" },
  caution: { label: "Cuidado", icon: AlertOctagon, tone: "[--c:356_72%_48%] dark:[--c:356_80%_64%]" },
};

const LANG_LABELS: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TSX",
  js: "JavaScript",
  py: "Python",
  python: "Python",
  bash: "Terminal",
  sh: "Terminal",
  shell: "Terminal",
  json: "JSON",
  yaml: "YAML",
  yml: "YAML",
  sql: "SQL",
  http: "HTTP",
};

function textOf(node: ElementContent | Element): string {
  if (node.type === "text") return node.value;
  if ("children" in node) return node.children.map(textOf).join("");
  return "";
}

function classes(node?: Element): string[] {
  const value = node?.properties?.className;
  return Array.isArray(value) ? value.map(String) : [];
}

function ZoomableImage({ src, alt }: { src?: string; alt: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="block w-full cursor-zoom-in" aria-label={`Ampliar ${alt}`}>
        <img src={src} alt={alt} loading="lazy" decoding="async" className="mx-auto rounded-2xl border border-border/60" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[min(1200px,95vw)] border-0 bg-transparent p-0 shadow-none">
          <DialogTitle className="sr-only">{alt || "Imagem"}</DialogTitle>
          <DialogDescription className="sr-only">Imagem ampliada</DialogDescription>
          <img src={src} alt={alt} className="max-h-[85vh] w-full rounded-2xl object-contain" />
          {alt && <p className="text-center text-sm font-medium text-white/90">{alt}</p>}
        </DialogContent>
      </Dialog>
    </>
  );
}

function CodeBlock({ lang, raw, children }: { lang?: string; raw: string; children: ReactNode }) {
  // linhas longas quebram por padrão (sem rolagem horizontal); a preferência fica salva
  const [wrap, setWrap] = usePersistedState("ah-code-wrap", true);
  const lines = raw.split("\n").length;
  return (
    <div className="not-prose group relative my-7 overflow-hidden rounded-2xl border border-[hsl(var(--code-border))]/60 bg-[hsl(var(--code-bg))]">
      <div className="flex h-11 items-center gap-3 px-4 pt-1">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <Terminal className="h-3 w-3" /> {(lang && LANG_LABELS[lang]) ?? lang ?? "texto"}
        </span>
        <span className="ml-auto text-[11px] text-muted-foreground/70">{lines} linhas</span>
        <Hint label={wrap ? "Não quebrar linhas" : "Quebrar linhas"}>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-pressed={wrap}
            aria-label="Quebrar linhas longas"
            onClick={() => setWrap(!wrap)}
            className={cn("hover:bg-foreground/10 hover:text-foreground print:hidden", wrap ? "text-brand-ink" : "text-muted-foreground")}
          >
            <WrapText />
          </Button>
        </Hint>
        <CopyButton text={raw} className="text-muted-foreground hover:bg-foreground/10 hover:text-foreground print:hidden" />
      </div>
      <pre
        className={cn(
          "p-5 font-mono text-[13px] leading-[1.7]",
          wrap ? "whitespace-pre-wrap [overflow-wrap:anywhere]" : "overflow-x-auto",
        )}
      >
        {children}
      </pre>
    </div>
  );
}

const components: Components = {
  pre({ node, children }) {
    const code = node?.children.find((c): c is Element => c.type === "element" && c.tagName === "code");
    const lang = classes(code).find((c) => c.startsWith("language-"))?.slice(9);
    const raw = code ? textOf(code).replace(/\n$/, "") : "";
    if (lang === "mermaid") return <Mermaid chart={raw} />;
    if (lang === "openapi" || lang === "asyncapi") {
      return (
        <Suspense fallback={<Skeleton className="not-prose my-8 h-48 rounded-3xl" />}>
          <ApiEmbed kind={lang} code={raw} />
        </Suspense>
      );
    }
    return (
      <CodeBlock lang={lang} raw={raw}>
        {children}
      </CodeBlock>
    );
  },
  a({ href = "", children, node: _node, ...props }) {
    if (href.startsWith("/") && !href.startsWith("/api/")) return <LinkPreview href={href}>{children}</LinkPreview>;
    const external = /^https?:\/\//.test(href);
    return (
      <a href={href} {...props} {...(external && { target: "_blank", rel: "noreferrer noopener" })}>
        {children}
      </a>
    );
  },
  aside({ node, children }) {
    const type = classes(node).find((c) => c.startsWith("callout-"))?.slice(8) as AlertType | undefined;
    const callout = type && CALLOUTS[type];
    if (!callout) return <aside>{children}</aside>;
    const Icon = callout.icon;
    return (
      <div
        className={cn(
          "callout not-prose relative my-7 flex gap-3.5 overflow-hidden rounded-2xl bg-[hsl(var(--c)/0.07)] p-5",
          callout.tone,
        )}
      >
        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center text-[hsl(var(--c))]">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 text-[15px] leading-relaxed text-foreground/85 [&_a]:font-semibold [&_a]:text-brand-ink [&_code]:rounded [&_code]:bg-background/70 [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.85em] [&_p+p]:mt-2">
          <p className="mb-0.5 text-sm font-bold text-[hsl(var(--c))]">{callout.label}</p>
          {children}
        </div>
      </div>
    );
  },
  table({ node: _node, ...props }) {
    return (
      <div className="not-prose my-7 overflow-x-auto rounded-2xl border border-border/60 [&_td]:border-t [&_td]:border-border/60 [&_td]:px-4 [&_td]:py-3 [&_th]:bg-muted/40 [&_th]:px-4 [&_th]:py-3 [&_th]:text-left [&_th]:text-xs [&_th]:font-semibold [&_th]:text-muted-foreground [&_code]:rounded-md [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.82em] [&_code]:font-medium">
        <table className="w-full text-sm" {...props} />
      </div>
    );
  },
  img({ alt, src }) {
    return <ZoomableImage src={typeof src === "string" ? src : undefined} alt={alt ?? ""} />;
  },
};

export const Markdown = memo(function Markdown({ content, className }: { content: string; className?: string }) {
  return (
    <div className={cn("doc-prose", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkAlerts]}
        remarkRehypeOptions={{ footnoteLabel: "Notas de rodapé", footnoteBackLabel: "Voltar ao texto" }}
        rehypePlugins={[
          rehypeSlug,
          [
            rehypeAutolinkHeadings,
            {
              behavior: "append",
              properties: { className: ["heading-anchor"], ariaHidden: true, tabIndex: -1 },
              content: { type: "text", value: "#" },
            },
          ],
          [rehypeHighlight, { detect: false, plainText: ["mermaid", "openapi", "asyncapi", "text", "txt"] }],
        ]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
