import { expect, test } from "@playwright/test";

import { appendToEditor, approveAndApply, changeViaReview, findPage, loginAs, sendFromChanges, unique } from "./fixtures";

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
  await expect(page.getByRole("switch")).toHaveCount(0); // rascunho não tem chave: o estado é só informativo
  await page.getByRole("button", { name: /^Salvar/ }).first().click();
  await expect(page.getByText(/Salvo/).first()).toBeVisible();

  // enviar para revisão pedindo a publicação: a descrição é obrigatória
  await page.getByRole("button", { name: "Pedir publicação", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/changes/);
  const enviar = page.getByRole("button", { name: /Enviar para revisão \(1\)/ });
  await expect(enviar).toBeDisabled(); // sem descrição, não envia
  await page.getByLabel(/O que mudou e por quê/).fill("Primeira versão do glossário.");
  await enviar.click();
  await expect(page.getByTestId("change-row").filter({ hasText: "Enviada para revisão" })).toHaveCount(1);

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

  // "Salvar" existe, mas é local: não há "Salvar com descrição" (versão no servidor) e nada é gravado na página
  await expect(page.getByRole("button", { name: "Salvar com descrição" })).toHaveCount(0);
  await page.getByRole("button", { name: /^Salvar/ }).click();
  await expect(page.getByText("Salvo neste navegador · não enviado")).toBeVisible();
  const after = await (await page.request.get(`/api/admin/pages/${faq.id}`)).json();
  expect(after.version).toBe(faq.version);
  expect(after.content).not.toContain("Texto que não vai direto.");

  await page.getByRole("button", { name: "Enviar para revisão" }).click();
  await expect(page).toHaveURL(/\/admin\/changes/);
  await page.goBack();

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
  await page.getByRole("button", { name: /^Salvar/ }).click(); // só se envia o que foi salvo
  await sendFromChanges(page, "Teste de ponta a ponta do fluxo de revisão.");

  // leitor ainda não vê a mudança
  await page.context().clearCookies();
  await page.goto("/docs/faq");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Perguntas frequentes");
  await expect(page.getByText(marker)).toHaveCount(0);

  // admin aprova e aplica
  await loginAs(page, "admin");
  await approveAndApply(page, "Atualiza FAQ");

  // leitor vê o texto novo
  await page.context().clearCookies();
  await page.goto("/docs/faq");
  await expect(page.getByText(marker)).toBeVisible();
});

test("voltar uma página publicada para rascunho também passa por revisão", async ({ page }) => {
  const id = unique();
  const title = `Provisória ${id}`;
  await loginAs(page, "admin");
  const created = await (await page.request.post("/api/admin/pages", { data: { title, content: `# ${title}

Texto.` } })).json();
  await changeViaReview(page.request, created.id, { fields: { published: true } });

  await page.goto(`/admin/pages/${created.id}`);
  await page.getByRole("switch").first().click(); // Publicada -> Rascunho
  await page.getByRole("button", { name: /^Salvar/ }).click(); // só se envia o que foi salvo
  await page.getByRole("button", { name: "Enviar para revisão" }).click();
  const row = page.getByTestId("change-row").filter({ hasText: title });
  await expect(row).toContainText("Altera publicação");
  await page.getByLabel(/O que mudou e por quê/).fill("Tirando do ar até revisar o texto.");
  await page.getByRole("button", { name: /Enviar para revisão \(1\)/ }).click();
  await expect(row).toContainText("Enviada para revisão");

  // ainda publicada até a proposta ser aplicada
  await page.context().clearCookies();
  await page.goto(`/docs/${created.slug}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);

  await loginAs(page, "admin");
  await approveAndApply(page, `Atualiza ${title}`);
  await page.context().clearCookies();
  await page.goto(`/docs/${created.slug}`);
  await expect(page.getByRole("heading", { name: "Página não encontrada" })).toBeVisible();
});

test("proposta carregada no editor não conta como alteração não salva", async ({ page }) => {
  await loginAs(page, "editora");
  const arquitetura = await findPage(page.request, "arquitetura");
  await page.goto(`/admin/pages/${arquitetura.id}`);
  await appendToEditor(page, "\n\nTexto guardado na proposta.");
  await page.getByRole("button", { name: /^Salvar/ }).click(); // só se envia o que foi salvo
  await sendFromChanges(page, "Proposta para testar o carregamento.");
  await page.goBack();

  // carregar a proposta: o texto volta ao editor e o estado mostra a proposta, não "não salvo"
  await page.getByRole("button", { name: "Carregar no editor" }).click();
  await expect(page.getByText("Texto guardado na proposta.").first()).toBeVisible();
  await expect(page.getByText(/Proposta #\d+ carregada/)).toBeVisible();
  await expect(page.getByText(/não salva/)).toHaveCount(0);

  // sair da página não pede confirmação: nada se perde, está na proposta
  await page.getByRole("link", { name: "Visão geral" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("alertdialog")).toHaveCount(0);

  // editar além da proposta volta a avisar, e o aviso diz do que se trata
  await page.goto(`/admin/pages/${arquitetura.id}`);
  await page.getByRole("button", { name: "Carregar no editor" }).click();
  await appendToEditor(page, " Mais uma frase.");
  await expect(page.getByText(/além da proposta #\d+/)).toBeVisible();

  // carregar de novo com alterações no editor pede confirmação; cancelar mantém o que está lá
  await page.getByRole("button", { name: "Carregar no editor" }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm.getByText(/Tudo que está no editor agora será substituído/)).toBeVisible();
  await expect(confirm.getByText(/alterações ainda não salvas serão perdidas/)).toBeVisible();
  await confirm.getByRole("button", { name: "Manter o que está no editor" }).click();
  await expect(confirm).toBeHidden();
  await expect(page.getByText(/além da proposta #\d+/)).toBeVisible();

  // confirmar substitui pelo conteúdo da proposta
  await page.getByRole("button", { name: "Carregar no editor" }).click();
  await confirm.getByRole("button", { name: "Substituir e carregar" }).click();
  await expect(page.getByText(/Proposta #\d+ carregada/)).toBeVisible();
  await expect(page.getByText("Mais uma frase.")).toHaveCount(0);

  // sem nada a perder (já é a proposta), carregar não pergunta nada
  await page.getByRole("button", { name: "Carregar no editor" }).click();
  await expect(confirm).toHaveCount(0);

  // sair com alterações não pergunta nada: elas ficam guardadas neste navegador e voltam sozinhas
  await appendToEditor(page, " Terceira frase.");
  await page.getByRole("link", { name: "Visão geral" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("alertdialog")).toHaveCount(0);

  // limpa: fecha a proposta para não interferir nos outros testes
  const reviews = await (await page.request.get(`/api/admin/reviews?state=active&page_id=${arquitetura.id}`)).json();
  for (const r of reviews) await page.request.post(`/api/admin/reviews/${r.id}/close`);
});
