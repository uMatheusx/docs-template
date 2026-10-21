import { expect, test } from "@playwright/test";

import { appendToEditor, approveAndApply, findPage, loginAs, unique } from "./fixtures";

test("admin cria um rascunho, pede publicação com descrição, aprova a própria proposta e o leitor vê", async ({ page }) => {
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

  // rascunho: salva direto, mas a publicação não pode ser ligada na hora
  await appendToEditor(page, `\nTermo de teste ${id}.`);
  await expect(page.getByRole("switch").first()).toBeDisabled();
  await page.getByRole("button", { name: /^Salvar/ }).first().click();
  await expect(page.getByText(/Salvo/).first()).toBeVisible();

  // enviar para revisão pedindo a publicação: a descrição é obrigatória
  await page.getByRole("button", { name: "Pedir publicação", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("switch")).toBeChecked(); // já vem pedindo a publicação
  await dialog.getByRole("button", { name: "Enviar proposta" }).click();
  await expect(dialog).toBeVisible(); // sem descrição, o formulário não envia
  await dialog.getByLabel(/O que mudou e por quê/).fill("Primeira versão do glossário.");
  await dialog.getByRole("button", { name: "Enviar proposta" }).click();
  await expect(dialog).toBeHidden();

  // ainda é rascunho: o leitor não vê
  await page.context().clearCookies();
  await page.goto(`/docs/glossario-${id}`);
  await expect(page.getByRole("heading", { name: "Página não encontrada" })).toBeVisible();

  // o próprio autor aprova e aplica
  await loginAs(page, "admin");
  await approveAndApply(page, `Atualiza ${title}`);

  await page.context().clearCookies();
  await page.goto(`/docs/glossario-${id}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
  await expect(page.getByText(`Termo de teste ${id}.`)).toBeVisible();
});

test("em página publicada nem o admin salva direto: só envia para revisão", async ({ page }) => {
  await loginAs(page, "admin");
  const faq = await findPage(page.request, "faq");
  await page.goto(`/admin/pages/${faq.id}`);
  await appendToEditor(page, "\n\nTexto que não vai direto.");

  await expect(page.getByRole("button", { name: /^Salvar/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Enviar para revisão" }).click();
  await expect(page.getByRole("dialog").getByLabel(/O que mudou e por quê/)).toBeVisible();
  await page.keyboard.press("Escape");

  // a API também recusa a gravação direta
  const res = await page.request.put(`/api/admin/pages/${faq.id}`, { data: { content: "# direto", version: faq.version } });
  expect(res.status()).toBe(403);
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
  await page.getByLabel(/O que mudou e por quê/).fill("Teste de ponta a ponta do fluxo de revisão.");
  await page.getByRole("button", { name: "Enviar proposta" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();

  // leitor ainda não vê a mudança
  await page.context().clearCookies();
  await page.goto("/docs/faq");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Perguntas frequentes");
  await expect(page.getByText(marker)).toHaveCount(0);

  // admin aprova e aplica
  await loginAs(page, "admin");
  await approveAndApply(page, "Acrescenta uma linha ao FAQ");

  // leitor vê o texto novo
  await page.context().clearCookies();
  await page.goto("/docs/faq");
  await expect(page.getByText(marker)).toBeVisible();
});
