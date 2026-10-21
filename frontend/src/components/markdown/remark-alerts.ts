import type { Blockquote, Root } from "mdast";
import { visit } from "unist-util-visit";

export const ALERT_TYPES = ["note", "tip", "important", "warning", "caution"] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

const MARKER = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(\r?\n)?/i;

/** Converte alertas no estilo GitHub (`> [!NOTE]`) em <aside class="callout callout-note">. */
export function remarkAlerts() {
  return (tree: Root) => {
    visit(tree, "blockquote", (node: Blockquote) => {
      const paragraph = node.children[0];
      if (paragraph?.type !== "paragraph") return;
      const text = paragraph.children[0];
      if (text?.type !== "text") return;
      const match = text.value.match(MARKER);
      if (!match) return;

      text.value = text.value.slice(match[0].length);
      if (!text.value) paragraph.children.shift();
      if (paragraph.children[0]?.type === "break") paragraph.children.shift();
      if (!paragraph.children.length) node.children.shift();

      node.data = {
        ...node.data,
        hName: "aside",
        hProperties: { className: ["callout", `callout-${match[1].toLowerCase()}`] },
      };
    });
  };
}
