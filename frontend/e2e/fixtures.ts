import { expect, type APIRequestContext, type Page } from "@playwright/test";

/** Usuários do backend de teste (backend/e2e_server.py). */
export const USERS = {
  admin: { username: "admin", password: "e2e-admin-senha" },
  editora: { username: "edna", password: "e2e-editora-senha" },
} as const;

/** Entra pela API: o cookie de sessão vale para o navegador da página. */
export async function loginAs(page: Page, who: keyof typeof USERS) {
  await page.context().clearCookies();
  const res = await page.request.post("/api/auth/login", { data: USERS[who] });
  expect(res.ok(), await res.text()).toBeTruthy();
}

interface Node {
  id: string;
  path: string;
  version: number;
  children: Node[];
}

export async function findPage(request: APIRequestContext, pagePath: string): Promise<Node> {
  const tree: Node[] = await (await request.get("/api/admin/tree")).json();
  const stack = [...tree];
  while (stack.length) {
    const node = stack.shift()!;
    if (node.path === pagePath) return node;
    stack.push(...node.children);
  }
  throw new Error(`Página não encontrada: ${pagePath}`);
}

/**
 * Muda uma página pelo caminho obrigatório (proposta → aprovação → aplicação), direto pela API.
 * Quem está logado aprova a própria proposta.
 */
export async function changeViaReview(
  request: APIRequestContext,
  pageId: string,
  change: { content?: string; fields?: Record<string, unknown> },
) {
  const page = await (await request.get(`/api/admin/pages/${pageId}`)).json();
  const created = await request.post(`/api/admin/pages/${pageId}/reviews`, {
    data: {
      title: "Alteração de teste",
      description: "Feita pelo caminho de revisão.",
      content: change.content ?? null,
      fields: change.fields ?? {},
      base_version: page.version,
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const review = await created.json();
  expect((await request.post(`/api/admin/reviews/${review.id}/approve`, { data: {} })).ok()).toBeTruthy();
  const merged = await request.post(`/api/admin/reviews/${review.id}/merge`, { data: {} });
  expect(merged.ok(), await merged.text()).toBeTruthy();
}

/** Acrescenta texto ao fim do editor de markdown (CodeMirror). */
export async function appendToEditor(page: Page, text: string) {
  const editor = page.locator(".cm-content").first();
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(text);
}

/** Aprova e aplica a primeira proposta aberta que contém `title`, pela tela de Revisões. */
export async function approveAndApply(page: Page, title: string) {
  await page.goto("/admin/reviews");
  await page.getByText(title).first().click();
  await page.getByRole("button", { name: "Aprovar" }).click();
  await page.getByRole("button", { name: "Aplicar na página" }).click();
  const confirm = page.getByRole("alertdialog");
  if (await confirm.isVisible().catch(() => false)) await confirm.getByRole("button", { name: /Aplicar/ }).click();
  await expect(page.getByText(/Aplicada|aplicada/).first()).toBeVisible();
}

/** Sufixo único: os testes compartilham o backend e não podem colidir. */
export const unique = () => Date.now().toString(36);

/** No editor de uma página publicada e já salva: Enviar para revisão abre a tela Alterações; envia só ela. */
export async function sendFromChanges(page: Page, description: string) {
  await page.getByRole("button", { name: "Enviar para revisão" }).click();
  await expect(page).toHaveURL(/\/admin\/changes/);
  await page.getByLabel(/O que mudou e por quê/).fill(description);
  await page.getByRole("button", { name: /Enviar para revisão \(1\)/ }).click();
  await expect(page.getByTestId("change-row").filter({ hasText: "Enviada para revisão" })).toHaveCount(1);
}
