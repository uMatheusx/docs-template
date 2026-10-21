import { expect, test } from "@playwright/test";

import { appendToEditor, changeViaReview, findPage, loginAs, unique } from "./fixtures";

const BASE = "# Guia\n\nIntrodução.\n\nPasso um.\n\nPasso dois.\n\nPasso três.\n\nConclusão.\n";

test("Salvar guarda neste navegador: dá para trocar de página e voltar, e só então enviar para revisão", async ({ page }) => {
  await loginAs(page, "admin");
  const guia = await findPage(page.request, "guia-de-escrita");
  await page.goto(`/admin/pages/${guia.id}`);

  // em página publicada o Salvar é local e não publica nada
  await appendToEditor(page, "\n\nTexto salvo só neste navegador.");

  // antes de salvar não dá para enviar, e o histórico fala em alterações não salvas
  await expect(page.getByRole("button", { name: "Enviar para revisão" })).toBeDisabled();
  await page.getByRole("button", { name: "Histórico de versões" }).click();
  await expect(page.getByText(/Você tem alterações não salvas no editor/)).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: /^Salvar/ }).click();
  await expect(page.getByText("Salvo neste navegador · não enviado")).toBeVisible();

  // salvo: agora dá para enviar, e o histórico diz que falta só enviar para revisão
  await expect(page.getByRole("button", { name: "Enviar para revisão" })).toBeEnabled();
  await page.getByRole("button", { name: "Histórico de versões" }).click();
  await expect(page.getByText(/alterações salvas que ainda não foram enviadas para revisão/)).toBeVisible();
  await expect(page.getByText(/Você tem alterações não salvas/)).toHaveCount(0);
  await page.keyboard.press("Escape");

  // sair não pede confirmação: está guardado
  await page.getByRole("link", { name: "Visão geral" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("alertdialog")).toHaveCount(0);

  // o leitor não vê nada, porque nada foi enviado
  const reader = await page.context().browser()!.newContext({ baseURL: "http://localhost:5175" });
  const readerPage = await reader.newPage();
  await readerPage.goto("/docs/guia-de-escrita");
  await expect(readerPage.getByText("Texto salvo só neste navegador.")).toHaveCount(0);
  await reader.close();

  // voltando, o rascunho local volta sozinho
  await page.goto(`/admin/pages/${guia.id}`);
  await expect(page.getByText("Rascunho local restaurado")).toBeVisible();
  await expect(page.getByText("Texto salvo só neste navegador.").first()).toBeVisible();
  await expect(page.getByText("Salvo neste navegador · não enviado")).toBeVisible();

  // enviar para revisão limpa o rascunho local
  await page.getByRole("button", { name: "Enviar para revisão" }).click();
  await page.getByLabel(/O que mudou e por quê/).fill("Acrescenta um texto ao guia.");
  await page.getByRole("button", { name: "Enviar proposta" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.goto(`/admin/pages/${guia.id}`);
  await expect(page.getByText("Rascunho local restaurado")).toHaveCount(0);

  // limpa: fecha a proposta para não interferir nos outros testes
  const reviews = await (await page.request.get(`/api/admin/reviews?state=active&page_id=${guia.id}`)).json();
  for (const r of reviews) await page.request.post(`/api/admin/reviews/${r.id}/close`);
});

test("proposta defasada: trechos livres se combinam e o revisor resolve o conflito escolhendo", async ({ page }) => {
  const id = unique();
  const title = `Mescla ${id}`;
  const slug = `mescla-${id}`;

  // página publicada com um texto conhecido
  await loginAs(page, "admin");
  const created = await (await page.request.post("/api/admin/pages", { data: { title, content: BASE } })).json();
  await changeViaReview(page.request, created.id, { fields: { published: true } });
  const published = await (await page.request.get(`/api/admin/pages/${created.id}`)).json();

  // a editora propõe mudar o "Passo dois" e a "Conclusão", partindo da versão atual
  await loginAs(page, "editora");
  const proposal = await page.request.post(`/api/admin/pages/${created.id}/reviews`, {
    data: {
      title: "Ajusta passo dois e conclusão",
      description: "Esclarece o passo dois e fecha o texto.",
      content: BASE.replace("Passo dois.", "Passo dois, da proposta.").replace("Conclusão.", "Conclusão da proposta."),
      fields: {},
      base_version: published.version,
    },
  });
  expect(proposal.ok(), await proposal.text()).toBeTruthy();

  // enquanto isso, um admin muda o mesmo "Passo dois" e a "Introdução" e aplica
  await loginAs(page, "admin");
  await changeViaReview(page.request, created.id, {
    content: BASE.replace("Passo dois.", "Passo dois, da página.").replace("Introdução.", "Introdução nova."),
  });

  // o revisor aprova e vê o conflito (só o "Passo dois"; o resto se combina sozinho)
  await page.goto("/admin/reviews");
  await page.getByText("Ajusta passo dois e conclusão").first().click();
  await page.getByRole("button", { name: "Aprovar" }).click();
  await expect(page.getByRole("heading", { name: "Resolver conflitos" })).toBeVisible();
  await expect(page.getByText("0 de 1 resolvidos")).toBeVisible();
  const apply = page.getByRole("button", { name: /Resolva 1 conflito/ });
  await expect(apply).toBeDisabled();

  // escolher "Manter os dois" libera o botão
  await page.getByRole("radio", { name: /Manter os dois/ }).click();
  await expect(page.getByText("1 de 1 resolvidos")).toBeVisible();
  await page.getByRole("button", { name: "Aplicar na página" }).click();
  await expect(page.getByText(/Aplicada|aplicada/).first()).toBeVisible();

  // a página tem as mudanças dos dois lados e os dois textos do conflito
  const reader = await page.context().browser()!.newContext({ baseURL: "http://localhost:5175" });
  const readerPage = await reader.newPage();
  await readerPage.goto(`/docs/${slug}`);
  await expect(readerPage.getByRole("heading", { level: 1 })).toHaveText("Guia");
  const body = readerPage.locator(".doc-prose");
  await expect(body).toContainText("Introdução nova.");
  await expect(body).toContainText("Passo dois, da página.");
  await expect(body).toContainText("Passo dois, da proposta.");
  await expect(body).toContainText("Conclusão da proposta.");
  await reader.close();
});

test("usar uma versão antiga no editor pede confirmação quando há algo pendente", async ({ page }) => {
  const title = `Versões ${unique()}`;
  await loginAs(page, "admin");
  const created = await (await page.request.post("/api/admin/pages", { data: { title, content: "# Versões\n\nTexto original.\n" } })).json();
  await changeViaReview(page.request, created.id, { fields: { published: true } });
  await changeViaReview(page.request, created.id, { content: "# Versões\n\nTexto novo.\n" });

  await page.goto(`/admin/pages/${created.id}`);
  const openOldVersion = async () => {
    await page.getByRole("button", { name: "Histórico de versões" }).click();
    await page.locator('[id^="version-"]').nth(1).click(); // a mais antiga
    await page.getByRole("button", { name: /Usar v\d+ no editor/ }).click();
  };

  // editor limpo: usa direto, sem perguntar
  await openOldVersion();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.getByText("Texto original.").first()).toBeVisible();

  // agora há uma alteração não salva (o texto antigo): usar de novo pergunta
  await openOldVersion();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm.getByText(/Usar a versão v\d+ no editor\?/)).toBeVisible();
  await expect(confirm.getByText(/alterações não salvas no editor serão perdidas/)).toBeVisible();
  await confirm.getByRole("button", { name: "Cancelar" }).click();
  await expect(confirm).toBeHidden();

  // o histórico continua aberto: confirmar aplica a versão e fecha tudo
  await page.getByRole("button", { name: /Usar v\d+ no editor/ }).click();
  await confirm.getByRole("button", { name: "Substituir e usar" }).click();
  await expect(confirm).toBeHidden();
  await expect(page.getByText("Texto original.").first()).toBeVisible();
});
