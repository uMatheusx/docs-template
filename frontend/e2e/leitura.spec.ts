import { expect, test } from "@playwright/test";

import { findPage, loginAs, unique } from "./fixtures";

test("home lista as seções e leva a uma página pela barra lateral", async ({ page }) => {
  await page.goto("/docs");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Contas, acessos e identidade");

  await page.getByRole("navigation", { name: "Navegação da documentação" }).getByRole("link", { name: "Arquitetura" }).click();
  await expect(page).toHaveURL(/\/docs\/arquitetura$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Arquitetura");
});

test("busca pelo Ctrl+K encontra a página mesmo sem acento", async ({ page }) => {
  await page.goto("/docs");
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder("Busque páginas, conteúdo ou ações…").fill("autenticacao");
  await page.getByRole("option", { name: /Autenticação/ }).first().click();
  await expect(page).toHaveURL(/\/docs\/guias\/autenticacao$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Autenticação");
});

test("endereço antigo de uma página renomeada leva ao novo", async ({ page }) => {
  await loginAs(page, "admin");
  const faq = await findPage(page.request, "faq");
  const slug = `duvidas-${unique()}`;
  const res = await page.request.put(`/api/admin/pages/${faq.id}`, { data: { slug, version: faq.version } });
  expect(res.ok()).toBeTruthy();

  await page.context().clearCookies(); // como leitor
  await page.goto("/docs/faq#como-funciona");
  await expect(page).toHaveURL(new RegExp(`/docs/${slug}#como-funciona$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Perguntas frequentes");

  // volta o slug para não afetar os outros testes
  await loginAs(page, "admin");
  const current = await findPage(page.request, slug);
  await page.request.put(`/api/admin/pages/${current.id}`, { data: { slug: "faq", version: current.version } });
});
