import {
  autocompletion,
  completionStatus,
  startCompletion,
  type Completion,
  type CompletionContext,
} from "@codemirror/autocomplete";
import type { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { asyncChannels, isObj, listOperations, parseSpec, str, type Obj } from "@/components/api/spec";
import { SPEC_HINT } from "@/lib/content/spec-hint";
import { api, fetchText, isAssetRef, keys, type Asset, type Page } from "@/lib/api";
import { CALLOUT_TYPES, MERMAID_SNIPPETS, TABLE_SNIPPET } from "@/lib/content/snippets";

/** Disparado quando o usuário escolhe "/Imagem" — o editor abre o seletor de arquivos. */
export const SLASH_IMAGE_EVENT = "ah:slash-image";

type SpecKind = "openapi" | "asyncapi";

/** Página que pode virar link: o editor informa a lista (todas, exceto a que está sendo editada). */
export interface SlashPage {
  id: string;
  title: string;
  /** caminho sem /docs/ (ex.: "guias/autenticacao") */
  path: string;
  published: boolean;
  kind: "doc" | SpecKind;
}

let slashPages: SlashPage[] = [];
export function setSlashPages(pages: SlashPage[]) {
  slashPages = pages;
}

let slashAssets: Asset[] = [];
export function setSlashAssets(assets: Asset[]) {
  slashAssets = assets;
}

const KIND_LABEL: Record<SpecKind, string> = { openapi: "OpenAPI", asyncapi: "AsyncAPI" };

/** Chaves que um bloco de referência aceita, além de `ref:`. */
const SPEC_KEYS: Record<SpecKind, { key: string; detail: string; info: string }[]> = {
  openapi: [
    {
      key: "operations",
      detail: "só algumas operações",
      info: 'Lista de operações a mostrar: "POST /accounts" ou o operationId. Sem esta chave (e sem tags), o contrato aparece inteiro.',
    },
    { key: "tags", detail: "só algumas tags", info: "Lista de tags: mostra todas as operações de cada tag." },
  ],
  asyncapi: [
    {
      key: "channels",
      detail: "só alguns canais",
      info: "Lista de canais a mostrar, pelo id ou pelo endereço. Sem esta chave, o contrato aparece inteiro.",
    },
  ],
};

/** De onde vem uma especificação: uma página ou um contrato enviado em Arquivos. */
interface SpecSource {
  title: string;
  /** valor do `ref:` no bloco */
  ref: string;
  detail: string;
}
const specSources = (kind: SpecKind): SpecSource[] => [
  ...slashPages
    .filter((p) => p.kind === kind)
    .map((p) => ({ title: p.title, ref: `/docs/${p.path}`, detail: `/docs/${p.path}${p.published ? "" : " · rascunho"}` })),
  ...slashAssets
    .filter((a) => a.spec_kind === kind)
    .map((a) => ({ title: a.name, ref: a.url, detail: `arquivo · ${KIND_LABEL[kind]}` })),
];

interface SlashItem {
  label: string;
  detail: string;
  info?: string;
  insert?: string;
  /** posição do cursor dentro do texto inserido (padrão: fim) */
  caret?: number;
  action?: "image" | "pages" | "files" | SpecKind;
}

const ITEMS: SlashItem[] = [
  {
    label: "Link para página",
    detail: "buscar",
    info: "Lista as páginas da documentação; escolha uma para inserir o link.",
    action: "pages",
  },
  {
    label: "Link para arquivo",
    detail: "buscar",
    info: "Lista os arquivos enviados em Arquivos (contratos, PDFs, planilhas…); escolha um para inserir o link.",
    action: "files",
  },
  { label: "Título 2", detail: "##", insert: "## " },
  { label: "Título 3", detail: "###", insert: "### " },
  { label: "Lista", detail: "•", insert: "- " },
  { label: "Numerada", detail: "1.", insert: "1. " },
  { label: "Tarefas", detail: "☐", insert: "- [ ] " },
  { label: "Citação", detail: "❝", insert: "> " },
  ...CALLOUT_TYPES.map(({ type, label }) => ({
    label: `Alerta ${label}`,
    detail: `[!${type}]`,
    info: `Bloco de destaque do tipo ${label.toLowerCase()}.`,
    insert: `> [!${type}]\n> `,
  })),
  { label: "Código", detail: "```", insert: "```ts\n\n```\n", caret: 6 },
  { label: "Tabela", detail: "3 colunas", insert: `${TABLE_SNIPPET}\n` },
  { label: "Divisor", detail: "---", insert: "---\n" },
  { label: "Link externo", detail: "[ ]( )", info: "Link para um endereço de fora da documentação.", insert: "[texto](https://)", caret: 1 },
  {
    label: "Referência OpenAPI",
    detail: "buscar",
    info: "Incorpora uma página OpenAPI. Escolha a especificação; depois use operations (\"POST /accounts\" ou operationId) ou tags para recortar.",
    action: "openapi",
    // sem nenhuma página OpenAPI ainda: insere um exemplo para editar
    insert: "```openapi\nref: /docs/referencia-api/api-rest\noperations:\n  - POST /accounts\n```\n",
  },
  {
    label: "Referência AsyncAPI",
    detail: "buscar",
    info: "Incorpora uma página AsyncAPI. Escolha a especificação; depois use channels (id ou endereço) para recortar.",
    action: "asyncapi",
    insert: "```asyncapi\nref: /docs/referencia-api/eventos\nchannels:\n  - accountLifecycle\n```\n",
  },
  { label: "Imagem", detail: "upload S3", info: "Envia uma imagem para o S3 e insere o markdown.", action: "image" },
  ...Object.values(MERMAID_SNIPPETS).map(({ label, code }) => ({
    label: `Mermaid ${label}`,
    detail: "diagrama",
    info: code.split("\n")[0],
    insert: "```mermaid\n" + code + "\n```\n",
  })),
];

// "Link para página" e "Referência …" deixam só as páginas certas na lista, até ela fechar
type Mode = "pages" | "files" | SpecKind | null;
let mode: Mode = null;
let startingMode = false;
const resetMode = EditorView.updateListener.of((update) => {
  if (mode && !startingMode && completionStatus(update.state) === null) mode = null;
});

function startMode(view: EditorView, next: Exclude<Mode, null>, start: number, to: number) {
  // fica só a "/", e a lista reabre mostrando o que foi pedido
  view.dispatch({ changes: { from: start, to, insert: "/" }, selection: { anchor: start + 1 } });
  mode = next;
  startingMode = true;
  startCompletion(view);
  setTimeout(() => (startingMode = false), 50);
}

function applyPage(page: SlashPage) {
  return (view: EditorView, _completion: Completion, from: number, to: number) => {
    const start = from - 1; // inclui a "/"
    const text = `[${page.title}](/docs/${page.path})`;
    mode = null;
    view.dispatch({ changes: { from: start, to, insert: text }, selection: { anchor: start + text.length } });
  };
}

function applyFile(asset: Asset) {
  return (view: EditorView, _completion: Completion, from: number, to: number) => {
    const start = from - 1;
    const image = /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(asset.name);
    const text = `${image ? "!" : ""}[${asset.name}](${asset.url})`;
    mode = null;
    view.dispatch({ changes: { from: start, to, insert: text }, selection: { anchor: start + text.length } });
  };
}

/** Insere o bloco de referência já apontando para a especificação escolhida. */
function applySpecBlock(source: SpecSource, kind: SpecKind) {
  return (view: EditorView, _completion: Completion, from: number, to: number) => {
    const start = from - 1;
    const text = `\`\`\`${kind}\nref: ${source.ref}\n${SPEC_HINT[kind]}\n\`\`\`\n`;
    mode = null;
    view.dispatch({ changes: { from: start, to, insert: text }, selection: { anchor: start + text.length } });
  };
}

function apply(item: SlashItem) {
  return (view: EditorView, _completion: Completion, from: number, to: number) => {
    const start = from - 1; // inclui a "/"
    if (item.action === "image") {
      view.dispatch({ changes: { from: start, to, insert: "" } });
      view.dom.dispatchEvent(new CustomEvent(SLASH_IMAGE_EVENT));
      return;
    }
    if (item.action === "pages") return startMode(view, "pages", start, to);
    if (item.action === "files" && slashAssets.length > 0) return startMode(view, "files", start, to);
    if ((item.action === "openapi" || item.action === "asyncapi") && specSources(item.action).length > 0) {
      return startMode(view, item.action, start, to);
    }
    const text = item.insert ?? "";
    view.dispatch({
      changes: { from: start, to, insert: text },
      selection: { anchor: start + (item.caret ?? text.length) },
    });
  };
}

function pageCompletion(page: SlashPage, i: number, boost: number, applyFn: Completion["apply"]): Completion {
  const tag = page.kind === "doc" ? "" : ` · ${KIND_LABEL[page.kind]}`;
  return {
    // o que se digita casa com o título e com o caminho; na lista aparece só o título
    label: `${page.title} /docs/${page.path}`,
    displayLabel: page.title,
    detail: `/docs/${page.path}${tag}${page.published ? "" : " · rascunho"}`,
    type: "text",
    boost: boost - i,
    apply: applyFn,
  };
}

function slashSource(context: CompletionContext) {
  const line = context.state.doc.lineAt(context.pos);
  const before = context.state.sliceDoc(line.from, context.pos);
  const match = /^(\s*)\/([\p{L}\w-]*)$/u.exec(before);
  if (!match) {
    mode = null;
    return null;
  }
  const from = line.from + match[1].length + 1;
  const validFor = /^[\p{L}\w-]*$/u;

  if (mode === "openapi" || mode === "asyncapi") {
    const kind = mode;
    return {
      from,
      validFor,
      options: specSources(kind).map(
        (source, i): Completion => ({
          label: `${source.title} ${source.ref}`,
          displayLabel: source.title,
          detail: source.detail,
          type: "text",
          boost: -i,
          apply: applySpecBlock(source, kind),
          section: { name: `Especificações ${KIND_LABEL[kind]}`, rank: 0 },
        }),
      ),
    };
  }

  if (mode === "files") {
    return {
      from,
      validFor,
      options: slashAssets.map(
        (asset, i): Completion => ({
          label: asset.name,
          detail: asset.spec_kind ? `${KIND_LABEL[asset.spec_kind]} · ${(asset.size / 1024).toFixed(0)} KB` : `${(asset.size / 1024).toFixed(0)} KB`,
          type: "text",
          boost: -i,
          apply: applyFile(asset),
          section: { name: "Arquivos", rank: 0 },
        }),
      ),
    };
  }

  const pageOptions = slashPages.map((page, i) => ({
    ...pageCompletion(page, i, mode === "pages" ? 0 : -1000, applyPage(page)),
    section: { name: "Páginas", rank: 1 },
  }));
  if (mode === "pages") return { from, validFor, options: pageOptions };

  const commandOptions = ITEMS.map(
    (item, i): Completion => ({
      label: item.label,
      detail:
        item.action === "pages"
          ? `${slashPages.length} páginas`
          : item.action === "files"
            ? `${slashAssets.length} ${slashAssets.length === 1 ? "arquivo" : "arquivos"}`
            : item.action === "openapi" || item.action === "asyncapi"
              ? `${specSources(item.action).length} ${specSources(item.action).length === 1 ? "especificação" : "especificações"}`
              : item.detail,
      info: item.info,
      section: { name: "Blocos", rank: 0 },
      boost: -i,
      apply: apply(item),
    }),
  );
  return { from, validFor, options: [...commandOptions, ...pageOptions] };
}

// ---------------------------------------------------------------- dentro de um bloco ```openapi / ```asyncapi

/** O bloco de referência em que o cursor está (linha de abertura e tipo), ou null. */
function enclosingSpecFence(state: EditorState, pos: number): { kind: SpecKind; openLine: number } | null {
  for (let n = state.doc.lineAt(pos).number - 1; n >= 1; n--) {
    const match = /^\s*```\s*(\w*)\s*$/.exec(state.doc.line(n).text);
    if (match) return match[1] === "openapi" || match[1] === "asyncapi" ? { kind: match[1], openLine: n } : null;
  }
  return null;
}

/** Valor de `ref:` no bloco e a chave de lista em que o cursor está (operations, tags ou channels). */
function fenceContext(state: EditorState, openLine: number, cursorLine: number) {
  let ref: string | undefined;
  let section: "operations" | "tags" | "channels" | undefined;
  for (let n = openLine + 1; n < cursorLine; n++) {
    const text = state.doc.line(n).text;
    const refMatch = /^ref:\s*(\S+)\s*$/.exec(text);
    if (refMatch) ref = refMatch[1];
    const key = /^(operations|tags|channels):\s*$/.exec(text);
    if (key) section = key[1] as typeof section;
    else if (/^[\w-]+:/.test(text) && !refMatch) section = undefined; // outra chave encerra a lista
  }
  return { ref, section };
}

interface SpecInfo {
  operations: Completion[];
  tags: Completion[];
  channels: Completion[];
}

const specCache = new Map<string, { at: number; value: Promise<SpecInfo | null> }>();
const SPEC_TTL = 20_000;

/** Operações, tags e canais da especificação (lidos da página; guardados por alguns segundos). */
function loadSpec(ref: string): Promise<SpecInfo | null> {
  const path = ref.replace(/^\/?docs\//, "").replace(/^\/+|\/+$/g, "");
  const cacheKey = isAssetRef(ref) ? ref : path;
  const cached = specCache.get(cacheKey);
  if (cached && Date.now() - cached.at < SPEC_TTL) return cached.value;
  const source = isAssetRef(ref) ? fetchText(ref) : api<Page>(keys.pageByPath(path)).then((page) => page.content);
  const value = source
    .then((content): SpecInfo | null => {
      const { spec } = parseSpec(content);
      if (!spec) return null;
      const ops = "paths" in spec ? listOperations(spec) : [];
      const tagNames = new Set<string>(ops.flatMap((op) => op.tags));
      for (const tag of Array.isArray(spec.tags) ? spec.tags : []) if (isObj(tag) && str(tag.name)) tagNames.add(str(tag.name)!);
      const channels = "channels" in spec ? asyncChannels(spec as Obj) : [];
      return {
        operations: ops.map((op) => ({
          label: `${op.method.toUpperCase()} ${op.path}`,
          detail: op.summary ?? op.operationId ?? "",
          info: op.description,
          type: "function",
        })),
        tags: [...tagNames].sort().map((name) => ({ label: name, type: "keyword" })),
        channels: channels.map((ch) => ({
          label: ch.id,
          detail: ch.address !== ch.id ? ch.address : "",
          info: ch.description,
          type: "function",
        })),
      };
    })
    .catch(() => null);
  specCache.set(cacheKey, { at: Date.now(), value });
  return value;
}

/** Sugestões dentro de um bloco de referência: a especificação em `ref:` e o recorte (operations, tags, channels). */
function specFenceSource(context: CompletionContext) {
  const fence = enclosingSpecFence(context.state, context.pos);
  if (!fence) return null;
  const line = context.state.doc.lineAt(context.pos);
  const before = context.state.sliceDoc(line.from, context.pos);

  // início de linha: sugere as chaves que o bloco aceita e ainda não foram usadas
  const keyMatch = /^([a-z]*)$/.exec(before);
  if (keyMatch && (keyMatch[1] || context.explicit)) {
    let end = context.state.doc.lines;
    for (let n = fence.openLine + 1; n <= context.state.doc.lines; n++) {
      if (/^\s*```/.test(context.state.doc.line(n).text)) {
        end = n - 1;
        break;
      }
    }
    const used = new Set<string>();
    for (let n = fence.openLine + 1; n <= end; n++) {
      const found = /^([\w-]+):/.exec(context.state.doc.line(n).text);
      if (found) used.add(found[1]);
    }
    const options = [
      ...(used.has("ref") ? [] : [{ key: "ref", detail: "página ou arquivo da especificação", info: "Endereço da especificação: uma página (/docs/…) ou um contrato enviado em Arquivos." }]),
      ...SPEC_KEYS[fence.kind],
    ]
      .filter((k) => !used.has(k.key))
      .map(
        (k, i): Completion => ({
          label: k.key,
          detail: k.detail,
          info: k.info,
          type: "keyword",
          boost: -i,
          apply: (view, _completion, from, to) => {
            const text = k.key === "ref" ? "ref: " : `${k.key}:\n  - `;
            view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } });
            // já mostra as opções do que vem a seguir (a especificação, ou as operações/tags/canais dela)
            setTimeout(() => startCompletion(view), 30);
          },
        }),
      );
    if (options.length > 0) return { from: line.from, validFor: /^[a-z]*$/, options };
  }

  const refMatch = /^(ref:\s*)(\S*)$/.exec(before);
  if (refMatch) {
    return {
      from: line.from + refMatch[1].length,
      validFor: /^\S*$/,
      options: specSources(fence.kind).map(
        (source, i): Completion => ({
          label: source.ref,
          detail: source.title,
          type: "text",
          boost: -i,
        }),
      ),
    };
  }

  const itemMatch = /^(\s*-\s+)(.*)$/.exec(before);
  if (!itemMatch) return null;
  const { ref, section } = fenceContext(context.state, fence.openLine, line.number);
  if (!ref || !section) return null;
  const from = line.from + itemMatch[1].length;
  return loadSpec(ref).then((info) => {
    if (!info) return null;
    const options = info[section];
    return options.length ? { from, validFor: /^.*$/, options } : null;
  });
}

export const slashCommands = [
  autocompletion({
    override: [slashSource, specFenceSource],
    icons: false,
    activateOnTyping: true,
    closeOnBlur: true,
  }),
  resetMode,
];
