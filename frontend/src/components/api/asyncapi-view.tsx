import { ArrowDownToLine, ArrowUpFromLine, Radio } from "lucide-react";
import { useMemo } from "react";

import { CodePanel } from "@/components/api/code-panel";
import { Environments } from "@/components/api/environments";
import { SchemaView } from "@/components/api/schema-view";
import { asyncApiEnvironments, asyncChannels, exampleFor, isObj, pretty, slugify, str, type AsyncMessage, type Obj } from "@/components/api/spec";
import { Markdown } from "@/components/markdown/markdown";
import { cn } from "@/lib/utils";

function ActionBadge({ action }: { action: "send" | "receive" }) {
  const receive = action === "receive";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-bold uppercase ring-1",
        receive ? "bg-sky-500/12 text-sky-700 ring-sky-500/30 dark:text-sky-300" : "bg-emerald-500/12 text-emerald-700 ring-emerald-500/30 dark:text-emerald-300",
      )}
      title={receive ? "Sua aplicação recebe (assina) estas mensagens" : "Sua aplicação envia (publica) estas mensagens"}
    >
      {receive ? <ArrowDownToLine className="h-3 w-3" /> : <ArrowUpFromLine className="h-3 w-3" />}
      {receive ? "Assinar" : "Publicar"}
    </span>
  );
}

function Message({ spec, message }: { spec: Obj; message: AsyncMessage }) {
  const example = message.examples[0] ?? exampleFor(spec, message.payload);
  return (
    <div className="rounded-2xl border bg-background/50 p-4">
      <div className="flex flex-wrap items-baseline gap-2">
        <code className="font-mono text-[13px] font-bold">{message.name}</code>
        {message.title && <span className="text-sm font-semibold text-muted-foreground">{message.title}</span>}
        {message.contentType && <span className="ml-auto rounded-full border px-2 py-0.5 font-mono text-[10px] text-muted-foreground">{message.contentType}</span>}
      </div>
      {(message.summary || message.description) && <p className="mt-1 text-[13px] text-muted-foreground">{message.summary ?? message.description}</p>}
      <div className="mt-3 space-y-3">
        <div className="space-y-3">
          <div>
            <p className="mb-1.5 text-xs font-semibold text-muted-foreground">Payload</p>
            <SchemaView spec={spec} schema={message.payload} />
          </div>
          {message.headers !== undefined && (
            <div>
              <p className="mb-1.5 text-xs font-semibold text-muted-foreground">Cabeçalhos</p>
              <SchemaView spec={spec} schema={message.headers} />
            </div>
          )}
        </div>
        <CodePanel tabs={[{ label: "Exemplo de payload", code: pretty(example) }]} />
      </div>
    </div>
  );
}

interface AsyncApiReferenceProps {
  spec: Obj;
  /** ids ou endereços dos canais a exibir (referência incorporada) */
  channels?: string[];
  embedded?: boolean;
  sourceHref?: string;
}

export function AsyncApiReference({ spec, channels: only, embedded = false, sourceHref }: AsyncApiReferenceProps) {
  const allChannels = useMemo(() => asyncChannels(spec), [spec]);
  const channels = useMemo(() => {
    if (!only?.length) return allChannels;
    const wanted = only.map((c) => c.trim().toLowerCase());
    return allChannels.filter((c) => wanted.includes(c.id.toLowerCase()) || wanted.includes(c.address.toLowerCase()));
  }, [allChannels, only]);
  const environments = useMemo(() => asyncApiEnvironments(spec), [spec]);
  const info = isObj(spec.info) ? spec.info : {};
  const operations = allChannels.reduce((n, c) => n + c.operations.length, 0);
  // incorporada numa página: o canal vira h3 para não competir com os títulos do texto
  const ChannelHeading = embedded ? "h3" : "h2";

  return (
    <div className={cn("not-prose", embedded ? "space-y-6" : "space-y-10")}>
      {embedded ? (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-muted/40 px-4 py-2.5 text-sm font-semibold">
          <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-bold text-brand-ink">AsyncAPI</span>
          {sourceHref ? (
            <a href={sourceHref} className="hover:text-brand-ink hover:underline">
              {str(info.title) ?? "Eventos"}
            </a>
          ) : (
            (str(info.title) ?? "Eventos")
          )}
        </div>
      ) : (
        <>
          <section className="space-y-3">
            <div className="flex flex-wrap gap-2 text-xs font-semibold">
              <span className="rounded-full bg-brand/10 px-2.5 py-1 text-brand-ink">AsyncAPI {String(spec.asyncapi ?? "")}</span>
              {info.version !== undefined && <span className="rounded-full border px-2.5 py-1 text-muted-foreground">versão {String(info.version)}</span>}
              <span className="rounded-full border px-2.5 py-1 text-muted-foreground">
                {allChannels.length} canais · {operations} operações
              </span>
            </div>
            {str(info.description) && <Markdown content={str(info.description)!} className="text-[15px]" />}
          </section>
          <Environments environments={environments} />
        </>
      )}

      {embedded && channels.length === 0 && (
        <p className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">Nenhum canal corresponde ao filtro. Use o id ou o endereço do canal.</p>
      )}

      {channels.map((channel) => (
        <section key={channel.id} className="space-y-5">
          <div>
            <ChannelHeading
              id={`canal-${slugify(channel.id)}`}
              className="scroll-mt-28 flex min-w-0 items-center gap-2.5 font-display text-[1.4rem] font-bold tracking-tight"
            >
              <Radio className="h-5 w-5 shrink-0 text-brand" />
              <code className="min-w-0 break-all font-mono text-[1.05rem]">{channel.address}</code>
            </ChannelHeading>
            {channel.description && <p className="mt-1 text-muted-foreground">{channel.description}</p>}
          </div>
          {channel.operations.map((op) => (
            <article key={op.anchor} className="rounded-3xl border bg-card p-5 shadow-sm sm:p-6">
              <h3 id={op.anchor} data-toc={op.summary ?? op.id} className="scroll-mt-28 flex flex-wrap items-center gap-3">
                <ActionBadge action={op.action} />
                <span className="font-display text-lg font-bold tracking-tight">{op.summary ?? op.id}</span>
              </h3>
              <p className="mt-1 font-mono text-[11px] text-muted-foreground">{op.id}</p>
              {op.description && <Markdown content={op.description} className="mt-3 text-[15px]" />}
              <div className="mt-5 space-y-4">
                {op.messages.map((m) => (
                  <Message key={m.name} spec={spec} message={m} />
                ))}
              </div>
            </article>
          ))}
          {channel.operations.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma operação usa este canal.</p>}
        </section>
      ))}
    </div>
  );
}
