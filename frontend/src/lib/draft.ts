import type { Draft } from "@/components/admin/inspector";
import type { Page, ReviewFields, ReviewInput } from "@/lib/api";
import type { LocalDraft } from "@/lib/local-drafts";

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

/** Corpo da proposta para um rascunho; null se não há o que propor. */
export function reviewPayload(
  page: Page,
  local: LocalDraft,
  extra: { title: string; description: string; bump: ReviewInput["bump"] },
): ReviewInput | null {
  const draft = rebaseLocal(local, page);
  const changed = changedFields(draft, page);
  const fields: ReviewFields = {};
  for (const field of changed) if (field !== "content") Object.assign(fields, { [field]: draft[field] });
  const content = changed.includes("content") ? draft.content : undefined;
  if (content === undefined && Object.keys(fields).length === 0) return null;
  return {
    ...extra,
    content,
    fields,
    base_version: local.baseVersion,
    base_semver: local.baseSemver,
  };
}
