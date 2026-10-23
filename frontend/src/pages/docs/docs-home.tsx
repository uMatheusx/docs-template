import { ArrowRight, Search } from "lucide-react";
import { motion } from "motion/react";
import { Link } from "react-router";

import { PageIcon } from "@/components/common/page-icon";
import { Skeleton } from "@/components/ui/skeleton";
import { modKey } from "@/hooks/use-hotkey";
import type { TreeNode } from "@/lib/api";
import { useDocsBase } from "@/lib/docs-base";
import { countNodes, flattenTree } from "@/lib/tree";
import { timeAgo } from "@/lib/utils";
import { useDocsContext } from "@/pages/docs/docs-layout";

/** Seção de abertura: ocupa a linha inteira, com as subpáginas à direita. */
function FeaturedTile({ node }: { node: TreeNode }) {
  const { href } = useDocsBase();
  return (
    <div className="grid gap-6 rounded-2xl bg-muted/70 p-7 md:grid-cols-[1fr_auto] md:items-end">
      <Link to={href(node.path)} className="group block">
        <PageIcon name={node.icon} className="h-7 w-7 text-brand" />
        <h2 className="mt-4 font-display text-[1.75rem] font-semibold leading-tight tracking-[-0.02em]">{node.title}</h2>
        <p className="mt-1.5 max-w-md text-[17px] leading-relaxed text-muted-foreground">{node.description || "Saiba mais."}</p>
        <span className="mt-5 inline-flex items-center gap-1 text-[15px] font-medium text-brand-ink group-hover:underline">
          Começar a ler <ArrowRight className="h-4 w-4" />
        </span>
      </Link>
      {node.children.length > 0 && (
        <ul className="min-w-[220px] divide-y divide-border/70 border-t border-border/70 text-[15px] md:border-t-0">
          {node.children.slice(0, 4).map((c) => (
            <li key={c.id}>
              <Link to={href(c.path)} className="group flex items-center gap-2.5 py-2.5">
                <PageIcon name={c.icon} className="h-4 w-4 text-muted-foreground" />
                <span className="group-hover:text-brand-ink">{c.title}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SectionTile({ node }: { node: TreeNode }) {
  const { href } = useDocsBase();
  return (
    <Link to={href(node.path)} className="group flex h-full flex-col rounded-2xl bg-muted/70 p-7 transition-colors hover:bg-muted">
      <PageIcon name={node.icon} className="h-6 w-6 text-brand" />
      <h3 className="mt-4 font-display text-[19px] font-semibold tracking-[-0.02em]">{node.title}</h3>
      <p className="mt-1.5 line-clamp-2 text-[15px] leading-relaxed text-muted-foreground">{node.description || "Saiba mais."}</p>
      {node.children.length > 0 && (
        <p className="mt-auto truncate pt-5 text-[13px] text-muted-foreground">
          {node.children
            .slice(0, 3)
            .map((c) => c.title)
            .join(", ")}
        </p>
      )}
    </Link>
  );
}

export default function DocsHome() {
  const { tree, treeLoading, openSearch } = useDocsContext();
  const { href } = useDocsBase();
  const [featured, ...sections] = tree;
  const flat = flattenTree(tree);
  const recent = [...flat].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 5);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} className="pb-10 lg:pl-8">
      {/* abertura centralizada no eixo da grade: sem sobra de um lado só */}
      <section className="px-7 pb-14 pt-12 text-center sm:pt-16">
        <h1 className="mx-auto max-w-3xl text-balance font-display text-[2.5rem] font-semibold leading-[1.07] tracking-[-0.03em] sm:text-[3.5rem]">
          Contas, acessos e identidade, explicados de ponta a ponta.
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-balance text-[19px] leading-[1.45] text-muted-foreground sm:text-[21px]">
          Guias, referência de API e arquitetura do Account Hub{tree.length ? `, em ${countNodes(tree)} páginas` : ""}.
        </p>
        <button
          onClick={openSearch}
          className="mx-auto mt-8 flex h-12 w-full max-w-xl items-center gap-3 rounded-full bg-muted px-5 text-left transition-colors hover:bg-foreground/[0.07]"
        >
          <Search className="h-4 w-4 text-muted-foreground" />
          <span className="flex-1 text-[15px] text-muted-foreground">Buscar na documentação</span>
          <span className="flex gap-1">
            <kbd>{modKey}</kbd>
            <kbd>K</kbd>
          </span>
        </button>
      </section>

      {treeLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-52 rounded-2xl sm:col-span-2 lg:col-span-3" />
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-44 rounded-2xl" />
          ))}
        </div>
      ) : (
        <>
          {featured && <FeaturedTile node={featured} />}
          {sections.length > 0 && (
            <section className="mt-4 grid auto-rows-fr gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {sections.map((node) => (
                <SectionTile key={node.id} node={node} />
              ))}
            </section>
          )}

          {/* mesma grade dos blocos acima; px-7 alinha o texto ao conteúdo dos blocos */}
          <section className="mt-16 grid gap-x-4 gap-y-10 border-t border-border/70 pt-10 lg:grid-cols-3">
            {recent.length > 0 && (
              <div className="px-7 lg:col-span-2 lg:pr-8">
                <h2 className="font-display text-[21px] font-semibold tracking-[-0.02em]">Atualizadas recentemente</h2>
                <ul className="mt-3 divide-y divide-border/70">
                  {recent.map((p) => (
                    <li key={p.id}>
                      <Link to={href(p.path)} className="group flex items-center gap-3 py-3 text-[15px]">
                        <PageIcon name={p.icon} className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="truncate font-medium group-hover:text-brand-ink">{p.title}</span>
                        <span className="hidden truncate text-[13px] text-muted-foreground sm:inline">/{p.path}</span>
                        <span className="ml-auto shrink-0 text-[13px] text-muted-foreground">{timeAgo(p.updated_at)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="px-7">
              <h2 className="font-display text-[21px] font-semibold tracking-[-0.02em]">Atalhos de teclado</h2>
              <ul className="mt-3 divide-y divide-border/70 text-[15px]">
                <li className="flex items-center justify-between py-3">
                  Buscar
                  <span className="flex gap-1">
                    <kbd>{modKey}</kbd>
                    <kbd>K</kbd>
                  </span>
                </li>
                <li className="flex items-center justify-between py-3">
                  Anterior e próxima
                  <span className="flex gap-1">
                    <kbd>[</kbd>
                    <kbd>]</kbd>
                  </span>
                </li>
                <li className="flex items-center justify-between py-3">
                  Modo foco <kbd>F</kbd>
                </li>
                <li className="flex items-center justify-between py-3">
                  Ver todos <kbd>?</kbd>
                </li>
              </ul>
            </div>
          </section>
        </>
      )}
    </motion.div>
  );
}
