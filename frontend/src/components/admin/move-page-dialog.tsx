import { CornerDownRight, FolderInput, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useSWRConfig } from "swr";

import { ParentSelect } from "@/components/admin/parent-select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { docsApi, keys, type TreeNode } from "@/lib/api";
import { findNode, siblingsOf } from "@/lib/tree";

interface Props {
  tree: TreeNode[];
  pageId: string | null;
  onOpenChange: (open: boolean) => void;
  onMoved?: () => void;
}

/** Move uma página para outro pai (fica no fim da lista de irmãos). */
export function MovePageDialog({ tree, pageId, onOpenChange, onMoved }: Props) {
  const node = pageId ? findNode(tree, (n) => n.id === pageId) : undefined;
  return (
    <Dialog open={!!pageId} onOpenChange={onOpenChange}>
      <DialogContent>{node && <MoveForm key={node.id} tree={tree} node={node} onDone={() => onOpenChange(false)} onMoved={onMoved} />}</DialogContent>
    </Dialog>
  );
}

function MoveForm({ tree, node, onDone, onMoved }: { tree: TreeNode[]; node: TreeNode; onDone: () => void; onMoved?: () => void }) {
  const { mutate } = useSWRConfig();
  const [parent, setParent] = useState<string | null>(node.parent_id);
  const [saving, setSaving] = useState(false);
  const target = parent ? findNode(tree, (n) => n.id === parent) : undefined;

  async function submit() {
    setSaving(true);
    try {
      const index = siblingsOf(tree, parent).filter((s) => s.id !== node.id).length;
      const updated = await docsApi.movePage(node.id, parent, index);
      await mutate(keys.adminTree, updated, { revalidate: false });
      mutate(keys.tree);
      toast.success("Página movida", { description: target ? `Agora dentro de “${target.title}”` : "Agora no nível superior" });
      onMoved?.();
      onDone();
    } catch (err) {
      toast.error("Não foi possível mover", { description: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-5">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <span className="brand-tile flex h-8 w-8 items-center justify-center rounded-lg">
            <FolderInput className="h-4 w-4" />
          </span>
          Mover “{node.title}”
        </DialogTitle>
        <DialogDescription>
          {node.children.length > 0
            ? `As ${node.children.length} subpágina(s) vão junto. O endereço da página muda conforme o novo pai.`
            : "O endereço da página muda conforme o novo pai."}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-2">
        <Label htmlFor="move-parent">Novo local</Label>
        <ParentSelect id="move-parent" tree={tree} value={parent} onChange={setParent} exclude={node} />
        <p className="flex items-center gap-1.5 rounded-lg bg-muted px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground">
          <CornerDownRight className="h-3.5 w-3.5" />
          /docs/{target ? `${target.path}/` : ""}
          {node.slug}
        </p>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancelar
        </Button>
        <Button onClick={submit} disabled={saving || parent === node.parent_id}>
          {saving ? <Loader2 className="animate-spin" /> : <FolderInput />} Mover
        </Button>
      </DialogFooter>
    </div>
  );
}
