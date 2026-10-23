import { useSyncExternalStore } from "react";

import type { Draft } from "@/components/admin/inspector";

/**
 * Rascunhos guardados no navegador (localStorage).
 *
 * Por que localStorage: sobrevive a recarregar a página, fechar a aba e reabrir o navegador (a memória da aba
 * não), é síncrono (dá para gravar no último instante, ao sair da página) e basta para texto markdown. O limite
 * é de alguns MB por site; se estourar, o editor avisa e volta a perguntar antes de sair.
 * Fica só neste navegador: outro computador ou perfil não vê.
 */
export interface LocalDraft {
  draft: Draft;
  savedAt: string;
  /** revisão da página em que o rascunho se baseia (a mesclagem compara com ela ao aplicar a proposta) */
  baseVersion: number;
  /** versão x.y.z dessa base */
  baseSemver?: string;
  /** campos da página nessa versão: separam o que o usuário mudou do que mudou na página depois */
  baseDraft?: Draft;
  /** guardado de propósito, pelo botão Salvar (pronto para enviar para revisão) */
  explicit?: boolean;
}

export interface LocalSummary {
  explicit: boolean;
  savedAt: string;
}

const PREFIX = "ah-draft:";
const EVENT = "ah:local-drafts";

export const localKey = (pageId: string) => `${PREFIX}${pageId}`;

const notify = () => window.dispatchEvent(new Event(EVENT));

export function readLocal(pageId: string): LocalDraft | null {
  try {
    const raw = localStorage.getItem(localKey(pageId));
    return raw ? (JSON.parse(raw) as LocalDraft) : null;
  } catch {
    return null;
  }
}

/** "ok", "full" (quota estourada) ou "unavailable" (armazenamento bloqueado/desativado). */
export function writeLocal(pageId: string, local: LocalDraft): "ok" | "full" | "unavailable" {
  try {
    localStorage.setItem(localKey(pageId), JSON.stringify(local));
  } catch (err) {
    return err instanceof DOMException && (err.name === "QuotaExceededError" || err.name === "NS_ERROR_DOM_QUOTA_REACHED")
      ? "full"
      : "unavailable";
  }
  notify();
  return "ok";
}

export function clearLocal(pageId: string) {
  try {
    if (localStorage.getItem(localKey(pageId)) === null) return;
    localStorage.removeItem(localKey(pageId));
    notify();
  } catch {
    /* armazenamento indisponível */
  }
}

/** Páginas com rascunho local, por id. */
export function listLocal(): Record<string, LocalSummary> {
  const found: Record<string, LocalSummary> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(PREFIX)) continue;
      const pageId = key.slice(PREFIX.length);
      const local = readLocal(pageId);
      if (local) found[pageId] = { explicit: !!local.explicit, savedAt: local.savedAt };
    }
  } catch {
    /* armazenamento indisponível */
  }
  return found;
}

// useSyncExternalStore exige um valor estável entre leituras sem mudança: guarda o último e a assinatura dele
let cache: { signature: string; value: Record<string, LocalSummary> } = { signature: "", value: {} };

function snapshot() {
  const value = listLocal();
  const signature = Object.entries(value)
    .map(([id, s]) => `${id}:${s.explicit ? 1 : 0}:${s.savedAt}`)
    .sort()
    .join("|");
  if (signature !== cache.signature) cache = { signature, value };
  return cache.value;
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange); // outra aba do mesmo navegador
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Rascunhos locais por página, atualizados na hora (nesta aba e nas outras). */
export function useLocalDrafts(): Record<string, LocalSummary> {
  return useSyncExternalStore(subscribe, snapshot, () => cache.value);
}
