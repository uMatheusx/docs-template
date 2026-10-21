import {
  autocompletion,
  completionStatus,
  startCompletion,
  type Completion,
  type CompletionContext,
} from "@codemirror/autocomplete";
import { EditorView } from "@codemirror/view";

import { CALLOUT_TYPES, MERMAID_SNIPPETS, TABLE_SNIPPET } from "@/lib/snippets";

/** Disparado quando o usuário escolhe "/Imagem" — o editor abre o seletor de arquivos. */
export const SLASH_IMAGE_EVENT = "ah:slash-image";

/** Página que pode virar link: o editor informa a lista (todas, exceto a que está sendo editada). */
export interface SlashPage {
  id: string;
  title: string;
  /** caminho sem /docs/ (ex.: "guias/autenticacao") */
  path: string;
  published: boolean;
}

let slashPages: SlashPage[] = [];
export function setSlashPages(pages: SlashPage[]) {
  slashPages = pages;
}

interface SlashItem {
  label: string;
  detail: string;
  info?: string;
  insert?: string;
  /** posição do cursor dentro do texto inserido (padrão: fim) */
  caret?: number;
  action?: "image" | "pages";
}

const ITEMS: SlashItem[] = [
  {
    label: "Link para página",
    detail: "buscar",
    info: "Lista as páginas da documentação; escolha uma para inserir o link.",
    action: "pages",
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
    detail: "```openapi",
    info: "Incorpora operações de uma página OpenAPI. Use operations (\"POST /accounts\" ou operationId) ou tags; sem filtro, mostra tudo.",
    insert: "```openapi\nref: /docs/referencia-api/api-rest\noperations:\n  - POST /accounts\n```\n",
  },
  {
    label: "Referência AsyncAPI",
    detail: "```asyncapi",
    info: "Incorpora canais de uma página AsyncAPI. Use channels (id ou endereço); sem filtro, mostra todos.",
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

// "Link para página" deixa só as páginas na lista, até ela fechar
let pagesOnly = false;
let startingPages = false;
const resetPagesOnly = EditorView.updateListener.of((update) => {
  if (pagesOnly && !startingPages && completionStatus(update.state) === null) pagesOnly = false;
});

function applyPage(page: SlashPage) {
  return (view: EditorView, _completion: Completion, from: number, to: number) => {
    const start = from - 1; // inclui a "/"
    const text = `[${page.title}](/docs/${page.path})`;
    pagesOnly = false;
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
    if (item.action === "pages") {
      // fica só a "/", e a lista reabre mostrando as páginas
      view.dispatch({ changes: { from: start, to, insert: "/" }, selection: { anchor: start + 1 } });
      pagesOnly = true;
      startingPages = true;
      startCompletion(view);
      setTimeout(() => (startingPages = false), 50);
      return;
    }
    const text = item.insert ?? "";
    view.dispatch({
      changes: { from: start, to, insert: text },
      selection: { anchor: start + (item.caret ?? text.length) },
    });
  };
}

function slashSource(context: CompletionContext) {
  const line = context.state.doc.lineAt(context.pos);
  const before = context.state.sliceDoc(line.from, context.pos);
  const match = /^(\s*)\/([\p{L}\w-]*)$/u.exec(before);
  if (!match) {
    pagesOnly = false;
    return null;
  }
  const pageOptions = slashPages.map(
    (page, i): Completion => ({
      // o que se digita casa com o título e com o caminho; na lista aparece só o título
      label: `${page.title} /docs/${page.path}`,
      displayLabel: page.title,
      detail: `/docs/${page.path}${page.published ? "" : " · rascunho"}`,
      type: "text",
      section: { name: "Páginas", rank: 1 },
      boost: pagesOnly ? -i : -1000 - i,
      apply: applyPage(page),
    }),
  );
  const commandOptions = ITEMS.map(
    (item, i): Completion => ({
      label: item.label,
      detail: item.action === "pages" ? `${slashPages.length} páginas` : item.detail,
      info: item.info,
      section: { name: "Blocos", rank: 0 },
      boost: -i,
      apply: apply(item),
    }),
  );
  return {
    from: line.from + match[1].length + 1,
    validFor: /^[\p{L}\w-]*$/u,
    options: pagesOnly ? pageOptions : [...commandOptions, ...pageOptions],
  };
}

export const slashCommands = [
  autocompletion({
    override: [slashSource],
    icons: false,
    activateOnTyping: true,
    closeOnBlur: true,
  }),
  resetPagesOnly,
];
