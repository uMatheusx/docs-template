import { ArrowRight, FilePlus2, FileUp, Loader2, PenSquare, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import useSWR, { useSWRConfig } from "swr";

import { MovePageDialog } from "@/components/admin/move-page-dialog";
import { PageEditor } from "@/components/admin/page-editor";
import { TreeManager } from "@/components/admin/tree-manager";
import { PageIcon } from "@/components/page-icon";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Hint } from "@/components/ui/tooltip";
import { modKey } from "@/hooks/use-hotkey";
import { useMediaQuery } from "@/hooks/use-media-query";
import { ApiError, docsApi, keys, type Page, type TreeNode } from "@/lib/api";
import { countNodes, filterTree, findNode, flattenTree, isDescendant } from "@/lib/tree";
import { timeAgo } from "@/lib/utils";
import { useAdmin } from "@/pages/admin/admin-layout";

export default function AdminPages() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { mutate } = useSWRConfig();
  const { tree, treeLoading, openNewPage, openImport } = useAdmin();
  const [filter, setFilter] = useState("");
  const [toDelete, setToDelete] = useState<TreeNode>();
  const [toMove, setToMove] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const filtered = useMemo(() => filterTree(tree, filter), [tree, filter]);
  const desktop = useMediaQuery("(min-width: 768px)");

  async function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      const { deleted } = await docsApi.deletePage(toDelete.id);
      toast.success(deleted > 1 ? `${deleted} páginas excluídas` : "Página excluída");
      if (id && (id === toDelete.id || isDescendant(toDelete, id))) {
        navigate("/admin/pages", { state: { skipGuard: true } });
      }
      await Promise.all([mutate(keys.adminTree), mutate(keys.tree), mutate(keys.stats)]);
    } catch (err) {
      toast.error("Falha ao excluir", { description: (err as Error).message });
    } finally {
      setDeleting(false);
      setToDelete(undefined);
    }
  }

  const navigator = (
    // aceita arraste em todo o painel (sem cursor de "proibido" fora das linhas)
    <div className="flex h-full flex-col bg-sidebar" onDragOver={(e) => e.preventDefault()}>
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <div>
          <h2 className="font-display text-sm font-semibold">Páginas</h2>
          <p className="text-[11px] text-muted-foreground">{countNodes(tree)} no total · arraste para organizar</p>
        </div>
        <div className="flex gap-0.5">
          <Hint label="Importar .md">
            <Button variant="ghost" size="icon-sm" onClick={openImport} aria-label="Importar">
              <FileUp />
            </Button>
          </Hint>
          <Hint label="Nova página (N)">
            <Button variant="soft" size="icon-sm" onClick={() => openNewPage()} aria-label="Nova página">
              <FilePlus2 />
            </Button>
          </Hint>
        </div>
      </div>
      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filtrar"
            aria-label="Filtrar páginas"
            className="h-8 w-full rounded-lg border bg-background/70 pl-8 pr-7 text-xs outline-none transition-all focus:border-brand/50 focus:ring-4 focus:ring-brand/10"
          />
          {filter && (
            <button onClick={() => setFilter("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" aria-label="Limpar">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      <ScrollArea className="flex-1">
        <div className="px-2 pb-4">
          {treeLoading ? (
            <div className="space-y-1.5 p-1">
              {Array.from({ length: 10 }, (_, i) => (
                <Skeleton key={i} className="h-8 rounded-xl" />
              ))}
            </div>
          ) : (
            <TreeManager
              tree={filtered}
              selectedId={id}
              dragDisabled={!!filter}
              onSelect={(node) => navigate(`/admin/pages/${node.id}`)}
              onAddChild={(parentId) => openNewPage(parentId)}
              onMove={(node) => setToMove(node.id)}
              onDelete={setToDelete}
            />
          )}
        </div>
      </ScrollArea>
    </div>
  );

  const deleteCount = toDelete ? countNodes([toDelete]) : 0;
  const onDeleteCurrent = () => setToDelete(findNode(tree, (n) => n.id === id));

  return (
    <div className="h-full">
      {desktop ? (
        <ResizablePanelGroup direction="horizontal" autoSaveId="ah-studio">
          <ResizablePanel id="navigator" order={1} defaultSize={22} minSize={15} maxSize={36}>
            {navigator}
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel id="workspace" order={2} minSize={45}>
            {id ? (
              <EditorLoader key={id} id={id} onDelete={onDeleteCurrent} />
            ) : (
              <EmptyStudio tree={tree} onNew={() => openNewPage()} onImport={openImport} />
            )}
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : id ? (
        <EditorLoader key={id} id={id} onDelete={onDeleteCurrent} />
      ) : (
        navigator
      )}

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir “{toDelete?.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteCount > 1
                ? `Esta página e ${deleteCount - 1} subpágina(s) serão removidas do DynamoDB e do S3, incluindo o histórico.`
                : "A página será removida do DynamoDB e do S3, incluindo o histórico."}{" "}
              Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground shadow-none hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                confirmDelete();
              }}
              disabled={deleting}
            >
              {deleting && <Loader2 className="animate-spin" />} Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* o editor aberto recarrega o caminho ao detectar a mudança na árvore */}
      <MovePageDialog
        tree={tree}
        pageId={toMove}
        onOpenChange={(open) => !open && setToMove(null)}
        onMoved={() => toMove && mutate(keys.adminPage(toMove))}
      />
    </div>
  );
}

function EmptyStudio({ tree, onNew, onImport }: { tree: TreeNode[]; onNew: () => void; onImport: () => void }) {
  const recent = flattenTree(tree)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, 6);
  return (
    <div className="relative flex h-full items-center justify-center overflow-y-auto p-8">
      <div className="bg-dots pointer-events-none absolute inset-0 opacity-60 [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_70%)]" />
      <div className="relative w-full max-w-xl animate-fade-up text-center">
        <span className="brand-tile mx-auto flex h-16 w-16 items-center justify-center rounded-3xl">
          <PenSquare className="h-7 w-7" />
        </span>
        <h2 className="mt-6 font-display text-3xl font-semibold tracking-tight">O que vamos escrever hoje?</h2>
        <p className="mt-2 text-muted-foreground">
          Escolha uma página na árvore, crie uma nova ou importe arquivos markdown. Pressione <kbd>{modKey}</kbd> <kbd>K</kbd> para
          pular direto para qualquer página.
        </p>
        <div className="mt-7 flex justify-center gap-2">
          <Button variant="outline" onClick={onImport}>
            <FileUp /> Importar .md
          </Button>
          <Button onClick={onNew}>
            <FilePlus2 /> Nova página
          </Button>
        </div>
        {recent.length > 0 && (
          <div className="mt-10 text-left">
            <p className="mb-2 text-xs font-semibold text-muted-foreground">Continuar editando</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {recent.map((p) => (
                <Link
                  key={p.id}
                  to={`/admin/pages/${p.id}`}
                  className="group flex items-center gap-3 rounded-2xl border bg-card p-3 transition-all hover:border-brand/40 hover:shadow-glow"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl border bg-background transition-colors group-hover:border-transparent group-hover:brand-tile">
                    <PageIcon name={p.icon} className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold">{p.title}</span>
                    <span className="block text-xs text-muted-foreground">{timeAgo(p.updated_at)}</span>
                  </span>
                  <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-brand" />
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function EditorLoader({ id, onDelete }: { id: string; onDelete: () => void }) {
  const { data, error } = useSWR<Page>(keys.adminPage(id), { revalidateIfStale: false });
  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
        {error instanceof ApiError && error.status === 404 ? "Página não encontrada." : error.message}
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-brand" />
      </div>
    );
  }
  return <PageEditor page={data} onDelete={onDelete} />;
}
