import { autocompletion, type Completion, type CompletionContext } from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";

import { CALLOUT_TYPES, MERMAID_SNIPPETS, TABLE_SNIPPET } from "@/lib/snippets";

/** Disparado quando o usuário escolhe "/Imagem" — o editor abre o seletor de arquivos. */
export const SLASH_IMAGE_EVENT = "ah:slash-image";

interface SlashItem {
  label: string;
  detail: string;
  info?: string;
  insert?: string;
  /** posição do cursor dentro do texto inserido (padrão: fim) */
  caret?: number;
  action?: "image";
}

const ITEMS: SlashItem[] = [
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
  { label: "Link", detail: "[ ]( )", insert: "[texto](https://)", caret: 1 },
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

function apply(item: SlashItem) {
  return (view: EditorView, _completion: Completion, from: number, to: number) => {
    const start = from - 1; // inclui a "/"
    if (item.action === "image") {
      view.dispatch({ changes: { from: start, to, insert: "" } });
      view.dom.dispatchEvent(new CustomEvent(SLASH_IMAGE_EVENT));
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
  if (!match) return null;
  return {
    from: line.from + match[1].length + 1,
    validFor: /^[\p{L}\w-]*$/u,
    options: ITEMS.map(
      (item, i): Completion => ({
        label: item.label,
        detail: item.detail,
        info: item.info,
        boost: -i,
        apply: apply(item),
      }),
    ),
  };
}

export const slashCommands = autocompletion({
  override: [slashSource],
  icons: false,
  activateOnTyping: true,
  closeOnBlur: true,
});
