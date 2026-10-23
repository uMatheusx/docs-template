import { ChevronRight } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { Link } from "react-router";

import { PageIcon } from "@/components/common/page-icon";
import { StatusLetter } from "@/components/common/status-letter";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { TreeNode } from "@/lib/api";
import { cn } from "@/lib/utils";

interface NavTreeProps {
  nodes: TreeNode[];
  /** raiz da leitura ("/docs") */
  base?: string;
  activePath: string;
  forceOpen?: boolean;
  onNavigate?: () => void;
  layoutId?: string;
}

/**
 * Árvore de navegação:
 * - nível 1: ícone + título, fundo suave quando ativo;
 * - subníveis: uma única linha-guia; o item ativo é marcado por um traço laranja que desliza sobre ela.
 */
export function NavTree({ nodes, base = "/docs", activePath, forceOpen, onNavigate, layoutId = "nav" }: NavTreeProps) {
  return (
    <nav aria-label="Navegação da documentação" className="space-y-0.5">
      {nodes.map((node) => (
        <NavItem
          key={node.id}
          node={node}
          depth={0}
          base={base}
          activePath={activePath}
          forceOpen={forceOpen}
          onNavigate={onNavigate}
          layoutId={layoutId}
        />
      ))}
    </nav>
  );
}

function NavItem({
  node,
  depth,
  base,
  activePath,
  forceOpen,
  onNavigate,
  layoutId,
}: { node: TreeNode; depth: number } & Omit<NavTreeProps, "nodes">) {
  const active = activePath === node.path;
  const containsActive = active || activePath.startsWith(`${node.path}/`);
  const [open, setOpen] = useState(containsActive);
  const [prevContains, setPrevContains] = useState(containsActive);
  // abre automaticamente quando a página ativa passa a estar dentro deste nó
  if (containsActive !== prevContains) {
    setPrevContains(containsActive);
    if (containsActive) setOpen(true);
  }
  const hasChildren = node.children.length > 0;
  const isOpen = forceOpen || open;
  const topLevel = depth === 0;

  const link = (
    <Link
      to={`${base}/${node.path}`}
      onClick={() => {
        // clicar num item sempre volta ao topo (inclusive na página em que já está)
        window.scrollTo({ top: 0 });
        onNavigate?.();
      }}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex min-w-0 flex-1 items-center gap-2.5 rounded-lg py-[7px] text-[14px] leading-5 transition-colors",
        // foco desenhado por dentro: o contorno externo padrão era cortado pelo overflow da lista
        "outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/50",
        topLevel ? "px-2.5" : "pl-3.5 pr-2",
        hasChildren && "pr-9",
        active
          ? "font-semibold text-foreground"
          : containsActive
            ? "font-medium text-foreground"
            : "text-muted-foreground hover:text-foreground",
        topLevel && !active && "hover:bg-foreground/[0.04]",
      )}
    >
      {topLevel && active && (
        <motion.span
          layoutId={`${layoutId}-pill`}
          transition={{ type: "spring", stiffness: 500, damping: 40 }}
          className="absolute inset-0 -z-10 rounded-lg bg-foreground/[0.06] dark:bg-white/[0.1]"
        />
      )}
      {!topLevel && active && (
        <motion.span
          layoutId={`${layoutId}-bar`}
          transition={{ type: "spring", stiffness: 500, damping: 40 }}
          className="absolute inset-y-1.5 -left-[1.5px] w-[2px] rounded-full bg-brand"
        />
      )}
      {topLevel && (
        <PageIcon
          name={node.icon}
          className={cn("h-4 w-4 shrink-0 transition-colors", containsActive ? "text-brand" : "text-muted-foreground")}
        />
      )}
      <span className="truncate">{node.title}</span>
      {!node.published && <StatusLetter status="draft" />}
    </Link>
  );

  if (!hasChildren) return link;

  return (
    <Collapsible open={isOpen} onOpenChange={setOpen}>
      <div className="relative flex items-center">
        {link}
        <CollapsibleTrigger
          className="absolute right-1 flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/70 outline-none transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/50"
          aria-label={isOpen ? `Recolher ${node.title}` : `Expandir ${node.title}`}
        >
          <ChevronRight className={cn("h-3.5 w-3.5 transition-transform duration-200", isOpen && "rotate-90")} />
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        {/* linha-guia única, alinhada ao centro do ícone do pai */}
        <div className={cn("mb-1 mt-0.5 space-y-px border-l border-border/80", topLevel ? "ml-[17px]" : "ml-3.5")}>
          {node.children.map((child) => (
            <NavItem
              key={child.id}
              node={child}
              depth={depth + 1}
              base={base}
              activePath={activePath}
              forceOpen={forceOpen}
              onNavigate={onNavigate}
              layoutId={layoutId}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
