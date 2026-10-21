import { AlertTriangle } from "lucide-react";
import { useMemo } from "react";
import useSWR from "swr";

import { ApiReference } from "@/components/api/api-reference";
import { arr, parseSpec, str } from "@/components/api/spec";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, fetchText, isAssetRef, keys, type Page } from "@/lib/api";
import { useDocsBase } from "@/lib/docs-base";

type SpecKind = "openapi" | "asyncapi";

interface EmbedConfig {
  /** caminho da página de especificação (ex.: /docs/referencia-api/api-rest) */
  ref?: string;
  /** especificação escrita direto no bloco */
  inline?: string;
  operations: string[];
  tags: string[];
  channels: string[];
  error?: string;
}

const list = (value: unknown) => (typeof value === "string" ? [value] : arr(value).map(String));

/**
 * Lê o conteúdo de um bloco ```openapi / ```asyncapi:
 * - `ref:` aponta para uma página de especificação (com `operations`, `tags` ou `channels` opcionais);
 * - sem `ref:`, o bloco é a própria especificação.
 */
function readConfig(code: string): EmbedConfig {
  const { spec, error } = parseSpec(code);
  const empty = { operations: [], tags: [], channels: [] };
  if (!spec) return { ...empty, error };
  if ("openapi" in spec || "asyncapi" in spec || "swagger" in spec) return { ...empty, inline: code };
  const ref = str(spec.ref);
  if (!ref) return { ...empty, error: "Informe `ref: /docs/caminho-da-especificacao` (ou o arquivo de Arquivos) ou cole a especificação no bloco." };
  return { ref, operations: list(spec.operations), tags: list(spec.tags), channels: list(spec.channels) };
}

function Problem({ children }: { children: React.ReactNode }) {
  return (
    <div className="not-prose my-6 flex items-start gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Especificação enviada como arquivo em Arquivos (`ref: /api/assets/…`). */
function AssetSpec({ kind, config }: { kind: SpecKind; config: EmbedConfig }) {
  const ref = config.ref ?? "";
  const { data: text, error, isLoading } = useSWR<string>(["asset-text", ref], () => fetchText(ref));
  const { spec } = useMemo(() => (text ? parseSpec(text) : { spec: undefined }), [text]);

  if (isLoading) return <Skeleton className="not-prose my-6 h-48 rounded-3xl" />;
  if (error || text === undefined) {
    const missing = error instanceof ApiError && error.status === 404;
    return (
      <Problem>
        {missing ? (
          <>
            O arquivo <code className="break-all">{ref}</code> não existe mais em Arquivos.
          </>
        ) : (
          <>Não foi possível carregar o arquivo: {(error as Error | undefined)?.message}</>
        )}
      </Problem>
    );
  }
  const actual = spec ? ("asyncapi" in spec ? "asyncapi" : "openapi" in spec || "swagger" in spec ? "openapi" : null) : null;
  if (actual !== kind) {
    return (
      <Problem>
        <code className="break-all">{ref}</code> não é uma especificação {kind === "openapi" ? "OpenAPI" : "AsyncAPI"}
        {actual ? ` (é ${actual === "openapi" ? "OpenAPI" : "AsyncAPI"}: troque o bloco para \`\`\`${actual})` : ""}.
      </Problem>
    );
  }
  return (
    <ApiReference
      kind={kind}
      content={text}
      embedded
      sourceHref={ref}
      filter={{ operations: config.operations, tags: config.tags, channels: config.channels }}
    />
  );
}

function ReferencedSpec({ kind, config }: { kind: SpecKind; config: EmbedConfig }) {
  if (isAssetRef(config.ref ?? "")) return <AssetSpec kind={kind} config={config} />;
  return <PageSpec kind={kind} config={config} />;
}

function PageSpec({ kind, config }: { kind: SpecKind; config: EmbedConfig }) {
  const { href } = useDocsBase();
  const path = (config.ref ?? "").replace(/^\/?docs\//, "").replace(/^\/+|\/+$/g, "");
  const { data: page, error, isLoading } = useSWR<Page>(keys.pageByPath(path));

  if (isLoading) return <Skeleton className="not-prose my-6 h-48 rounded-3xl" />;
  if (error || !page) {
    const missing = error instanceof ApiError && error.status === 404;
    return (
      <Problem>
        {missing ? (
          <>
            A especificação <code className="break-all">{config.ref}</code> não existe.
          </>
        ) : (
          <>Não foi possível carregar a especificação: {(error as Error | undefined)?.message}</>
        )}
      </Problem>
    );
  }
  if (page.kind !== kind) {
    return (
      <Problem>
        <code className="break-all">{config.ref}</code> não é uma página {kind === "openapi" ? "OpenAPI" : "AsyncAPI"}
        {page.kind === "doc" ? "" : ` (é ${page.kind === "openapi" ? "OpenAPI" : "AsyncAPI"}: troque o bloco para \`\`\`${page.kind})`}.
      </Problem>
    );
  }
  return (
    <ApiReference
      kind={kind}
      content={page.content}
      embedded
      sourceHref={href(page.path)}
      filter={{ operations: config.operations, tags: config.tags, channels: config.channels }}
    />
  );
}

/** Referência de API incorporada numa página markdown. */
export default function ApiEmbed({ kind, code }: { kind: SpecKind; code: string }) {
  const config = useMemo(() => readConfig(code), [code]);
  if (config.error) {
    return (
      <Problem>
        <p className="font-semibold">Bloco ```{kind} inválido</p>
        <p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">{config.error}</p>
      </Problem>
    );
  }
  return (
    <div className="my-8">
      {config.inline ? (
        <ApiReference kind={kind} content={config.inline} embedded />
      ) : (
        <ReferencedSpec kind={kind} config={config} />
      )}
    </div>
  );
}
