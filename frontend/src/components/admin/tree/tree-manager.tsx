import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  ExternalLink,
  FolderInput,
  GripVertical,
  MoreHorizontal,
  Plus,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { toast } from "sonner";
import useSWR, { useSWRConfig } from "swr";

import { PageIcon } from "@/components/common/page-icon";
import { PageStatusLetters } from "@/components/common/status-letter";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Hint } from "@/components/ui/tooltip";
import { useSession } from "@/hooks/use-session";
import { docsApi, keys, type Review, type TreeNode } from "@/lib/api";
import { useLocalDrafts } from "@/lib/drafts/local-drafts";
import { findNode, isDescendant, siblingsOf } from "@/lib/tree";
import { bodyFont } from "@/lib/content/typography";
import { cn } from "@/lib/utils";

type Position = "before" | "after" | "inside";

/** Largura da seta de expandir (14px do ícone + 2×2px de padding) mais o espaço entre itens da linha (4px). */
const CHEVRON_SLOT = 22;

interface TreeManagerProps {
  tree: TreeNode[];
  selectedId?: string;
  onSelect: (node: TreeNode) => void;
  onAddChild: (parentId: string) => void;
  onMove: (node: TreeNode) => void;
  onDelete: (node: TreeNode) => void;
  /** Desativa arrastar (ex.: enquanto a árvore está filtrada). */
  dragDisabled?: boolean;
}

/** Etiqueta exibida sob o cursor durante o arraste (substitui a "foto" padrão da linha). */
function setDragGhost(e: DragEvent, title: string) {
  const ghost = document.createElement("div");
  ghost.textContent = title;
  Object.assign(ghost.style, {
    position: "fixed",
    top: "-1000px",
    left: "-1000px",
    padding: "6px 12px",
    borderRadius: "10px",
    background: "#EC7000",
    color: "#071030",
    font: `700 12px ${bodyFont()}`,
    boxShadow: "0 8px 24px -8px rgba(236,112,0,.7)",
    whiteSpace: "nowrap",
  });
  document.body.appendChild(ghost);
  e.dataTransfer.setDragImage(ghost, 14, 14);
  setTimeout(() => ghost.remove(), 0);
}

export function TreeManager({ tree, selectedId, onSelect, onAddChild, onMove, onDelete, dragDisabled: filtered }: TreeManagerProps) {
  // reorganizar e excluir são ações de administrador
  const { user } = useSession();
  const canManage = user?.role === "admin";
  const dragDisabled = filtered || !canManage;
  const { mutate } = useSWRConfig();
  // letras de situação: rascunhos locais deste navegador (M/S) e páginas com proposta aberta (E)
  const localDrafts = useLocalDrafts();
  const { data: activeReviews } = useSWR<Review[]>(keys.reviews("active"));
  const inReview = new Set((activeReviews ?? []).flatMap((r) => r.items.map((i) => i.page_id)));
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; position: Position } | null>(null);
  const expandTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const dragged = dragId ? findNode(tree, (n) => n.id === dragId) : undefined;

  useEffect(() => () => clearTimeout(expandTimer.current), []);

  function endDrag() {
    clearTimeout(expandTimer.current);
    setDragId(null);
    setDrop(null);
  }

  async function move(id: string, parentId: string | null, index: number) {
    const previous = tree;
    try {
      const updated = await docsApi.movePage(id, parentId, index);
      await mutate(keys.adminTree, updated, { revalidate: false });
      mutate(keys.tree);
      mutate(keys.adminPage(id)); // o editor aberto atualiza o caminho
      if (parentId) setCollapsed((s) => (s.delete(parentId), new Set(s)));
    } catch (err) {
      await mutate(keys.adminTree, previous, { revalidate: true });
      toast.error("Não foi possível mover a página", { description: (err as Error).message });
    }
  }

  function moveBy(node: TreeNode, delta: -1 | 1) {
    const siblings = siblingsOf(tree, node.parent_id);
    const index = siblings.findIndex((s) => s.id === node.id) + delta;
    if (index < 0 || index >= siblings.length) return;
    move(node.id, node.parent_id, index);
  }

  function onRowDragOver(e: DragEvent, node: TreeNode) {
    if (!dragged) return;
    // sempre aceita o arraste (evita o cursor de "proibido"); alvos inválidos só não mostram indicador
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    if (dragged.id === node.id || isDescendant(dragged, node.id)) {
      if (drop) setDrop(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientY - rect.top) / rect.height;
    const position: Position = ratio < 0.28 ? "before" : ratio > 0.72 ? "after" : "inside";
    if (drop?.id !== node.id || drop.position !== position) {
      setDrop({ id: node.id, position });
      clearTimeout(expandTimer.current);
      // parar sobre uma seção recolhida a abre (para soltar numa subpágina)
      if (position === "inside" && node.children.length && collapsed.has(node.id)) {
        expandTimer.current = setTimeout(() => setCollapsed((s) => (s.delete(node.id), new Set(s))), 550);
      }
    }
  }

  function onRowDrop(e: DragEvent, node: TreeNode) {
    e.preventDefault();
    e.stopPropagation();
    const target = drop;
    const source = dragged;
    endDrag();
    if (!source || !target || target.id !== node.id) return;
    if (target.position === "inside") {
      move(source.id, node.id, node.children.filter((c) => c.id !== source.id).length);
      return;
    }
    const siblings = siblingsOf(tree, node.parent_id).filter((s) => s.id !== source.id);
    const index = siblings.findIndex((s) => s.id === node.id) + (target.position === "after" ? 1 : 0);
    move(source.id, node.parent_id, index);
  }

  function renderNode(node: TreeNode, depth: number, index: number, siblingCount: number) {
    const isOpen = !collapsed.has(node.id);
    const isDrop = drop?.id === node.id;
    const selected = selectedId === node.id;
    return (
      <li key={node.id}>
        <div
          draggable={!dragDisabled}
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", node.id);
            setDragGhost(e, node.title);
            setDragId(node.id);
          }}
          onDragEnd={endDrag}
          onDragOver={(e) => onRowDragOver(e, node)}
          onDrop={(e) => onRowDrop(e, node)}
          // sem filhas não há seta: a linha avança a largura dela para o ícone ficar alinhado com o das irmãs que têm
          style={{ marginLeft: depth * 14 + (node.children.length ? 0 : CHEVRON_SLOT) }}
          className={cn("group relative flex items-center text-[13px]", dragId === node.id && "opacity-40")}
        >
          {isDrop && drop.position !== "inside" && (
            <span
              className={cn(
                "pointer-events-none absolute left-2 right-2 flex h-0.5 items-center rounded-full bg-brand",
                drop.position === "before" ? "-top-px" : "-bottom-px",
              )}
            >
              <span className="-ml-1 h-2 w-2 rounded-full border-2 border-brand bg-background" />
            </span>
          )}
          <div
            onClick={() => onSelect(node)}
            className={cn(
              "flex min-w-0 flex-1 cursor-pointer items-center gap-1 rounded-xl py-1.5 pl-1 pr-1 transition-colors",
              selected
                ? "bg-brand/10 font-bold text-foreground ring-1 ring-brand/25"
                : "font-medium text-muted-foreground group-hover:bg-accent group-hover:text-foreground",
              isDrop && drop.position === "inside" && "bg-brand/15 text-foreground ring-2 ring-brand/70",
            )}
          >
          {!dragDisabled && (
            <GripVertical className="h-3.5 w-3.5 shrink-0 cursor-grab text-muted-foreground/40 opacity-0 transition-opacity group-hover:opacity-100" />
          )}
          {node.children.length > 0 && (
            <button
              type="button"
              className="rounded p-0.5 text-muted-foreground hover:bg-accent"
              onClick={(e) => {
                e.stopPropagation();
                setCollapsed((s) => (s.has(node.id) ? s.delete(node.id) : s.add(node.id), new Set(s)));
              }}
              aria-label={isOpen ? "Recolher" : "Expandir"}
            >
              <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", isOpen && "rotate-90")} />
            </button>
          )}
          <span
            className={cn(
              "flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border bg-background",
              selected && "brand-tile border-transparent",
            )}
          >
            <PageIcon name={node.icon} className="h-3.5 w-3.5" />
          </span>
          <span className="flex-1 truncate">{node.title}</span>
          {!isOpen && node.children.length > 0 && (
            <span className="rounded-full bg-muted px-1.5 text-[10px] font-bold text-muted-foreground">{node.children.length}</span>
          )}
          <PageStatusLetters
            published={node.published}
            local={localDrafts[node.id]}
            inReview={inReview.has(node.id)}
          />
          {/* largura 0 (não `hidden`): as ações continuam alcançáveis pelo teclado e aparecem ao focar */}
          <span className="flex w-0 items-center overflow-hidden group-focus-within:w-auto group-hover:w-auto has-[[data-state=open]]:w-auto">
            <Hint label="Nova subpágina">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onAddChild(node.id);
                }}
                className="rounded-md p-1 text-muted-foreground outline-none hover:bg-background hover:text-foreground focus-visible:bg-background focus-visible:text-foreground"
                aria-label={`Nova subpágina em ${node.title}`}
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </Hint>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  onClick={(e) => e.stopPropagation()}
                  className="rounded-md p-1 text-muted-foreground outline-none hover:bg-background hover:text-foreground focus-visible:bg-background focus-visible:text-foreground"
                  aria-label={`Ações de ${node.title}`}
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
                <DropdownMenuItem onSelect={() => onAddChild(node.id)}>
                  <Plus /> Nova subpágina
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => window.open(`/docs/${node.path}`, "_blank")}>
                  <ExternalLink /> Abrir na documentação
                </DropdownMenuItem>
                {canManage && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => onMove(node)}>
                      <FolderInput /> Mover para…
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled={index === 0} onSelect={() => moveBy(node, -1)}>
                      <ArrowUp /> Mover para cima
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled={index === siblingCount - 1} onSelect={() => moveBy(node, 1)}>
                      <ArrowDown /> Mover para baixo
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem destructive onSelect={() => onDelete(node)}>
                      <Trash2 /> Excluir
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </span>
          </div>
        </div>
        {isOpen && node.children.length > 0 && (
          <ul className="mt-0.5 space-y-0.5">
            {node.children.map((child, i) => renderNode(child, depth + 1, i, node.children.length))}
          </ul>
        )}
      </li>
    );
  }

  return (
    // a área inteira aceita o arraste: sem isso o navegador mostra o cursor de "proibido" nos espaços entre linhas
    <div
      onDragOver={(e) => {
        if (!dragged) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (drop) setDrop(null);
      }}
      onDrop={(e) => {
        e.preventDefault();
        endDrag();
      }}
      className="min-h-full"
    >
      <ul className="space-y-0.5">{tree.map((node, i) => renderNode(node, 0, i, tree.length))}</ul>
      {dragged && dragged.parent_id && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = "move";
            if (drop) setDrop(null);
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            endDrag();
            move(dragged.id, null, tree.length);
          }}
          className="mt-2 rounded-xl border-2 border-dashed border-brand/50 bg-brand/5 p-3 text-center text-xs font-semibold text-brand-ink"
        >
          Solte aqui para mover para o nível superior
        </div>
      )}
    </div>
  );
}
