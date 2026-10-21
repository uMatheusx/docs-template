import { ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";

import { CodePanel } from "@/components/api/code-panel";
import { codeSamples } from "@/components/api/code-samples";
import { Environments } from "@/components/api/environments";
import { SchemaView } from "@/components/api/schema-view";
import { useEnvironment } from "@/components/api/use-environment";
import {
  bodyMedia,
  filterOperations,
  groupByTag,
  isObj,
  listOperations,
  mediaExample,
  openApiEnvironments,
  pretty,
  slugify,
  str,
  usesBearer,
  type Environment,
  type Method,
  type Obj,
  type Operation,
  type ReferenceFilter,
} from "@/components/api/spec";
import { Markdown } from "@/components/markdown/markdown";
import { cn } from "@/lib/utils";

const METHOD_TONE: Record<Method, string> = {
  get: "bg-sky-500/12 text-sky-700 ring-sky-500/30 dark:text-sky-300",
  post: "bg-emerald-500/12 text-emerald-700 ring-emerald-500/30 dark:text-emerald-300",
  put: "bg-amber-500/12 text-amber-700 ring-amber-500/30 dark:text-amber-300",
  patch: "bg-violet-500/12 text-violet-700 ring-violet-500/30 dark:text-violet-300",
  delete: "bg-red-500/12 text-red-700 ring-red-500/30 dark:text-red-300",
  head: "bg-muted text-muted-foreground ring-border",
  options: "bg-muted text-muted-foreground ring-border",
};

export function MethodBadge({ method, className }: { method: Method; className?: string }) {
  return (
    <span className={cn("inline-flex min-w-[58px] justify-center rounded-lg px-2 py-0.5 font-mono text-[11px] font-bold uppercase ring-1", METHOD_TONE[method], className)}>
      {method}
    </span>
  );
}

function statusTone(code: string) {
  if (code.startsWith("2")) return "text-emerald-700 dark:text-emerald-300";
  if (code.startsWith("3")) return "text-sky-700 dark:text-sky-300";
  if (code.startsWith("4")) return "text-amber-700 dark:text-amber-300";
  if (code.startsWith("5")) return "text-red-700 dark:text-red-300";
  return "text-muted-foreground";
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h4 className="mb-2 text-xs font-semibold text-muted-foreground">{children}</h4>;
}

function Parameters({ spec, op }: { spec: Obj; op: Operation }) {
  if (!op.parameters.length) return null;
  return (
    <div>
      <SectionLabel>Parâmetros</SectionLabel>
      <ul className="divide-y rounded-xl border">
        {op.parameters.map((p) => (
          <li key={`${p.in}:${p.name}`} className="grid gap-x-4 gap-y-1 px-3 py-2.5 sm:grid-cols-[minmax(0,180px)_minmax(0,1fr)]">
            <div className="min-w-0">
              <code className="break-all font-mono text-[13px] font-semibold">{p.name}</code>
              {p.required && <span className="ml-1.5 text-brand">*</span>}
              <p className="text-[11px] font-semibold text-muted-foreground">{p.in}</p>
            </div>
            <div className="min-w-0">
              <SchemaView spec={spec} schema={p.schema ?? {}} className="border-0 bg-transparent p-0 px-0" />
              {p.description && <p className="mt-1 text-[13px] text-muted-foreground">{p.description}</p>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RequestBody({ spec, op }: { spec: Obj; op: Operation }) {
  const media = bodyMedia(op.requestBody);
  const [active, setActive] = useState(0);
  if (!media.length) return null;
  const current = media[Math.min(active, media.length - 1)];
  return (
    <div>
      <SectionLabel>
        Corpo da requisição {op.requestBody?.required === true && <span className="normal-case text-brand">· obrigatório</span>}
      </SectionLabel>
      {media.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {media.map((m, i) => (
            <button
              key={m.type}
              type="button"
              onClick={() => setActive(i)}
              className={cn("rounded-lg border px-2 py-0.5 font-mono text-[11px]", i === active ? "border-brand/50 bg-brand/10" : "text-muted-foreground")}
            >
              {m.type}
            </button>
          ))}
        </div>
      )}
      {str(op.requestBody?.description) && <p className="mb-2 text-[13px] text-muted-foreground">{str(op.requestBody?.description)}</p>}
      <div className="space-y-3">
        <SchemaView spec={spec} schema={current.media.schema} />
        <CodePanel tabs={[{ label: `Exemplo · ${current.type}`, code: pretty(mediaExample(spec, current.media)) }]} />
      </div>
    </div>
  );
}

function Responses({ spec, op }: { spec: Obj; op: Operation }) {
  const firstOk = op.responses.findIndex(([c]) => c.startsWith("2"));
  const [active, setActive] = useState(Math.max(firstOk, 0));
  if (!op.responses.length) return null;
  const [code, response] = op.responses[Math.min(active, op.responses.length - 1)];
  const media = bodyMedia(response)[0];
  return (
    <div>
      <SectionLabel>Respostas</SectionLabel>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {op.responses.map(([c], i) => (
          <button
            key={c}
            type="button"
            onClick={() => setActive(i)}
            className={cn(
              "rounded-lg border px-2.5 py-1 font-mono text-[12px] font-bold transition-colors",
              statusTone(c),
              i === active ? "border-current bg-current/5" : "border-border hover:border-current/40",
            )}
          >
            {c}
          </button>
        ))}
      </div>
      <p className="mb-3 text-[13px] text-muted-foreground">{str(response.description) ?? "Sem descrição."}</p>
      {media && (
        <div className="space-y-3">
          <SchemaView spec={spec} schema={media.media.schema} />
          <CodePanel tabs={[{ label: `${code} · ${media.type}`, code: pretty(mediaExample(spec, media.media)) }]} />
        </div>
      )}
    </div>
  );
}

function OperationCard({ spec, op, environment }: { spec: Obj; op: Operation; environment?: Environment }) {
  return (
    <article className="rounded-3xl border bg-card p-5 shadow-sm sm:p-6">
      <h3 id={op.anchor} data-toc={op.summary ?? `${op.method.toUpperCase()} ${op.path}`} className="scroll-mt-28 flex flex-wrap items-center gap-3">
        <MethodBadge method={op.method} />
        <code className="min-w-0 break-all font-mono text-[14px] font-semibold">{op.path}</code>
        {op.deprecated && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-700 dark:text-amber-300">obsoleta</span>}
        <span className="sr-only">{op.summary}</span>
      </h3>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {op.summary && <p className="font-display text-lg font-bold tracking-tight">{op.summary}</p>}
          {op.operationId && <p className="break-all font-mono text-[11px] text-muted-foreground">{op.operationId}</p>}
        </div>
        {usesBearer(spec, op) && (
          <span className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-brand" /> Bearer
          </span>
        )}
      </div>
      {op.description && <Markdown content={op.description} className="mt-3 text-[15px]" />}

      <div className="mt-5 space-y-6">
        <Parameters spec={spec} op={op} />
        <RequestBody spec={spec} op={op} />
        <Responses spec={spec} op={op} />
        <div>
          <SectionLabel>
            Exemplo de chamada{environment && <span className="normal-case tracking-normal text-brand-ink"> · {environment.name}</span>}
          </SectionLabel>
          <CodePanel tabs={codeSamples(spec, op, environment?.url ?? "")} />
        </div>
      </div>
    </article>
  );
}

/** Seletor compacto de ambiente (referência incorporada numa página). */
function EnvironmentSelect({ environments, selected, onSelect }: { environments: Environment[]; selected?: Environment; onSelect: (env: Environment) => void }) {
  if (environments.length < 2) return null;
  return (
    <label className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
      Ambiente
      <select
        value={selected?.id}
        onChange={(e) => {
          const env = environments.find((x) => x.id === e.target.value);
          if (env) onSelect(env);
        }}
        className="h-8 rounded-lg border bg-background px-2 text-xs font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
      >
        {environments.map((env) => (
          <option key={env.id} value={env.id}>
            {env.name}
          </option>
        ))}
      </select>
    </label>
  );
}

interface OpenApiReferenceProps {
  spec: Obj;
  filter?: ReferenceFilter;
  /** incorporada em página markdown: sem visão geral, índice e seções por tag */
  embedded?: boolean;
  /** link para a referência completa (referência incorporada) */
  sourceHref?: string;
}

export function OpenApiReference({ spec, filter, embedded = false, sourceHref }: OpenApiReferenceProps) {
  const allOps = useMemo(() => listOperations(spec), [spec]);
  const ops = useMemo(() => filterOperations(allOps, filter), [allOps, filter]);
  const groups = useMemo(() => groupByTag(spec, ops), [spec, ops]);
  const environments = useMemo(() => openApiEnvironments(spec), [spec]);
  const [environment, setEnvironment] = useEnvironment(environments);
  const info = isObj(spec.info) ? spec.info : {};

  if (embedded) {
    return (
      <div className="not-prose space-y-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border bg-muted/40 px-4 py-2.5">
          <span className="min-w-0 text-sm font-semibold">
            <span className="mr-2 rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-bold text-brand-ink">OpenAPI</span>
            {sourceHref ? (
              <a href={sourceHref} className="hover:text-brand-ink hover:underline">
                {str(info.title) ?? "Referência da API"}
              </a>
            ) : (
              (str(info.title) ?? "Referência da API")
            )}
          </span>
          <span className="ml-auto">
            <EnvironmentSelect environments={environments} selected={environment} onSelect={setEnvironment} />
          </span>
        </div>
        {ops.length === 0 && (
          <p className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
            Nenhuma operação corresponde ao filtro. Use “MÉTODO /caminho” (ex.: <code>POST /accounts</code>), o operationId ou uma tag.
          </p>
        )}
        {ops.map((op) => (
          <OperationCard key={op.anchor} spec={spec} op={op} environment={environment} />
        ))}
      </div>
    );
  }

  return (
    <div className="not-prose space-y-10">
      <section className="space-y-3">
        <div className="flex flex-wrap gap-2 text-xs font-semibold">
          <span className="rounded-full bg-brand/10 px-2.5 py-1 text-brand-ink">OpenAPI {String(spec.openapi ?? spec.swagger ?? "")}</span>
          {info.version !== undefined && <span className="rounded-full border px-2.5 py-1 text-muted-foreground">versão {String(info.version)}</span>}
          <span className="rounded-full border px-2.5 py-1 text-muted-foreground">{allOps.length} operações</span>
          {environments.length > 0 && (
            <span className="rounded-full border px-2.5 py-1 text-muted-foreground">
              {environments.length} {environments.length === 1 ? "ambiente" : "ambientes"}
            </span>
          )}
        </div>
        {str(info.description) && <Markdown content={str(info.description)!} className="text-[15px]" />}
      </section>

      <Environments environments={environments} selected={environment} onSelect={setEnvironment} />

      <nav aria-label="Operações" className="rounded-3xl border bg-card/60 p-5">
        <p className="mb-3 text-xs font-semibold text-muted-foreground">Índice de operações</p>
        <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
          {ops.map((op) => (
            <a key={op.anchor} href={`#${op.anchor}`} className="group flex min-w-0 items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-accent">
              <MethodBadge method={op.method} className="min-w-[54px] text-[10px]" />
              <span className="truncate text-[13px] font-medium group-hover:text-foreground">{op.summary ?? op.path}</span>
            </a>
          ))}
        </div>
      </nav>

      {groups.map((group) => (
        <section key={group.tag} className="space-y-5">
          <div>
            <h2 id={`tag-${slugify(group.tag)}`} className="scroll-mt-28 font-display text-[1.6rem] font-bold tracking-tight">
              {group.tag}
            </h2>
            {group.description && <p className="mt-1 text-muted-foreground">{group.description}</p>}
          </div>
          {group.ops.map((op) => (
            <OperationCard key={op.anchor} spec={spec} op={op} environment={environment} />
          ))}
        </section>
      ))}
    </div>
  );
}
