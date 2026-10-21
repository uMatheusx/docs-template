import { AlertTriangle } from "lucide-react";
import { useMemo } from "react";

import { AsyncApiReference } from "@/components/api/asyncapi-view";
import { OpenApiReference } from "@/components/api/openapi-view";
import { parseSpec, type ReferenceFilter } from "@/components/api/spec";
import type { PageKind } from "@/lib/api";

interface ApiReferenceProps {
  kind: Exclude<PageKind, "doc">;
  content: string;
  /** recorte (operações/tags na OpenAPI, canais na AsyncAPI) — usado nas referências incorporadas */
  filter?: ReferenceFilter & { channels?: string[] };
  embedded?: boolean;
  sourceHref?: string;
}

/** Referência gerada a partir de uma especificação OpenAPI ou AsyncAPI. */
export function ApiReference({ kind, content, filter, embedded, sourceHref }: ApiReferenceProps) {
  const { spec, error } = useMemo(() => parseSpec(content), [content]);
  if (!spec) {
    return (
      <div className="not-prose rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-sm">
        <p className="flex items-center gap-2 font-semibold text-destructive">
          <AlertTriangle className="h-4 w-4" /> Não foi possível ler a especificação
        </p>
        <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground">{error}</pre>
      </div>
    );
  }
  return kind === "openapi" ? (
    <OpenApiReference spec={spec} filter={filter} embedded={embedded} sourceHref={sourceHref} />
  ) : (
    <AsyncApiReference spec={spec} channels={filter?.channels} embedded={embedded} sourceHref={sourceHref} />
  );
}
