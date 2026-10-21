from .conftest import find


def test_seeded_tree_and_page(client):
    tree = client.get("/api/tree").json()
    assert [n["slug"] for n in tree][:2] == ["introducao", "primeiros-passos"]
    assert find(tree, "primeiros-passos/instalacao")

    page = client.get("/api/pages/by-path", params={"path": "guias/autenticacao"}).json()
    assert page["title"] == "Autenticação"
    assert "sequenceDiagram" in page["content"]
    assert [c["title"] for c in page["breadcrumbs"]] == ["Guias"]


def test_search(client):
    results = client.get("/api/search", params={"q": "dynamodb"}).json()
    assert results and any(r["path"] == "faq" for r in results)


def test_admin_requires_auth(client):
    assert client.get("/api/admin/tree").status_code == 401
    assert client.post("/api/auth/login", json={"username": "admin", "password": "x"}).status_code == 401


def test_crud_versioning_and_history(admin):
    page = admin.post("/api/admin/pages", json={"title": "Página Nova", "published": False}).json()
    assert page["slug"] == "pagina-nova" and page["version"] == 1

    updated = admin.put(f"/api/admin/pages/{page['id']}", json={"content": "# v2", "version": 1}).json()
    assert updated["version"] == 2 and updated["content"] == "# v2"

    # metadados atualizados corretamente (regressão: placeholders colidindo com a condição)
    renamed = admin.put(
        f"/api/admin/pages/{page['id']}", json={"title": "Renomeada", "content": "# v3 zebraquartzo", "version": 2}
    ).json()
    assert renamed["title"] == "Renomeada" and renamed["version"] == 3
    assert [r["id"] for r in admin.get("/api/search", params={"q": "zebraquartzo"}).json()] == [page["id"]]
    assert admin.put(f"/api/admin/pages/{page['id']}", json={"content": "# v2", "version": 3}).json()["version"] == 4

    conflict = admin.put(f"/api/admin/pages/{page['id']}", json={"content": "# stale", "version": 1})
    assert conflict.status_code == 409

    # salvar um rascunho só sobrescreve: sem versão x.y.z nova, sem nota e sem entrada no histórico
    noted = admin.put(
        f"/api/admin/pages/{page['id']}", json={"content": "# v5", "note": "Revisão técnica", "version": 4}
    ).json()
    assert noted["semver"] == "0.1.0" and noted["note"] == "" and noted["version"] == 5
    assert admin.get(f"/api/admin/pages/{page['id']}/history").json() == []

    # rascunhos não aparecem para leitores anônimos
    admin.post("/api/auth/logout")
    admin.cookies.clear()
    assert find(admin.get("/api/tree").json(), "pagina-nova") is None


def test_move_and_delete_cascade(admin):
    tree = admin.get("/api/admin/tree").json()
    guias = find(tree, "guias")
    faq = find(tree, "faq")

    tree = admin.post(f"/api/admin/pages/{faq['id']}/move", json={"parent_id": guias["id"], "index": 0}).json()
    assert find(tree, "guias")["children"][0]["slug"] == "faq"

    cycle = admin.post(f"/api/admin/pages/{guias['id']}/move", json={"parent_id": faq["id"], "index": 0})
    assert cycle.status_code == 400

    assert admin.delete(f"/api/admin/pages/{guias['id']}").json() == {"deleted": 4}
    assert find(admin.get("/api/admin/tree").json(), "guias") is None


def test_import_markdown_file(admin):
    md = "---\ntitle: Importada\nicon: Star\n---\n\n# Ignorado\n\nTexto"
    resp = admin.post("/api/admin/import/files", files=[("files", ("minha-pagina.md", md, "text/markdown"))])
    assert resp.status_code == 201
    page = resp.json()[0]
    assert (page["title"], page["slug"], page["icon"]) == ("Importada", "minha-pagina", "Star")
    assert page["content"].startswith("# Ignorado")


def test_assets(admin):
    asset = admin.post("/api/admin/assets", files={"file": ("logo ç.png", b"\x89PNG data", "image/png")}).json()
    assert asset["name"] == "logo-.png"
    resp = admin.get(asset["url"])
    assert resp.status_code == 200 and resp.content == b"\x89PNG data"
    assert resp.headers["content-type"] == "image/png"
    assert len(admin.get("/api/admin/assets").json()) == 1
    assert admin.delete(f"/api/admin/assets/{asset['id']}/{asset['name']}").status_code == 204
