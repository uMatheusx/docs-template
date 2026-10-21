import { expect, test } from "@playwright/test";

import { findPage, loginAs, unique } from "./fixtures";

const contrato = (title: string) =>
  [
    "openapi: 3.0.3",
    "info:",
    `  title: ${title}`,
    "  version: '1.0'",
    "paths:",
    "  /contratos-e2e:",
    "    get:",
    "      summary: Lista os contratos",
    "      responses:",
    "        '200':",
    "          description: ok",
    "",
  ].join("\n");

test("arquivos: sobe um contrato OpenAPI e um PDF, e referencia o contrato numa página pelo /", async ({ page }) => {
  const id = unique();
  const name = `contrato-${id}.yaml`;
  await loginAs(page, "admin");
  await page.goto("/admin/media");
  await expect(page.getByRole("heading", { name: "Arquivos" })).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles([
    { name, mimeType: "application/yaml", buffer: Buffer.from(contrato(`Contratos ${id}`)) },
    { name: `acordo-${id}.pdf`, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 acordo") },
  ]);

  // o contrato é reconhecido; o PDF fica em "Outros arquivos"
  await expect(page.getByText("Contrato OpenAPI reconhecido")).toBeVisible();
  const specRow = page.getByTestId("file-row").filter({ hasText: name });
  await expect(specRow).toContainText("OpenAPI");
  await expect(specRow.getByRole("button", { name: "Copiar referência" })).toBeVisible();
  await page.getByRole("tab", { name: /Outros arquivos/ }).click();
  await expect(page.getByTestId("file-row").filter({ hasText: `acordo-${id}.pdf` })).toBeVisible();
  await expect(page.getByTestId("file-row").filter({ hasText: name })).toHaveCount(0);

  // numa página, "/" → Referência OpenAPI lista o contrato enviado
  const faq = await findPage(page.request, "faq");
  await page.goto(`/admin/pages/${faq.id}`);
  const editor = page.locator(".cm-content").first();
  const menu = page.locator(".cm-tooltip-autocomplete");
  const accept = async () => {
    await page.waitForTimeout(150);
    await page.keyboard.press("Enter");
  };
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("\n\n/openapi");
  await expect(menu).toContainText("Referência OpenAPI");
  await accept();
  await expect(menu).toContainText(name);
  await page.keyboard.type(`contrato-${id}`); // filtra pelo nome do arquivo
  await expect(menu).not.toContainText("API REST do Account Hub");
  await accept();
  await expect(editor).toContainText("ref: /api/assets/");
  await expect(editor).toContainText("# Opcional: use operations ou tags"); // a dica das chaves já vem no bloco

  // quem não conhece as chaves as descobre digitando no início de uma linha do bloco
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("End");
  await page.keyboard.type("\no");
  await expect(menu).toContainText("operations");
  await expect(menu).toContainText("só algumas operações");
  await expect(menu).not.toContainText("ref"); // já existe no bloco
  await accept();
  await expect(menu).toContainText("GET /contratos-e2e"); // e já lista as operações do contrato
  await accept();
  await expect(editor).toContainText("- GET /contratos-e2e");

  // a prévia mostra a especificação vinda do arquivo
  await page.getByRole("button", { name: "Ler", exact: true }).click();
  await expect(page.getByText("/contratos-e2e").first()).toBeVisible();

  // "/" → Link para arquivo lista o PDF
  await page.getByRole("button", { name: "Escrever", exact: true }).click();
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("\n\n/arquivo");
  await expect(menu).toContainText("Link para arquivo");
  await accept();
  await expect(menu).toContainText(`acordo-${id}.pdf`);
  await page.keyboard.type(`acordo-${id}`);
  await accept();
  await expect(editor).toContainText(`[acordo-${id}.pdf](/api/assets/`);

  // limpeza: o rascunho local e os arquivos de teste
  await page.evaluate((pageId) => localStorage.removeItem(`ah-draft:${pageId}`), faq.id);
  const assets: { id: string; name: string }[] = await (await page.request.get("/api/admin/assets")).json();
  for (const a of assets.filter((x) => x.name.includes(id))) await page.request.delete(`/api/admin/assets/${a.id}/${a.name}`);
});
