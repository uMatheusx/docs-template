import { redo, undo } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import {
  Bold,
  Code,
  Heading2,
  Heading3,
  ImagePlus,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  Redo2,
  MessageSquareQuote,
  SquareCode,
  Strikethrough,
  Table,
  Undo2,
  Waypoints,
  type LucideIcon,
} from "lucide-react";

import { insertBlock, prefixLines, wrapSelection } from "@/components/admin/editor/editor-commands";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { Hint } from "@/components/ui/tooltip";
import { modKey } from "@/hooks/use-hotkey";
import { CALLOUT_TYPES, MERMAID_SNIPPETS, TABLE_SNIPPET } from "@/lib/content/snippets";

interface Action {
  icon: LucideIcon;
  label: string;
  run: (view: EditorView) => void;
}

const GROUPS: Action[][] = [
  [
    { icon: Undo2, label: `Desfazer (${modKey}+Z)`, run: (v) => (undo(v), v.focus()) },
    { icon: Redo2, label: `Refazer (${modKey}+Shift+Z)`, run: (v) => (redo(v), v.focus()) },
  ],
  [
    { icon: Heading2, label: "Título 2", run: (v) => prefixLines(v, "## ") },
    { icon: Heading3, label: "Título 3", run: (v) => prefixLines(v, "### ") },
  ],
  [
    { icon: Bold, label: `Negrito (${modKey}+B)`, run: (v) => wrapSelection(v, "**") },
    { icon: Italic, label: `Itálico (${modKey}+I)`, run: (v) => wrapSelection(v, "*") },
    { icon: Strikethrough, label: "Riscado", run: (v) => wrapSelection(v, "~~") },
    { icon: Code, label: "Código inline", run: (v) => wrapSelection(v, "`", "`", "código") },
    { icon: Link, label: "Link", run: (v) => wrapSelection(v, "[", "](https://)", "texto do link") },
  ],
  [
    { icon: List, label: "Lista", run: (v) => prefixLines(v, "- ") },
    { icon: ListOrdered, label: "Lista numerada", run: (v) => prefixLines(v, (i) => `${i + 1}. `) },
    { icon: ListChecks, label: "Lista de tarefas", run: (v) => prefixLines(v, "- [ ] ") },
  ],
  [
    { icon: SquareCode, label: "Bloco de código", run: (v) => insertBlock(v, "```ts\n\n```") },
    { icon: Table, label: "Tabela", run: (v) => insertBlock(v, TABLE_SNIPPET) },
  ],
];

interface Props {
  view: EditorView | undefined;
  onImage: () => void;
}

export function EditorToolbar({ view, onImage }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b px-3 py-1.5">
      {GROUPS.map((group, gi) => (
        <div key={gi} className="flex items-center gap-0.5">
          {gi > 0 && <Separator orientation="vertical" className="mx-1 h-5" />}
          {group.map(({ icon: Icon, label, run }) => (
            <Hint key={label} label={label}>
              <Button variant="ghost" size="icon-sm" disabled={!view} onClick={() => view && run(view)} aria-label={label}>
                <Icon />
              </Button>
            </Hint>
          ))}
        </div>
      ))}
      <Separator orientation="vertical" className="mx-1 h-5" />

      <DropdownMenu>
        <Hint label="Alerta / callout">
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" disabled={!view} aria-label="Alerta">
              <MessageSquareQuote />
            </Button>
          </DropdownMenuTrigger>
        </Hint>
        <DropdownMenuContent>
          <DropdownMenuLabel>Alertas</DropdownMenuLabel>
          {CALLOUT_TYPES.map(({ type, label }) => (
            <DropdownMenuItem key={type} onSelect={() => view && insertBlock(view, `> [!${type}]\n> ${label}: escreva aqui.`)}>
              {label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <Hint label="Diagrama Mermaid">
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 px-2" disabled={!view}>
              <Waypoints /> Mermaid
            </Button>
          </DropdownMenuTrigger>
        </Hint>
        <DropdownMenuContent>
          <DropdownMenuLabel>Inserir diagrama</DropdownMenuLabel>
          {Object.entries(MERMAID_SNIPPETS).map(([key, { label, code }]) => (
            <DropdownMenuItem key={key} onSelect={() => view && insertBlock(view, "```mermaid\n" + code + "\n```")}>
              {label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Hint label="Enviar imagem para o S3 (ou cole/arraste no editor)">
        <Button variant="ghost" size="sm" className="h-7 px-2" disabled={!view} onClick={onImage}>
          <ImagePlus /> Imagem
        </Button>
      </Hint>
    </div>
  );
}
