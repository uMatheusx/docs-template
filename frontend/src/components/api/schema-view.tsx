import { ChevronRight } from "lucide-react";
import { useState } from "react";

import { deref, isObj, refName, type Obj } from "@/components/api/spec";
import { cn } from "@/lib/utils";

function typeLabel(spec: Obj, raw: unknown): string {
  const schema = deref(spec, raw);
  if (!isObj(schema)) return "qualquer";
  const name = refName(raw);
  if (Array.isArray(schema.allOf)) return name ?? "allOf";
  if (Array.isArray(schema.oneOf)) return name ? `${name} (um de)` : "um de";
  if (Array.isArray(schema.anyOf)) return name ? `${name} (qualquer de)` : "qualquer de";
  const type = Array.isArray(schema.type) ? schema.type.join(" | ") : (schema.type as string | undefined);
  if (type === "array" || schema.items) return `${typeLabel(spec, schema.items)}[]`;
  const base = name ?? type ?? (isObj(schema.properties) ? "object" : "qualquer");
  return schema.format ? `${base} · ${schema.format}` : base;
}

function children(spec: Obj, raw: unknown): { name: string; schema: unknown; required: boolean }[] | null {
  const schema = deref(spec, raw);
  if (!isObj(schema)) return null;
  if (schema.type === "array" || schema.items) return children(spec, schema.items);
  if (Array.isArray(schema.allOf)) {
    return schema.allOf.flatMap((part) => children(spec, part) ?? []);
  }
  for (const key of ["oneOf", "anyOf"] as const) {
    if (Array.isArray(schema[key])) {
      return schema[key].map((part, i) => ({ name: refName(part) ?? `opção ${i + 1}`, schema: part, required: false }));
    }
  }
  if (!isObj(schema.properties)) return null;
  const required = new Set(Array.isArray(schema.required) ? schema.required.map(String) : []);
  return Object.entries(schema.properties).map(([name, value]) => ({ name, schema: value, required: required.has(name) }));
}

function Constraints({ spec, raw }: { spec: Obj; raw: unknown }) {
  const schema = deref(spec, raw);
  if (!isObj(schema)) return null;
  const parts: string[] = [];
  if (Array.isArray(schema.enum)) parts.push(`um de: ${schema.enum.map((v) => JSON.stringify(v)).join(", ")}`);
  if (schema.minimum !== undefined) parts.push(`mín. ${schema.minimum}`);
  if (schema.maximum !== undefined) parts.push(`máx. ${schema.maximum}`);
  if (schema.minLength !== undefined) parts.push(`mín. ${schema.minLength} caracteres`);
  if (schema.maxLength !== undefined) parts.push(`máx. ${schema.maxLength} caracteres`);
  if (schema.pattern) parts.push(`padrão ${schema.pattern}`);
  if (schema.default !== undefined) parts.push(`padrão: ${JSON.stringify(schema.default)}`);
  if (schema.nullable === true) parts.push("pode ser null");
  if (!parts.length) return null;
  return <p className="mt-1 text-[12px] text-muted-foreground">{parts.join(" · ")}</p>;
}

function Row({ spec, name, raw, required, depth, seen }: { spec: Obj; name: string; raw: unknown; required: boolean; depth: number; seen: Set<string> }) {
  const ref = isObj(raw) && typeof raw.$ref === "string" ? raw.$ref : undefined;
  const cyclic = ref ? seen.has(ref) : false;
  const nested = cyclic ? null : children(spec, raw);
  const [open, setOpen] = useState(depth < 1);
  const schema = deref(spec, raw);
  const description = isObj(schema) && typeof schema.description === "string" ? schema.description : undefined;

  return (
    <li className="border-t first:border-t-0">
      <div className="flex items-start gap-2 py-2.5">
        {nested?.length ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="mt-0.5 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={open ? `Recolher ${name}` : `Expandir ${name}`}
          >
            <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-90")} />
          </button>
        ) : (
          <span className="w-[22px] shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <code className="font-mono text-[13px] font-semibold text-foreground">{name}</code>
            <span className="font-mono text-[11.5px] text-navy-600 dark:text-navy-300">{typeLabel(spec, raw)}</span>
            {required && <span className="rounded bg-brand/10 px-1.5 text-[10px] font-bold uppercase tracking-wide text-brand-ink">obrigatório</span>}
            {cyclic && <span className="text-[11px] text-muted-foreground">(referência circular)</span>}
          </div>
          {description && <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{description}</p>}
          <Constraints spec={spec} raw={raw} />
        </div>
      </div>
      {open && nested?.length ? (
        <ul className="mb-2 ml-[11px] border-l pl-3">
          {nested.map((child) => (
            <Row
              key={child.name}
              spec={spec}
              name={child.name}
              raw={child.schema}
              required={child.required}
              depth={depth + 1}
              seen={ref ? new Set([...seen, ref]) : seen}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** Árvore de propriedades de um esquema JSON Schema / OpenAPI. */
export function SchemaView({ spec, schema, className }: { spec: Obj; schema: unknown; className?: string }) {
  const rows = children(spec, schema);
  if (!rows) {
    return (
      <p className={cn("rounded-xl border bg-muted/40 px-3 py-2 font-mono text-[12.5px]", className)}>
        {typeLabel(spec, schema)}
      </p>
    );
  }
  return (
    <ul className={cn("rounded-xl border bg-card px-3", className)}>
      {rows.map((row) => (
        <Row key={row.name} spec={spec} name={row.name} raw={row.schema} required={row.required} depth={0} seen={new Set()} />
      ))}
    </ul>
  );
}
