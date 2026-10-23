import { json } from "@codemirror/lang-json";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { yaml } from "@codemirror/lang-yaml";
import { languages } from "@codemirror/language-data";
import { EditorView, keymap } from "@codemirror/view";

import { wrapSelection } from "@/components/admin/editor/editor-commands";
import { slashCommands } from "@/components/admin/editor/slash-commands";

/** Arquivos soltos ou colados no editor chegam ao componente por este evento (com a posição do drop). */
export const FILES_EVENT = "ah:files";
export type FilesEventDetail = { files: File[]; pos?: number };

function emitFiles(view: EditorView, files: File[], pos?: number) {
  view.dom.dispatchEvent(new CustomEvent<FilesEventDetail>(FILES_EVENT, { detail: { files, pos } }));
}

const fileHandlers = EditorView.domEventHandlers({
  drop(event, view) {
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (!files.length) return false;
    event.preventDefault();
    emitFiles(view, files, view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? undefined);
    return true;
  },
  paste(event, view) {
    const files = Array.from(event.clipboardData?.files ?? []);
    if (!files.length) return false;
    event.preventDefault();
    emitFiles(view, files);
    return true;
  },
});

export const markdownExtensions = [
  markdown({ base: markdownLanguage, codeLanguages: languages }),
  EditorView.lineWrapping,
  slashCommands,
  keymap.of([
    { key: "Mod-b", run: (v) => (wrapSelection(v, "**"), true) },
    { key: "Mod-i", run: (v) => (wrapSelection(v, "*"), true) },
  ]),
  fileHandlers,
];
// especificações OpenAPI/AsyncAPI: sem toolbar nem comandos "/" de markdown
export const yamlExtensions = [yaml(), EditorView.lineWrapping, fileHandlers];
export const jsonExtensions = [json(), EditorView.lineWrapping, fileHandlers];
export const isJsonText = (text: string) => text.trimStart().startsWith("{");

export function parseFrontmatter(text: string): { meta: Record<string, string>; body: string } {
  const match = text.match(/^\uFEFF?---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
  if (!match) return { meta: {}, body: text };
  const meta: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return { meta, body: text.slice(match[0].length).replace(/^\n+/, "") };
}
