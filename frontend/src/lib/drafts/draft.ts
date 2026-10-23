import type { Page, ReviewFields, ReviewItemInput } from "@/lib/api";
import type { LocalDraft } from "@/lib/drafts/local-drafts";

/** O que o editor edita numa página: as propriedades e o texto. */
export interface Draft {
  title: string;
  slug: string;
  icon: string | null;
  description: string;
  published: boolean;
  content: string;
}

export const FIELDS = ["title", "slug", "icon", "description", "published", "content"] as const;

export const toDraft = (p: Page): Draft => ({
  title: p.title,
  slug: p.slug,
  icon: p.icon,
  description: p.description,
  published: p.published,
  content: p.content,
});

/**
 * Rascunho feito numa versão mais antiga: título, slug, ícone, descrição e publicação que o usuário não
 * mexeu acompanham a página atual (senão a proposta desfaria mudanças de outras pessoas). O texto fica
 * como está: quem o combina com o atual é o servidor, ao aplicar, a partir da versão-base.
 */
export function rebaseLocal(local: LocalDraft, page: Page): Draft {
  if (!local.baseDraft || local.baseVersion === page.version) return local.draft;
  const current = toDraft(page);
  const next = { ...local.draft };
  for (const field of FIELDS) {
    if (field !== "content" && local.draft[field] === local.baseDraft[field]) Object.assign(next, { [field]: current[field] });
  }
  return next;
}

/** Campos do rascunho que diferem da página. */
export const changedFields = (draft: Draft, page: Page) => {
  const base = toDraft(page);
  return FIELDS.filter((f) => draft[f] !== base[f]);
};

/** O que um rascunho muda na página, como item de proposta; null se não há o que propor. */
export function reviewItem(page: Page, local: LocalDraft, bump: ReviewItemInput["bump"]): ReviewItemInput | null {
  const draft = rebaseLocal(local, page);
  const changed = changedFields(draft, page);
  const fields: ReviewFields = {};
  for (const field of changed) if (field !== "content") Object.assign(fields, { [field]: draft[field] });
  const content = changed.includes("content") ? draft.content : undefined;
  if (content === undefined && Object.keys(fields).length === 0) return null;
  return {
    page_id: page.id,
    content,
    fields,
    base_version: local.baseVersion,
    base_semver: local.baseSemver,
    bump,
  };
}
