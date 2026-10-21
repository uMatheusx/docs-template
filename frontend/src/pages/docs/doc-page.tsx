import {
  ArrowUp,
  ChevronRight,
  Download,
  FileQuestion,
  Home,
  Link2,
  PenLine,
  Printer,
} from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useMemo, useRef } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import useSWR from "swr";

import { ApiReference } from "@/components/api/api-reference";
import { ReadingProgress } from "@/components/docs/reading-progress";
import { Toc } from "@/components/docs/toc";
import { Markdown } from "@/components/markdown/markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Hint } from "@/components/ui/tooltip";
import { useKeys } from "@/hooks/use-hotkey";
import { useSession } from "@/hooks/use-session";
import { ApiError, keys, type Page } from "@/lib/api";
import { useDocsBase } from "@/lib/docs-base";
import { flattenTree } from "@/lib/tree";
import { cn, downloadText, formatDate, readingTime, splitLeadingH1, timeAgo } from "@/lib/utils";
import { useDocsContext } from "@/pages/docs/docs-layout";

export default function DocPage() {
  const path = useParams()["*"] ?? "";
  const navigate = useNavigate();
  const { tree } = useDocsContext();
  const { user } = useSession();
  const { href } = useDocsBase();
  const editable = !!user;
  const { data: page, error, isLoading } = useSWR<Page>(keys.pageByPath(path));
  const notFound = error instanceof ApiError && error.status === 404;
  // página renomeada ou movida: o endereço antigo leva ao atual
  const { data: moved, error: redirectError } = useSWR<{ path: string }>(notFound ? keys.redirect(path) : null);
  const articleRef = useRef<HTMLElement>(null);

  const { prev, next } = useMemo(() => {
    const flat = flattenTree(tree);
    const i = flat.findIndex((n) => n.path === path);
    return { prev: i > 0 ? flat[i - 1] : undefined, next: i >= 0 ? flat[i + 1] : undefined };
  }, [tree, path]);

  useKeys({
    "[": () => prev && navigate(href(prev.path)),
    "]": () => next && navigate(href(next.path)),
  });

  useEffect(() => {
    if (page) document.title = `${page.title} · Account Hub Docs`;
  }, [page]);

  useEffect(() => {
    if (!window.location.hash) window.scrollTo({ top: 0 });
  }, [path]);

  useEffect(() => {
    if (moved) navigate(href(moved.path) + window.location.hash, { replace: true });
  }, [moved, navigate, href]);

  const checkingRedirect = notFound && !moved && !redirectError;
  if (error && !checkingRedirect) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-32 text-center">
        <FileQuestion className="h-10 w-10 text-muted-foreground" strokeWidth={1.5} />
        <h1 className="mt-5 font-display text-[1.75rem] font-semibold tracking-[-0.02em]">{notFound ? "Página não encontrada" : "Algo deu errado"}</h1>
        <p className="mt-2 text-muted-foreground">{notFound ? `Não existe nada em /docs/${path}.` : error.message}</p>
        <Button asChild className="mt-7 rounded-full bg-foreground text-background shadow-none hover:bg-foreground/85 hover:shadow-none">
          <Link to={href("")}>
            <Home /> Voltar ao início
          </Link>
        </Button>
      </div>
    );
  }

  if (isLoading || checkingRedirect || !page) {
    return (
      <div className="mx-auto max-w-3xl space-y-5 px-2 py-10">
        <Skeleton className="h-5 w-48 rounded-full" />
        <Skeleton className="h-12 w-3/4 rounded-xl" />
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-5/6" />
        <Skeleton className="mt-8 h-56 w-full rounded-2xl" />
      </div>
    );
  }

  const { heading, body } = page.kind === "doc" ? splitLeadingH1(page.content) : { heading: null, body: "" };
  const minutes = readingTime(page.content);
  const copyLink = () => navigator.clipboard.writeText(window.location.href).then(() => toast.success("Link copiado"));

  return (
    <>
      <ReadingProgress />
      <div className="flex gap-10 xl:gap-14">
        <article ref={articleRef} className={cn("mx-auto min-w-0 max-w-[760px] flex-1 px-1 pb-6 pt-8 sm:px-4 print:max-w-none print:p-0")}>
          <motion.header
            key={page.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
            className="mb-10 border-b border-border/70 pb-8"
          >
            <nav aria-label="Trilha" className="flex flex-wrap items-center gap-x-1.5 text-[13px] text-muted-foreground">
              <Link to={href("")} className="rounded transition-colors hover:text-foreground">
                Docs
              </Link>
              {page.breadcrumbs.map((c) => (
                <span key={c.id} className="flex items-center gap-1.5">
                  <ChevronRight aria-hidden className="h-3 w-3 opacity-60" />
                  <Link to={href(c.path)} className="rounded transition-colors hover:text-foreground">
                    {c.title}
                  </Link>
                </span>
              ))}
            </nav>

            <h1 className="mt-5 text-balance font-display text-[2.25rem] font-semibold leading-[1.1] tracking-[-0.022em] sm:text-[2.75rem]">
              {heading ?? page.title}
            </h1>
            {page.description && (
              <p className="mt-3 max-w-[40rem] text-[19px] leading-[1.45] tracking-[-0.01em] text-muted-foreground sm:text-[21px]">
                {page.description}
              </p>
            )}

            <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-muted-foreground">
              <span>{page.kind === "doc" ? `${minutes} min de leitura` : page.kind === "openapi" ? "Referência OpenAPI" : "Referência AsyncAPI"}</span>
              <span title={formatDate(page.updated_at)}>Atualizado {timeAgo(page.updated_at)}</span>
              {page.updated_by && <span>por {page.updated_by}</span>}
              {!page.published && <Badge variant="warning">Rascunho</Badge>}
              <span className="ml-auto flex items-center gap-1 print:hidden">
                <Hint label="Imprimir ou salvar PDF">
                  <Button variant="ghost" size="icon-sm" onClick={() => window.print()} aria-label="Imprimir ou salvar PDF" className="h-8 w-8 rounded-full">
                    <Printer />
                  </Button>
                </Hint>
                <Hint label="Copiar link">
                  <Button variant="ghost" size="icon-sm" onClick={copyLink} aria-label="Copiar link" className="h-8 w-8 rounded-full">
                    <Link2 />
                  </Button>
                </Hint>
                <Hint label={page.kind === "doc" ? "Baixar .md" : "Baixar especificação"}>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => downloadText(`${page.slug}.${page.kind === "doc" ? "md" : "yaml"}`, page.content)}
                    aria-label="Baixar arquivo"
                    className="h-8 w-8 rounded-full"
                  >
                    <Download />
                  </Button>
                </Hint>
                {editable && (
                  <Button
                    asChild
                    size="sm"
                    className="ml-1 h-8 rounded-full bg-foreground px-3.5 text-[13px] font-medium text-background shadow-none hover:bg-foreground/85 hover:shadow-none"
                  >
                    <Link to={`/admin/pages/${page.id}`}>
                      <PenLine /> Editar
                    </Link>
                  </Button>
                )}
              </span>
            </div>
          </motion.header>

          <motion.div key={`${page.id}-body`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1, duration: 0.4 }}>
            {page.kind === "doc" ? (
              <Markdown content={body} />
            ) : (
              <ApiReference kind={page.kind} content={page.content} />
            )}
          </motion.div>

          <footer className="mt-20 border-t border-border/70 pt-8">
            <div className="grid gap-6 sm:grid-cols-2 print:hidden">
              {prev ? (
                <Link to={href(prev.path)} className="group rounded-lg">
                  <span className="block text-[13px] text-muted-foreground">Anterior</span>
                  <span className="mt-1 block text-[17px] font-medium tracking-[-0.01em] text-brand-ink underline-offset-4 group-hover:underline">
                    {prev.title}
                  </span>
                </Link>
              ) : (
                <span />
              )}
              {next && (
                <Link to={href(next.path)} className="group rounded-lg text-right">
                  <span className="block text-[13px] text-muted-foreground">Próxima</span>
                  <span className="mt-1 block text-[17px] font-medium tracking-[-0.01em] text-brand-ink underline-offset-4 group-hover:underline">
                    {next.title}
                  </span>
                </Link>
              )}
            </div>
            <p className="mt-12 text-[13px] text-muted-foreground">
              Atualizado em {formatDate(page.updated_at)}, versão {page.version}
            </p>
          </footer>
        </article>

        {/*
          Altura = conteúdo (self-start): uma coluna sticky da altura da tela era empurrada para
          cima no fim do artigo e encostava/sumia sob o header. top-24 deixa ~28px abaixo do header.
        */}
        <aside className="sticky top-[84px] mt-8 hidden max-h-[calc(100vh-7rem)] w-56 shrink-0 flex-col gap-6 self-start overflow-y-auto pb-2 xl:flex print:!hidden">
          <Toc containerRef={articleRef} contentKey={page.id + page.version} />
          <div className="space-y-0.5 border-t border-border/70 pt-4 text-[13px] first:border-t-0 first:pt-0">
            {editable && (
              <Link to={`/admin/pages/${page.id}`} className="flex items-center gap-2 rounded-md py-1.5 text-muted-foreground transition-colors hover:text-foreground">
                <PenLine className="h-3.5 w-3.5" /> Editar esta página
              </Link>
            )}
            <button onClick={copyLink} className="flex w-full items-center gap-2 rounded-md py-1.5 text-muted-foreground transition-colors hover:text-foreground">
              <Link2 className="h-3.5 w-3.5" /> Copiar link
            </button>
            <button onClick={() => window.print()} className="flex w-full items-center gap-2 rounded-md py-1.5 text-muted-foreground transition-colors hover:text-foreground">
              <Printer className="h-3.5 w-3.5" /> Imprimir ou salvar PDF
            </button>
            <button
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
              className="flex w-full items-center gap-2 rounded-md py-1.5 text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowUp className="h-3.5 w-3.5" /> Voltar ao topo
            </button>
          </div>
        </aside>
      </div>
    </>
  );
}
