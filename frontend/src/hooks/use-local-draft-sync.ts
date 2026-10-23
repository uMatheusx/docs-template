import { useCallback, useEffect, useRef, useState } from "react";

import type { Draft } from "@/components/admin/inspector";
import { clearLocal, writeLocal } from "@/lib/local-drafts";

interface LocalDraftState {
  draft: Draft;
  /** há diferença para a página */
  dirty: boolean;
  /** há diferença que ainda não foi guardada em lugar nenhum */
  unsaved: boolean;
  /** "local" = o usuário apertou Salvar (fica guardado enquanto houver diferença para a página) */
  persistedKind: "proposal" | "local" | null;
  origin: { version: number; semver: string; fields: Draft };
}

/**
 * Guarda sozinho, neste navegador, o que está sendo editado: logo depois de cada mudança (com uma pequena espera),
 * ao fechar a aba e ao sair da página. Devolve se a última gravação falhou (aí sair volta a pedir confirmação).
 */
export function useLocalDraftSync(pageId: string, state: LocalDraftState) {
  const [failed, setFailed] = useState(false);
  // sempre o estado mais recente, para gravar no último instante (ao sair da página ou fechar a aba)
  const latest = useRef(state);
  useEffect(() => {
    latest.current = state;
  });

  const flush = useCallback(() => {
    const now = latest.current;
    // "Salvar" local: guarda enquanto houver diferença para a página; o resto só enquanto não estiver guardado
    const keep = now.persistedKind === "local" ? now.dirty : now.unsaved;
    if (!keep) {
      clearLocal(pageId);
      setFailed(false);
      return;
    }
    const result = writeLocal(pageId, {
      draft: now.draft,
      savedAt: new Date().toISOString(),
      baseVersion: now.origin.version,
      baseSemver: now.origin.semver,
      baseDraft: now.origin.fields,
      explicit: now.persistedKind === "local" && !now.unsaved,
    });
    setFailed(result !== "ok");
  }, [pageId]);

  const { draft, dirty, unsaved, persistedKind, origin } = state;
  useEffect(() => {
    const timer = setTimeout(flush, 400);
    return () => clearTimeout(timer);
  }, [draft, dirty, unsaved, persistedKind, origin, flush]);

  useEffect(() => {
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush(); // saindo da página: grava o que ainda estava no intervalo de espera
    };
  }, [flush]);

  return { failed, setFailed };
}
