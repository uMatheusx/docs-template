import { expect, test } from "@playwright/test";

import { appendToEditor, findPage, loginAs, unique } from "./fixtures";

test("admin cria e publica uma página, e o leitor a vê", async ({ page }) => {
  const id = unique();
  const title = `Glossário ${id}`;
  await loginAs(page, "admin");
  await page.goto("/admin/pages");

  await expect(page.getByRole("heading", { name: "O que vamos escrever hoje?" })).toBeVisible();
  await page.getByRole("button", { name: "Nova página", exact: true }).last().click(); // o do meio da tela
  await page.getByRole("button", { name: /Página em branco/ }).click();
  await page.getByLabel("Título").fill(title);
  await page.getByRole("button", { name: "Criar página" }).click();
  await expect(page).toHaveURL(/\/admin\/pages\/[0-9a-f]+$/);

  await appendToEditor(page, `\nTermo de teste ${id}.`);
  await page.getByRole("switch").first().click(); // Rascunho -> Publicada
  await expect(page.getByText("Publicada", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: /^Salvar/ }).first().click();
  await expect(page.getByText(/Salvo/).first()).toBeVisible();

  await page.context().clearCookies(); // como leitor
  await page.goto(`/docs/glossario-${id}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
  await expect(page.getByText(`Termo de teste ${id}.`)).toBeVisible();
});

test("editora propõe uma mudança, o admin aprova e aplica", async ({ page }) => {
  const marker = `Atualizado via revisão ${unique()}.`;

  // editora: páginas publicadas só mudam por proposta
  await loginAs(page, "editora");
  const faq = await findPage(page.request, "faq");
  await page.goto(`/admin/pages/${faq.id}`);
  await appendToEditor(page, `\n\n${marker}`);
  await page.getByRole("button", { name: "Enviar para revisão" }).click();
  await page.getByLabel("Resumo").fill("Acrescenta uma linha ao FAQ");
  await page.getByLabel("O que mudou e por quê").fill("Teste de ponta a ponta do fluxo de revisão.");
  await page.getByRole("button", { name: "Enviar proposta" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();

  // leitor ainda não vê a mudança
  await page.context().clearCookies();
  await page.goto("/docs/faq");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Perguntas frequentes");
  await expect(page.getByText(marker)).toHaveCount(0);

  // admin aprova e aplica
  await loginAs(page, "admin");
  await page.goto("/admin/reviews");
  await page.getByText("Acrescenta uma linha ao FAQ").first().click();
  await page.getByRole("button", { name: "Aprovar" }).click();
  await page.getByRole("button", { name: "Aplicar na página" }).click();
  const confirm = page.getByRole("alertdialog");
  if (await confirm.isVisible().catch(() => false)) await confirm.getByRole("button", { name: /Aplicar/ }).click();
  await expect(page.getByText(/Aplicada|aplicada/).first()).toBeVisible();

  // leitor vê o texto novo
  await page.context().clearCookies();
  await page.goto("/docs/faq");
  await expect(page.getByText(marker)).toBeVisible();
});
