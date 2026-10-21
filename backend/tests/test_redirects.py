from .conftest import find


def resolve(client, path):
    resp = client.get("/api/redirects", params={"path": path})
    return resp.json()["path"] if resp.status_code == 200 else resp.status_code


def test_renamed_slug_redirects(admin):
    faq = find(admin.get("/api/admin/tree").json(), "faq")
    admin.put(f"/api/admin/pages/{faq['id']}", json={"slug": "perguntas", "version": faq["version"]})
    assert resolve(admin, "faq") == "perguntas"
    assert resolve(admin, "/faq/") == "perguntas"


def test_moved_page_redirects_with_children(admin):
    tree = admin.get("/api/admin/tree").json()
    guias, referencia = find(tree, "guias"), find(tree, "referencia-api")
    admin.post(f"/api/admin/pages/{guias['id']}/move", json={"parent_id": referencia["id"], "index": 0})
    assert resolve(admin, "guias") == "referencia-api/guias"
    # as subpáginas também mudaram de endereço
    assert resolve(admin, "guias/autenticacao") == "referencia-api/guias/autenticacao"


def test_successive_changes_do_not_chain(admin):
    faq = find(admin.get("/api/admin/tree").json(), "faq")
    page = admin.put(f"/api/admin/pages/{faq['id']}", json={"slug": "perguntas", "version": faq["version"]}).json()
    admin.put(f"/api/admin/pages/{faq['id']}", json={"slug": "duvidas", "version": page["version"]})
    assert resolve(admin, "faq") == "duvidas"
    assert resolve(admin, "perguntas") == "duvidas"


def test_unknown_and_deleted_pages_are_404(admin):
    assert resolve(admin, "nunca-existiu") == 404
    faq = find(admin.get("/api/admin/tree").json(), "faq")
    admin.put(f"/api/admin/pages/{faq['id']}", json={"slug": "perguntas", "version": faq["version"]})
    admin.delete(f"/api/admin/pages/{faq['id']}")
    assert resolve(admin, "faq") == 404


def test_drafts_are_hidden_from_readers(admin):
    page = admin.post("/api/admin/pages", json={"title": "Rascunho secreto", "published": False}).json()
    admin.put(f"/api/admin/pages/{page['id']}", json={"slug": "secreto", "version": page["version"]})
    assert resolve(admin, "rascunho-secreto") == "secreto"
    admin.cookies.clear()
    assert resolve(admin, "rascunho-secreto") == 404
