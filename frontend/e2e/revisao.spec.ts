import { expect, test } from "@playwright/test";

import { appendToEditor, changeViaReview, findPage, loginAs, unique } from "./fixtures";

const BASE = "# Guia\n\nIntrodução.\n\nPasso um.\n\nPasso dois.\n\nPasso três.\n\nConclusão.\n";

test("Salvar guarda neste navegador: dá para trocar de página e voltar, e só então enviar para revisão", async ({ page }) => {
  await loginAs(page, "admin");
  const guia = await findPage(page.request, "guia-de-escrita");
  await page.goto(`/admin/pages/${guia.id}`);

  // em página publicada o Salvar é local e não publica nada
  await appendToEditor(page, "\n\nTexto salvo só neste navegador.");
  await page.getByRole("button", { name: /^Salvar/ }).click();
  await expect(page.getByText("Salvo neste navegador · não enviado")).toBeVisible();

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
