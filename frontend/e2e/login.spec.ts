import { expect, test } from "@playwright/test";

import { USERS } from "./fixtures";

test("senha errada mostra o erro e não entra", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Usuário").fill(USERS.admin.username);
  await page.getByLabel("Senha", { exact: true }).fill("senha-errada");
  await page.getByRole("button", { name: "Entrar no Studio" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("login leva ao painel do Studio", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Usuário").fill(USERS.admin.username);
  await page.getByLabel("Senha", { exact: true }).fill(USERS.admin.password);
  await page.getByRole("button", { name: "Entrar no Studio" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Sua documentação tem");
});
