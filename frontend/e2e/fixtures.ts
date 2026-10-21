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

/** Acrescenta texto ao fim do editor de markdown (CodeMirror). */
export async function appendToEditor(page: Page, text: string) {
  const editor = page.locator(".cm-content").first();
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(text);
}

/** Sufixo único: os testes compartilham o backend e não podem colidir. */
export const unique = () => Date.now().toString(36);
