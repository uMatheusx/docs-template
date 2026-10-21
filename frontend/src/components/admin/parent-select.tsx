import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { TreeNode } from "@/lib/api";
import { flattenTree, isDescendant } from "@/lib/tree";

const ROOT = "__root__";

interface ParentSelectProps {
  tree: TreeNode[];
  value: string | null;
  onChange: (value: string | null) => void;
  /** Página sendo movida: ela e seus descendentes não podem ser pais. */
  exclude?: TreeNode;
  id?: string;
}

export function ParentSelect({ tree, value, onChange, exclude, id }: ParentSelectProps) {
  const options = flattenTree(tree).filter((n) => !exclude || (n.id !== exclude.id && !isDescendant(exclude, n.id)));
  return (
    <Select value={value ?? ROOT} onValueChange={(v) => onChange(v === ROOT ? null : v)}>
      <SelectTrigger id={id}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ROOT}>— Raiz (nível superior)</SelectItem>
        {options.map((n) => (
          <SelectItem key={n.id} value={n.id}>
            <span style={{ paddingLeft: n.depth * 14 }}>{n.title}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
