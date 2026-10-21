import type { LinkIssue, LinkReport, TreeNode } from "@/lib/api";
import { flattenTree } from "@/lib/tree";
import { daysSince } from "@/lib/utils";

export type Severity = "critical" | "warning" | "info";

export interface HealthIssue {
  id: string;
  label: string;
  hint: string;
  /** mensagem exibida quando a checagem passa */
  okLabel: string;
  severity: Severity;
  pages: TreeNode[];
  /** ocorrências de links/imagens (checagens do relatório de links) */
  links?: LinkIssue[];
}

const STALE_DAYS = 180;

/** Avalia a qualidade do conteúdo a partir da árvore e do relatório de links quebrados. */
export function contentHealth(
  tree: TreeNode[],
  report?: LinkReport,
): { score: number; issues: HealthIssue[]; passed: HealthIssue[]; checks: HealthIssue[]; total: number } {
  const pages = flattenTree(tree);
  const byId = new Map(pages.map((p) => [p.id, p]));
  const linkCheck = (
    id: string,
    kinds: LinkIssue["kind"][],
    meta: Pick<HealthIssue, "label" | "hint" | "okLabel" | "severity">,
  ): HealthIssue | null => {
    if (!report) return null;
    const links = report.issues.filter((i) => kinds.includes(i.kind));
    const affected = [...new Set(links.map((l) => l.page_id))].flatMap((pid) => byId.get(pid) ?? []);
    return { id, ...meta, pages: affected, links };
  };
  const noDescription = pages.filter((p) => !p.description.trim());
  const stale = pages.filter((p) => daysSince(p.updated_at) > STALE_DAYS);
  const drafts = pages.filter((p) => !p.published);
  const noIcon = tree.filter((p) => !p.icon);

  const checks: HealthIssue[] = [
    {
      id: "description",
      label: "Sem descrição",
      hint: "A descrição aparece nos cards, na busca e nas prévias de link.",
      okLabel: "Todas as páginas têm descrição",
      severity: "warning" as const,
      pages: noDescription,
    },
    {
      id: "stale",
      label: `Sem atualização há ${STALE_DAYS}+ dias`,
      hint: "Revise se o conteúdo ainda está correto.",
      okLabel: `Tudo atualizado nos últimos ${STALE_DAYS} dias`,
      severity: "critical" as const,
      pages: stale,
    },
    {
      id: "drafts",
      label: "Rascunhos",
      hint: "Visíveis apenas para quem edita a documentação.",
      okLabel: "Nenhum rascunho pendente",
      severity: "info" as const,
      pages: drafts,
    },
    {
      id: "icon",
      label: "Seções sem ícone",
      hint: "Ícones ajudam a reconhecer seções na navegação.",
      okLabel: "Todas as seções têm ícone",
      severity: "info" as const,
      pages: noIcon,
    },
    linkCheck("broken-links", ["broken_link"], {
      label: "Links quebrados",
      hint: "Apontam para páginas que não existem mais (ou que mudaram de endereço).",
      okLabel: "Nenhum link quebrado",
      severity: "critical",
    }),
    linkCheck("broken-images", ["broken_image", "broken_asset"], {
      label: "Imagens e arquivos quebrados",
      hint: "Referenciam arquivos de mídia que foram excluídos do S3.",
      okLabel: "Todas as imagens e arquivos existem",
      severity: "critical",
    }),
    linkCheck("draft-links", ["draft_link"], {
      label: "Links para rascunhos",
      hint: "Leitores não conseguem abrir: publique o destino ou remova o link.",
      okLabel: "Nenhum link aponta para rascunho",
      severity: "warning",
    }),
  ].filter((c): c is HealthIssue => c !== null);
  const count = (c: HealthIssue) => c.links?.length ?? c.pages.length;
  const issues = checks.filter((c) => count(c) > 0);
  const passed = checks.filter((c) => count(c) === 0);

  if (!pages.length) return { score: 100, issues, passed, checks, total: 0 };
  // cada página vale 4 checagens: descrição, atualidade, publicação e links/imagens íntegros
  const brokenPages = new Set(report?.issues.filter((i) => i.kind !== "draft_link").map((i) => i.page_id)).size;
  const ok = pages.length * 4 - noDescription.length - stale.length - drafts.length - brokenPages;
  return { score: Math.round((ok / (pages.length * 4)) * 100), issues, passed, checks, total: pages.length };
}
