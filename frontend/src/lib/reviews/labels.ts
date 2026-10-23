import type { ReviewEvent, ReviewFields, ReviewStatus } from "@/lib/api";

export const REVIEW_STATUS: Record<ReviewStatus, { label: string; className: string }> = {
  open: { label: "Aguardando revisão", className: "bg-sky-500/12 text-sky-700 ring-sky-500/30 dark:text-sky-300" },
  approved: { label: "Aprovada", className: "bg-emerald-500/12 text-emerald-700 ring-emerald-500/30 dark:text-emerald-300" },
  changes_requested: { label: "Alterações pedidas", className: "bg-amber-500/12 text-amber-700 ring-amber-500/30 dark:text-amber-300" },
  merged: { label: "Aplicada", className: "bg-violet-500/12 text-violet-700 ring-violet-500/30 dark:text-violet-300" },
  closed: { label: "Fechada", className: "bg-muted text-muted-foreground ring-border" },
};

export const ACTIVE_STATUSES: ReviewStatus[] = ["open", "approved", "changes_requested"];

export const EVENT_VERB: Record<ReviewEvent["type"], string> = {
  created: "abriu a proposta",
  updated: "atualizou a proposta",
  comment: "comentou",
  approved: "aprovou",
  changes_requested: "pediu alterações",
  merged: "aplicou a proposta",
  closed: "fechou a proposta",
};

const FIELD_LABEL: Record<keyof ReviewFields, string> = {
  title: "Título",
  slug: "Slug",
  icon: "Ícone",
  description: "Descrição",
  published: "Publicação",
};

/** Lista legível das mudanças de propriedades de uma proposta. */
export function describeFields(fields: ReviewFields): { label: string; value: string }[] {
  return (Object.keys(fields) as (keyof ReviewFields)[])
    // a API devolve null para o que a proposta não altera
    .filter((k) => fields[k] != null)
    .map((k) => ({
      label: FIELD_LABEL[k],
      value: k === "published" ? (fields.published ? "Publicar a página" : "Voltar para rascunho") : String(fields[k]),
    }));
}
