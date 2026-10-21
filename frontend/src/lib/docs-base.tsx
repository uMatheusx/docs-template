import { createContext, useContext } from "react";

export interface DocsBase {
  /** raiz da leitura ("/docs") */
  base: string;
}

export const DocsBaseContext = createContext<DocsBase>({ base: "/docs" });

/** Base de navegação da leitura. */
export function useDocsBase() {
  const ctx = useContext(DocsBaseContext);
  return { ...ctx, href: (path: string) => (path ? `${ctx.base}/${path}` : ctx.base) };
}

/** Caminho da página a partir de "/docs/caminho". */
export function parseDocsPath(pathname: string): { path: string } {
  return { path: decodeURIComponent(pathname).replace(/^\/docs\/?/, "").replace(/\/$/, "") };
}
