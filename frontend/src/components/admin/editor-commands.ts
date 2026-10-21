import type { EditorView } from "@codemirror/view";

/** Envolve a seleção (ou um placeholder) com marcadores inline. */
export function wrapSelection(view: EditorView, before: string, after = before, placeholder = "texto") {
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to) || placeholder;
  view.dispatch({
    changes: { from, to, insert: before + selected + after },
    selection: { anchor: from + before.length, head: from + before.length + selected.length },
  });
  view.focus();
}

/** Adiciona um prefixo no início de cada linha selecionada. */
export function prefixLines(view: EditorView, prefix: string | ((i: number) => string)) {
  const { from, to } = view.state.selection.main;
  const start = view.state.doc.lineAt(from).number;
  const end = view.state.doc.lineAt(to).number;
  const changes = [];
  for (let n = start; n <= end; n++) {
    const line = view.state.doc.line(n);
    changes.push({ from: line.from, insert: typeof prefix === "string" ? prefix : prefix(n - start) });
  }
  view.dispatch({ changes });
  view.focus();
}

/** Insere um bloco em uma nova linha após a linha atual. */
export function insertBlock(view: EditorView, text: string) {
  const { from } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);
  const pos = line.length ? line.to : line.from;
  const prefix = line.length ? "\n\n" : "";
  const insert = `${prefix}${text}\n`;
  view.dispatch({ changes: { from: pos, insert }, selection: { anchor: pos + insert.length } });
  view.focus();
}

/** Insere texto na posição do cursor. */
export function insertText(view: EditorView, text: string, at?: number) {
  const pos = at ?? view.state.selection.main.head;
  view.dispatch({ changes: { from: pos, insert: text }, selection: { anchor: pos + text.length } });
}

/** Substitui todo o documento (preserva o histórico de desfazer). */
export function replaceAll(view: EditorView, text: string) {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
}
