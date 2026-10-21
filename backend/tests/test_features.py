import os

from .conftest import find, login

SPEC = """openapi: 3.0.3
info:
  title: API de Teste
  description: Uma API usada nos testes.
  version: "1"
servers:
  - url: https://sandbox.example.com/{v}
    variables:
      v: { default: v1, enum: [v1, v2] }
paths:
  /ping:
    get:
      responses: { "200": { description: ok } }
"""


def test_spec_pages_are_seeded(client):
    tree = client.get("/api/tree").json()
    ref = find(tree, "referencia-api")
    kinds = {c["slug"]: c["kind"] for c in ref["children"]}
    assert kinds == {"api-rest": "openapi", "eventos": "asyncapi"}
    page = client.get("/api/pages/by-path", params={"path": "referencia-api/api-rest"}).json()
    assert page["title"] == "API REST do Account Hub" and page["content"].startswith("openapi:")


def test_import_spec_detects_kind(admin):
    resp = admin.post("/api/admin/import/files", files=[("files", ("teste.yaml", SPEC, "application/yaml"))])
    page = resp.json()[0]
    assert (page["kind"], page["title"], page["slug"], page["icon"]) == ("openapi", "API de Teste", "teste", "Plug")


def test_api_reference_embeds_are_link_checked(admin):
    content = (
        "Intro\n\n```openapi\nref: /docs/referencia-api/api-rest\noperations:\n  - POST /accounts\n```\n\n"
        "```openapi\nref: /docs/referencia-api/nao-existe\n```\n\n"
        "```asyncapi\nref: /docs/referencia-api/api-rest\n```\n"
    )
    page = admin.post("/api/admin/pages", json={"title": "Guia com API", "content": content}).json()
    report = admin.get("/api/admin/link-report").json()
    mine = sorted((i["kind"], i["target"], i["line"]) for i in report["issues"] if i["page_id"] == page["id"])
    # a segunda aponta para página inexistente; a terceira para uma OpenAPI usando ```asyncapi
    assert mine == [
        ("broken_link", "/docs/referencia-api/api-rest", 14),
        ("broken_link", "/docs/referencia-api/nao-existe", 10),
    ]
    assert admin.post("/api/try", json={}).status_code in (404, 405)  # "Testar" removido


def test_link_report(admin):
    draft = admin.post("/api/admin/pages", json={"title": "Rascunho alvo", "published": False}).json()
    content = (
        "Veja [inexistente](/docs/nao-existe), [rascunho](/docs/rascunho-alvo) e [ok](/docs/faq).\n\n"
        "```md\n[ignorado](/docs/dentro-de-codigo)\n```\n\n"
        "![sumiu](/api/assets/abc123def456/nada.png)\n"
    )
    page = admin.post("/api/admin/pages", json={"title": "Com links", "content": content}).json()
    report = admin.get("/api/admin/link-report").json()
    mine = sorted((i["kind"], i["target"], i["line"]) for i in report["issues"] if i["page_id"] == page["id"])
    assert mine == [
        ("broken_image", "/api/assets/abc123def456/nada.png", 7),
        ("broken_link", "/docs/nao-existe", 1),
        ("draft_link", "/docs/rascunho-alvo", 1),
    ]
    assert draft["published"] is False


def test_editor_permissions_and_review_flow(client):
    faq = find(client.get("/api/tree").json(), "faq")

    login(client, "edna")
    assert client.get("/api/site").json()["user"]["role"] == "editor"
    created = client.post("/api/admin/pages", json={"title": "Nova do editor", "published": True}).json()
    assert created["published"] is False  # editor só cria rascunho
    assert (
        client.put(f"/api/admin/pages/{faq['id']}", json={"content": "x", "version": faq["version"]}).status_code == 403
    )
    assert client.delete(f"/api/admin/pages/{created['id']}").status_code == 403

    review = client.post(
        f"/api/admin/pages/{faq['id']}/reviews",
        json={
            "title": "Atualiza FAQ",
            "description": "Nova pergunta",
            "content": "# FAQ\n\nNovo",
            "base_version": faq["version"],
        },
    ).json()
    assert review["status"] == "open" and review["number"] >= 1
    assert client.post(f"/api/admin/reviews/{review['id']}/approve", json={}).status_code == 403
    # reenviar atualiza a mesma proposta (não cria outra)
    again = client.post(
        f"/api/admin/pages/{faq['id']}/reviews",
        json={"title": "Atualiza FAQ", "content": "# FAQ\n\nNovo 2", "base_version": faq["version"]},
    ).json()
    assert again["id"] == review["id"] and [e["type"] for e in again["events"]] == ["created", "updated"]

    login(client, "admin")
    assert client.post(f"/api/admin/reviews/{review['id']}/merge", json={}).status_code == 409  # sem aprovação
    assert client.post(f"/api/admin/reviews/{review['id']}/comments", json={"body": "Ficou bom"}).status_code == 200
    approved = client.post(f"/api/admin/reviews/{review['id']}/approve", json={"body": "Aprovado"}).json()
    assert approved["status"] == "approved"
    merged = client.post(f"/api/admin/reviews/{review['id']}/merge", json={}).json()
    assert merged["status"] == "merged" and merged["merged_version"] == faq["version"] + 1
    page = client.get(f"/api/admin/pages/{faq['id']}").json()
    assert page["content"] == "# FAQ\n\nNovo 2"
    assert page["note"].startswith(f"Revisão #{review['number']}") and page["updated_by"] == "edna"
    # depois de aplicada, o diff continua comparando com o conteúdo de antes
    detail = client.get(f"/api/admin/reviews/{review['id']}").json()
    assert (
        detail["current_content"].startswith("# Perguntas frequentes")
        and detail["proposed_content"] == "# FAQ\n\nNovo 2"
    )
    assert client.get("/api/admin/reviews").json() == []  # nada ativo
    assert client.get("/api/admin/reviews", params={"state": "done"}).json()[0]["id"] == review["id"]


def test_review_rules_conflict_and_self_approval(admin):
    faq = find(admin.get("/api/admin/tree").json(), "faq")
    own = admin.post(
        f"/api/admin/pages/{faq['id']}/reviews",
        json={"title": "Minha", "fields": {"description": "Nova descrição"}, "base_version": faq["version"]},
    ).json()
    assert admin.post(f"/api/admin/reviews/{own['id']}/approve", json={}).status_code == 403  # própria proposta

    # a página muda depois da proposta: aplicar exige confirmação (force)
    admin.put(f"/api/admin/pages/{faq['id']}", json={"content": "# FAQ v+1", "version": faq["version"]})
    login(admin, "rui")
    admin.post(f"/api/admin/reviews/{own['id']}/approve", json={})
    assert admin.post(f"/api/admin/reviews/{own['id']}/merge", json={}).status_code == 409
    merged = admin.post(f"/api/admin/reviews/{own['id']}/merge", json={"force": True}).json()
    assert merged["status"] == "merged"
    page = admin.get(f"/api/admin/pages/{faq['id']}").json()
    assert page["description"] == "Nova descrição" and page["content"] == "# FAQ v+1"


def test_templates(client):
    login(client, "edna")
    tpl = client.post("/api/admin/templates", json={"name": "Runbook do time", "content": "# {{title}}"}).json()
    assert [t["name"] for t in client.get("/api/admin/templates").json()] == ["Runbook do time"]
    login(client, "rui")
    assert client.delete(f"/api/admin/templates/{tpl['id']}").status_code == 204
    assert client.get("/api/admin/templates").json() == []


def test_legacy_pages_without_kind(admin):
    # páginas criadas antes de existir "kind"/"note" não podem quebrar a árvore nem a leitura
    import boto3

    faq = find(admin.get("/api/admin/tree").json(), "faq")
    table = boto3.resource("dynamodb", region_name="us-east-1").Table(
        os.environ.get("DYNAMODB_TABLE", "accounthub-docs-pages")
    )
    table.update_item(Key={"id": faq["id"]}, UpdateExpression="REMOVE kind, note")
    node = find(admin.get("/api/tree").json(), "faq")
    assert node["kind"] == "doc" and node["note"] == ""
    assert admin.get("/api/pages/by-path", params={"path": "faq"}).status_code == 200
