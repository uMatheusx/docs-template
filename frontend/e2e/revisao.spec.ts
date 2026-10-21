import { expect, test } from "@playwright/test";

import { appendToEditor, approveAndApply, changeViaReview, findPage, loginAs, unique } from "./fixtures";

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
  await expect(page.getByText("Texto salvo só neste navegador.").first()).toBeVisible();
  await expect(page.getByText("Salvo neste navegador · não enviado")).toBeVisible();

  // enviar para revisão limpa o rascunho local
  await page.getByRole("button", { name: "Enviar para revisão" }).click();
  await page.getByLabel(/O que mudou e por quê/).fill("Acrescenta um texto ao guia.");
  await page.getByRole("button", { name: "Enviar proposta" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.goto(`/admin/pages/${guia.id}`);

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
    await page.getByRole("button", { name: /Usar \d+\.\d+\.\d+ no editor/ }).click();
  };

  // editor limpo: usa direto, sem perguntar
  await openOldVersion();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.getByText("Texto original.").first()).toBeVisible();

  // agora há uma alteração não salva (o texto antigo): usar de novo pergunta
  await openOldVersion();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm.getByText(/Usar a versão \d+\.\d+\.\d+ no editor\?/)).toBeVisible();
  await expect(confirm.getByText(/alterações não salvas no editor serão perdidas/)).toBeVisible();
  await confirm.getByRole("button", { name: "Cancelar" }).click();
  await expect(confirm).toBeHidden();

  // o histórico continua aberto: confirmar aplica a versão e fecha tudo
  await page.getByRole("button", { name: /Usar \d+\.\d+\.\d+ no editor/ }).click();
  await confirm.getByRole("button", { name: "Substituir e usar" }).click();
  await expect(confirm).toBeHidden();
  await expect(page.getByText("Texto original.").first()).toBeVisible();
});

test("versões x.y.z: rascunho 0.1.0, primeira publicação 1.0.0 e uma novidade leva a 1.1.0", async ({ page }) => {
  const title = `Versionada ${unique()}`;
  const slug = title.toLowerCase().replace(/ /g, "-");
  await loginAs(page, "admin");
  const created = await (await page.request.post("/api/admin/pages", { data: { title, content: `# ${title}\n\nTexto.\n` } })).json();
  expect(created.semver).toBe("0.1.0");

  const readerFooter = async () => {
    const reader = await page.context().browser()!.newContext({ baseURL: "http://localhost:5175" });
    const readerPage = await reader.newPage();
    await readerPage.goto(`/docs/${slug}`);
    const text = await readerPage.getByText(/Atualizado em .*, versão /).textContent();
    await reader.close();
    return text ?? "";
  };

  // rascunho: a versão aparece no editor; pedir publicação mostra que a primeira publicação é a 1.0.0
  await page.goto(`/admin/pages/${created.id}`);
  await expect(page.getByRole("button", { name: "Histórico de versões" })).toContainText("0.1.0");
  await page.getByRole("button", { name: "Pedir publicação", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/A primeira publicação da página é a versão/)).toBeVisible();
  await expect(dialog.getByRole("radio", { name: /Novidade/ })).toBeDisabled();
  await dialog.getByLabel(/O que mudou e por quê/).fill("Primeira publicação.");
  await dialog.getByRole("button", { name: "Enviar proposta" }).click();
  await expect(dialog).toBeHidden();
  await approveAndApply(page, `Atualiza ${title}`);
  expect(await readerFooter()).toContain("versão 1.0.0");

  // página publicada: escolher "Novidade" mostra a prévia 1.0.0 → 1.1.0
  await page.goto(`/admin/pages/${created.id}`);
  await appendToEditor(page, "\n\nConteúdo novo.");
  await page.getByRole("button", { name: /^Salvar/ }).click();
  await page.getByRole("button", { name: "Enviar para revisão" }).click();
  await dialog.getByRole("radio", { name: /Novidade/ }).click();
  await expect(dialog.getByText("1.1.0")).toBeVisible();
  await dialog.getByLabel(/O que mudou e por quê/).fill("Acrescenta uma seção.");
  await dialog.getByRole("button", { name: "Enviar proposta" }).click();
  await expect(dialog).toBeHidden();

  // a revisão mostra o tamanho da mudança e a próxima versão; ao aplicar vira 1.1.0
  await page.goto("/admin/reviews");
  await page.getByText(`Atualiza ${title}`).first().click();
  await expect(page.getByText(/novidade:/)).toBeVisible();
  await page.getByRole("button", { name: "Aprovar" }).click();
  await page.getByRole("button", { name: "Aplicar na página" }).click();
  await expect(page.getByText(/Aplicada como/).first()).toBeVisible();
  expect(await readerFooter()).toContain("versão 1.1.0");
});

test("trocar a versão à mão: o autor muda o y, o revisor muda o x ao aplicar", async ({ page }) => {
  const title = `Manual ${unique()}`;
  const slug = title.toLowerCase().replace(/ /g, "-");
  await loginAs(page, "admin");
  const created = await (await page.request.post("/api/admin/pages", { data: { title, content: `# ${title}\n\nTexto.\n` } })).json();
  await changeViaReview(page.request, created.id, { fields: { published: true } }); // 1.0.0

  await page.goto(`/admin/pages/${created.id}`);
  await appendToEditor(page, "\n\nMais um trecho.");
  await page.getByRole("button", { name: /^Salvar/ }).click();
  await page.getByRole("button", { name: "Enviar para revisão" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/O que mudou e por quê/).fill("Teste de versão escolhida.");

  // padrão: a recomendada (correção = 1.0.1); trocar o y vira 1.4.1 e diz que foi escolhida
  await expect(dialog.getByLabel("Principal (x)")).toHaveValue("1");
  await expect(dialog.getByLabel("Secundário (y)")).toHaveValue("0");
  await expect(dialog.getByLabel("Correção (z)")).toHaveValue("1");
  await dialog.getByLabel("Secundário (y)").fill("4");
  await expect(dialog.getByText(/Escolhida por você/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Usar a recomendada \(1\.0\.1\)/ })).toBeVisible();

  // versão que não é maior que a atual é recusada na hora
  await dialog.getByLabel("Principal (x)").fill("0");
  await expect(dialog.getByRole("alert")).toContainText("Precisa ser maior que a versão atual (1.0.0)");
  await expect(dialog.getByRole("button", { name: "Enviar proposta" })).toBeDisabled();
  await dialog.getByLabel("Principal (x)").fill("1");

  // mudar o tamanho volta para a recomendada
  await dialog.getByRole("radio", { name: /Novidade/ }).click();
  await expect(dialog.getByLabel("Secundário (y)")).toHaveValue("1");
  await dialog.getByLabel("Secundário (y)").fill("4");
  await dialog.getByRole("button", { name: "Enviar proposta" }).click();
  await expect(dialog).toBeHidden();

  // o revisor vê a escolha do autor (1.4.0) e a troca antes de aplicar
  await page.goto("/admin/reviews");
  await page.getByText(`Atualiza ${title}`).first().click();
  await page.getByRole("button", { name: "Aprovar" }).click();
  const section = page.getByRole("region", { name: "Versão resultante" });
  await expect(section.getByLabel("Secundário (y)")).toHaveValue("4");
  await section.getByLabel("Principal (x)").fill("2");
  await expect(section.getByText(/Escolhida por você/)).toBeVisible();
  await page.getByRole("button", { name: "Aplicar na página" }).click();
  await expect(page.getByText(/Aplicada como/).first()).toBeVisible();
  await expect(page.getByText("2.4.0").first()).toBeVisible();

  const reader = await page.context().browser()!.newContext({ baseURL: "http://localhost:5175" });
  const readerPage = await reader.newPage();
  await readerPage.goto(`/docs/${slug}`);
  await expect(readerPage.getByText(/Atualizado em .*, versão 2\.4\.0/)).toBeVisible();
  await reader.close();
});

test("o que está sendo editado é guardado sozinho: sair e voltar traz de volta, ainda como não salvo", async ({ page }) => {
  await loginAs(page, "admin");
  const faq = await findPage(page.request, "faq");
  await page.goto(`/admin/pages/${faq.id}`);
  await appendToEditor(page, "\n\nTexto digitado, sem apertar Salvar.");

  // sair logo em seguida (antes do intervalo da gravação automática) não pergunta nada
  await page.getByRole("link", { name: "Visão geral" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("alertdialog")).toHaveCount(0);

  // voltar: o texto está lá, sem faixa de "Recuperar", e continua marcado como não salvo
  await page.goto(`/admin/pages/${faq.id}`);
  await expect(page.getByText("Texto digitado, sem apertar Salvar.").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Recuperar" })).toHaveCount(0);
  await expect(page.getByText(/alteração\(ões\) não salva\(s\)/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Enviar para revisão" })).toBeDisabled(); // ainda precisa Salvar

  // salvar passa para "salvo neste navegador" e libera o envio
  await page.getByRole("button", { name: /^Salvar/ }).click();
  await expect(page.getByText("Salvo neste navegador · não enviado")).toBeVisible();
  await expect(page.getByRole("button", { name: "Enviar para revisão" })).toBeEnabled();

  // descartar volta ao que está publicado e apaga o que estava guardado
  await page.getByRole("button", { name: "Mais ações" }).click();
  await page.getByRole("menuitem", { name: /Descartar alterações/ }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Descartar" }).click();
  await expect(page.getByText("Texto digitado, sem apertar Salvar.")).toHaveCount(0);
  await page.goto(`/admin/pages/${faq.id}`);
  await expect(page.getByText("Texto digitado, sem apertar Salvar.")).toHaveCount(0);
});

test("letras de situação na árvore: P → M → S → E, com o nome por extenso ao passar o mouse", async ({ page }) => {
  await loginAs(page, "admin");
  const arquitetura = await findPage(page.request, "arquitetura");
  await page.goto(`/admin/pages/${arquitetura.id}`);
  const row = page.locator("li").filter({ hasText: /^Arquitetura/ }).first();

  // publicada, sem mudanças: só o P
  await expect(row.locator('[data-status="published"]')).toBeVisible();
  await expect(row.locator('[data-status="modified"]')).toHaveCount(0);

  // editou e ainda não salvou: aparece o M, e o hover diz o que significa
  await appendToEditor(page, "\n\nTexto para a árvore.");
  const modified = row.locator('[data-status="modified"]');
  await expect(modified).toBeVisible();
  await modified.hover();
  await expect(page.getByRole("tooltip")).toContainText("Modificada: alterações ainda não salvas");

  // salvou (neste navegador): M vira S
  await page.getByRole("button", { name: /^Salvar/ }).click();
  await expect(row.locator('[data-status="saved"]')).toBeVisible();
  await expect(modified).toHaveCount(0);
  await row.locator('[data-status="saved"]').hover();
  await expect(page.getByRole("tooltip")).toContainText("Salva: salva neste navegador");

  // enviou para revisão: some o S e aparece o E
  await page.getByRole("button", { name: "Enviar para revisão" }).click();
  await page.getByLabel(/O que mudou e por quê/).fill("Teste das letras de situação.");
  await page.getByRole("button", { name: "Enviar proposta" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(row.locator('[data-status="review"]')).toBeVisible();
  await expect(row.locator('[data-status="saved"]')).toHaveCount(0);
  await row.locator('[data-status="review"]').hover();
  await expect(page.getByRole("tooltip")).toContainText("Em revisão: há uma proposta");

  // limpa: fecha a proposta para não interferir nos outros testes
  const reviews = await (await page.request.get(`/api/admin/reviews?state=active&page_id=${arquitetura.id}`)).json();
  for (const r of reviews) await page.request.post(`/api/admin/reviews/${r.id}/close`);
});

test("digitar / no editor oferece link para página e lista as páginas conforme se digita", async ({ page }) => {
  await loginAs(page, "admin");
  const faq = await findPage(page.request, "faq");
  await page.goto(`/admin/pages/${faq.id}`);
  const editor = page.locator(".cm-content").first();
  const menu = page.locator(".cm-tooltip-autocomplete");

  // "/" sozinho: o item "Link para página" e as páginas existentes
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("\n\n/");
  await expect(menu).toBeVisible();
  await expect(menu).toContainText("Link para página");
  await expect(menu).toContainText("Arquitetura");
  await expect(menu).toContainText("Autenticação");
  await expect(menu).not.toContainText("Perguntas frequentes"); // a própria página não é oferecida

  // digitar filtra; Enter insere o link markdown com o endereço da página
  await page.keyboard.type("autentic");
  await expect(menu).toContainText("Autenticação");
  await expect(menu).not.toContainText("Arquitetura");
  await page.waitForTimeout(150); // o menu só aceita Enter depois de um instante (evita aceitar sem querer)
  await page.keyboard.press("Enter");
  await expect(editor).toContainText("[Autenticação](/docs/guias/autenticacao)");

  // "Link para página": a lista passa a mostrar só páginas (sem os blocos)
  await page.keyboard.type("\n\n/link");
  await expect(menu).toContainText("Link para página");
  await page.waitForTimeout(150); // o menu só aceita Enter depois de um instante (evita aceitar sem querer)
  await page.keyboard.press("Enter");
  await expect(menu).toBeVisible();
  await expect(menu).toContainText("Arquitetura");
  await expect(menu).not.toContainText("Alerta");
  await page.keyboard.type("arquitet");
  await expect(menu).toContainText("Arquitetura");
  await page.waitForTimeout(150);
  await page.keyboard.press("Enter");
  await expect(editor).toContainText("[Arquitetura](/docs/arquitetura)");

  // sem salvar: descarta para não deixar rascunho local na página de teste
  await page.evaluate((id) => localStorage.removeItem(`ah-draft:${id}`), faq.id);
});

test("referências de API: escolhe a especificação e as sugestões vêm da própria especificação", async ({ page }) => {
  await loginAs(page, "admin");
  const faq = await findPage(page.request, "faq");
  await page.goto(`/admin/pages/${faq.id}`);
  const editor = page.locator(".cm-content").first();
  const menu = page.locator(".cm-tooltip-autocomplete");
  const accept = async () => {
    await page.waitForTimeout(150); // o menu só aceita Enter depois de um instante
    await page.keyboard.press("Enter");
  };

  // "/" → Referência OpenAPI: lista só as páginas OpenAPI e insere o bloco já com o ref
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("\n\n/openapi");
  await expect(menu).toContainText("Referência OpenAPI");
  await accept();
  await expect(menu).toContainText("API REST do Account Hub");
  await expect(menu).not.toContainText("Eventos do Account Hub");
  await expect(menu).not.toContainText("Alerta");
  await accept();
  await expect(editor).toContainText("ref: /docs/referencia-api/api-rest");

  // dentro do bloco, "operations:" sugere as operações da especificação escolhida
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("End");
  await page.keyboard.type("\noperations:\n  - ");
  await expect(menu).toContainText("POST /accounts");
  await expect(menu).toContainText("GET /accounts/{account_id}");
  await page.keyboard.type("POST /acc");
  await accept();
  await expect(editor).toContainText("- POST /accounts");

  // um bloco novo digitado à mão: "ref:" sugere só as especificações do tipo certo
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("\n```asyncapi\nref: ");
  await expect(menu).toContainText("/docs/referencia-api/eventos");
  await expect(menu).not.toContainText("/docs/referencia-api/api-rest");
  await accept();
  await page.keyboard.type("\nchannels:\n  - ");
  await expect(menu).toContainText("accountLifecycle");
  await expect(menu).toContainText("roleBindings");

  await page.evaluate((id) => localStorage.removeItem(`ah-draft:${id}`), faq.id);
});

test("ver o diff local, comparar com o último Salvar e restaurar o último salvo com confirmação", async ({ page }) => {
  await loginAs(page, "admin");
  const guia = await findPage(page.request, "guia-de-escrita");
  await page.goto(`/admin/pages/${guia.id}`);
  await expect(page.getByRole("button", { name: "Ver alterações" })).toBeDisabled(); // nada mudou ainda

  // antes de salvar: o diff mostra o que mudou em relação à versão publicada
  await appendToEditor(page, "\n\nLinha nova A.");
  await page.getByRole("button", { name: "Ver alterações" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Alterações no editor" })).toBeVisible();
  await expect(dialog).toContainText("Comparando com a versão publicada (1.0.0)");
  await expect(dialog.getByText("Linha nova A.")).toBeVisible();
  await expect(dialog.getByRole("radio", { name: "Desde o último Salvar" })).toHaveCount(0); // ainda não há último salvo
  await dialog.getByRole("button", { name: "Fechar" }).last().click(); // o "X" do canto também se chama Fechar

  // salvou; escreveu mais: dá para ver só o que veio depois do Salvar
  await page.getByRole("button", { name: /^Salvar/ }).click();
  await appendToEditor(page, "\n\nLinha nova B.");
  await page.getByRole("button", { name: "Ver alterações" }).click();
  await expect(dialog.locator('[class*="bg-emerald-500/[0.09]"]').filter({ hasText: "Linha nova A." })).toHaveCount(1);
  await expect(dialog.locator('[class*="bg-emerald-500/[0.09]"]').filter({ hasText: "Linha nova B." })).toHaveCount(1);
  await dialog.getByRole("radio", { name: "Desde o último Salvar" }).click();
  await expect(dialog).toContainText("Comparando com o que você salvou neste navegador");
  // linhas adicionadas têm fundo verde; a A pode aparecer como contexto, mas não como adição
  const added = (text: string) => dialog.locator('[class*="bg-emerald-500/[0.09]"]').filter({ hasText: text });
  await expect(added("Linha nova B.")).toHaveCount(1);
  await expect(added("Linha nova A.")).toHaveCount(0);

  // restaurar pede confirmação; cancelar mantém o que está no editor
  await dialog.getByRole("button", { name: /Restaurar o último salvo/ }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm.getByText(/serão perdidas/)).toBeVisible();
  await confirm.getByRole("button", { name: "Manter o que está no editor" }).click();
  await expect(page.locator(".cm-content")).toContainText("Linha nova B.");

  // confirmar volta ao último salvo: a B some e a A fica
  await page.getByRole("button", { name: "Mais ações" }).click();
  await page.getByRole("menuitem", { name: /Restaurar o último salvo/ }).click();
  await confirm.getByRole("button", { name: "Restaurar" }).click();
  await expect(page.locator(".cm-content")).not.toContainText("Linha nova B.");
  await expect(page.locator(".cm-content")).toContainText("Linha nova A.");
  await expect(page.getByText("Salvo neste navegador · não enviado")).toBeVisible();
  await page.getByRole("button", { name: "Mais ações" }).click();
  await expect(page.getByRole("menuitem", { name: /Restaurar o último salvo/ })).toBeDisabled(); // nada depois do Salvar
  await page.keyboard.press("Escape");

  // antes de enviar para revisão: "Ver alterações" dentro do próprio formulário
  await page.getByRole("button", { name: "Enviar para revisão" }).click();
  const review = page.getByRole("dialog");
  await review.getByRole("button", { name: "Ver alterações" }).click();
  await expect(page.getByRole("heading", { name: "Alterações no editor" })).toBeVisible();
  await expect(page.getByText("Linha nova A.").last()).toBeVisible();

  // limpa: fecha o diff e o formulário, e descarta tudo
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Alterações no editor" })).toBeHidden();
  await review.getByRole("button", { name: "Cancelar" }).click();
  await page.getByRole("button", { name: "Mais ações" }).click();
  await page.getByRole("menuitem", { name: /Descartar alterações/ }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Descartar" }).click();
});

test("enviar várias páginas de uma vez: cada página salva vira uma proposta", async ({ page }) => {
  await loginAs(page, "admin");
  const guia = await findPage(page.request, "guia-de-escrita");
  const outra = await findPage(page.request, "arquitetura");

  for (const [id, texto] of [
    [guia.id, "Lote um."],
    [outra.id, "Lote dois."],
  ]) {
    await page.goto(`/admin/pages/${id}`);
    await appendToEditor(page, `\n\n${texto}`);
    await page.getByRole("button", { name: /^Salvar/ }).click();
    await expect(page.getByText("Salvo neste navegador · não enviado")).toBeVisible();
  }

  // pelo menu do botão de enviar
  await page.getByRole("button", { name: "Mais opções de envio" }).click();
  await page.getByRole("menuitem", { name: /Enviar várias páginas/ }).click();
  await expect(page).toHaveURL(/\/admin\/changes/);
  await expect(page.getByTestId("change-row")).toHaveCount(2);

  await page.getByRole("checkbox", { name: /Selecionar/ }).first().check();
  await page.getByRole("checkbox", { name: /Selecionar/ }).last().check();
  const enviar = page.getByRole("button", { name: /Enviar para revisão \(2\)/ });
  await expect(enviar).toBeDisabled(); // falta a descrição
  await page.getByLabel(/Descrição/).fill("Duas páginas juntas.");
  await enviar.click();
  await expect(page.getByText("2 propostas enviadas para revisão")).toBeVisible();

  for (const id of [guia.id, outra.id]) {
    const reviews = await (await page.request.get(`/api/admin/reviews?state=active&page_id=${id}`)).json();
    expect(reviews).toHaveLength(1);
    await page.request.post(`/api/admin/reviews/${reviews[0].id}/close`);
  }
});
