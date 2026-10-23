from app.lib.markdown import fold

from .conftest import apply_change, publish


def paths(results):
    return [r["path"] for r in results]


def test_fold_keeps_length():
    text = "Autenticação e permissões — ÇÃO"
    assert fold(text) == "autenticacao e permissoes — cao"
    assert len(fold(text)) == len(text)


def test_search_ignores_accents(client):
    assert "guias/autenticacao" in paths(client.get("/api/search", params={"q": "autenticacao"}).json())
    assert "guias/autenticacao" in paths(client.get("/api/search", params={"q": "AUTENTICAÇÃO"}).json())


def test_snippet_keeps_original_accents(client):
    results = client.get("/api/search", params={"q": "permissoes"}).json()
    hit = next(r for r in results if r["path"] == "guias/contas-e-permissoes")
    assert "permiss" in hit["snippet"].lower()


def test_index_follows_writes(admin):
    body = {"title": "Glossário", "content": "# Glossário\n\nTermo zarabatana."}
    page = admin.post("/api/admin/pages", json=body).json()
    publish(admin, page["id"])
    assert paths(admin.get("/api/search", params={"q": "zarabatana"}).json()) == ["glossario"]

    apply_change(admin, page["id"], content="# Glossário\n\nTermo novo.")
    assert admin.get("/api/search", params={"q": "zarabatana"}).json() == []


def test_repeated_searches_reuse_index(client, aws_calls):
    client.get("/api/search", params={"q": "dynamodb"})  # monta o índice
    aws_calls.clear()
    for query in ("dynamodb", "token", "conta"):
        client.get("/api/search", params={"q": query})
    # só confere o contador da árvore; páginas e textos de busca não são lidos de novo
    assert set(aws_calls) == {"GetItem"}
