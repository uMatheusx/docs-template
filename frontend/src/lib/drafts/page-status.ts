import type { LocalSummary } from "@/lib/drafts/local-drafts";

/**
 * Situação de uma página, no estilo das letras do controle de versão do VS Code: uma letra colorida; o nome
 * por extenso aparece ao passar o mouse (e fica no rótulo de acessibilidade).
 */
export type PageStatus = "published" | "draft" | "modified" | "saved" | "review";

export const STATUS: Record<PageStatus, { letter: string; label: string; hint: string; className: string }> = {
  published: {
    letter: "P",
    label: "Publicada",
    hint: "visível para os leitores",
    className: "text-emerald-600 dark:text-emerald-400",
  },
  draft: {
    letter: "R",
    label: "Rascunho",
    hint: "só quem edita a documentação vê",
    className: "text-amber-600 dark:text-amber-400",
  },
  modified: {
    letter: "M",
    label: "Modificada",
    hint: "alterações ainda não salvas",
    className: "text-orange-600 dark:text-orange-400",
  },
  saved: {
    letter: "S",
    label: "Salva",
    hint: "salva neste navegador, pronta para enviar para revisão",
    className: "text-sky-600 dark:text-sky-400",
  },
  review: {
    letter: "E",
    label: "Em revisão",
    hint: "há uma proposta de alteração aberta",
    className: "text-violet-600 dark:text-violet-400",
  },
};

/**
 * Letras de uma página: a situação de publicação (P ou R) e, quando houver, o que está pendente (M, S ou E).
 * Um rascunho local salvo (S) ou modificado (M) vem do navegador; E vem das propostas abertas.
 */
export function pageStatuses(opts: { published: boolean; local?: LocalSummary; inReview?: boolean }): PageStatus[] {
  const list: PageStatus[] = [opts.published ? "published" : "draft"];
  if (opts.local) list.push(opts.local.explicit ? "saved" : "modified");
  if (opts.inReview) list.push("review");
  return list;
}
