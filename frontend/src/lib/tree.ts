import type { TreeNode } from "@/lib/api";

/** Lista os nós em ordem de leitura (pré-ordem). */
export function flattenTree(nodes: TreeNode[], depth = 0, out: (TreeNode & { depth: number })[] = []) {
  for (const node of nodes) {
    out.push({ ...node, depth });
    flattenTree(node.children, depth + 1, out);
  }
  return out;
}

export function findNode(nodes: TreeNode[], predicate: (n: TreeNode) => boolean): TreeNode | undefined {
  for (const node of nodes) {
    if (predicate(node)) return node;
    const found = findNode(node.children, predicate);
    if (found) return found;
  }
  return undefined;
}

/** IDs dos ancestrais de um nó (do mais externo ao pai direto). */
export function ancestorIds(nodes: TreeNode[], id: string, trail: string[] = []): string[] | null {
  for (const node of nodes) {
    if (node.id === id) return trail;
    const found = ancestorIds(node.children, id, [...trail, node.id]);
    if (found) return found;
  }
  return null;
}

export function isDescendant(node: TreeNode, id: string): boolean {
  return node.children.some((c) => c.id === id || isDescendant(c, id));
}

export function siblingsOf(nodes: TreeNode[], parentId: string | null): TreeNode[] {
  if (!parentId) return nodes;
  return findNode(nodes, (n) => n.id === parentId)?.children ?? [];
}

export function countNodes(nodes: TreeNode[]): number {
  return nodes.reduce((sum, n) => sum + 1 + countNodes(n.children), 0);
}

