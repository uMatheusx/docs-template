"""Custo das rotas em chamadas à AWS: não pode crescer com o tamanho do histórico, da árvore ou dos arquivos."""

import pytest

from app.storage import VersionConflict

from .conftest import apply_change, find, login, propose


def faq_of(client):
    return find(client.get("/api/admin/tree").json(), "faq")


def test_reading_a_page_costs_one_object(client, aws_calls, monkeypatch):
    # nos testes o contador da árvore é conferido a cada uso (CACHE_TTL_SECONDS=0); aqui, o padrão de produção
    monkeypatch.setattr(client.app.state.storage.settings, "cache_ttl_seconds", 60)
    client.get("/api/pages/by-path", params={"path": "faq"})  # aquece a árvore
    aws_calls.clear()
    assert client.get("/api/pages/by-path", params={"path": "faq"}).status_code == 200
    assert aws_calls == ["GetObject"]  # só o texto da página


def test_unchanged_pages_answer_304(client, aws_calls):
    first = client.get("/api/pages/by-path", params={"path": "faq"})
    etag = first.headers["etag"]
    assert first.headers["cache-control"] == "no-cache"
    aws_calls.clear()
    again = client.get("/api/pages/by-path", params={"path": "faq"}, headers={"If-None-Match": etag})
    assert again.status_code == 304 and aws_calls == ["GetItem"]
    tree = client.get("/api/tree", headers={"If-None-Match": etag})
    assert tree.status_code == 304


def test_etag_changes_after_a_write_and_for_logged_users(admin):
    anonymous_etag = admin.get("/api/tree").headers["etag"]  # com login: vê rascunhos
    assert admin.get("/api/tree").headers["cache-control"] == "private, no-cache"
    apply_change(admin, faq_of(admin)["id"], content="# FAQ novo")
    assert admin.get("/api/tree", headers={"If-None-Match": anonymous_etag}).status_code == 200
    admin.cookies.clear()
    assert admin.get("/api/tree").headers["etag"].endswith('-p"')


def test_history_and_merge_base_do_not_grow_with_the_history(admin, aws_calls):
    faq = faq_of(admin)
    mine = propose(admin, faq, "# minha versão\n").json()
    admin.post(f"/api/admin/reviews/{mine['id']}/approve", json={})
    login(admin, "rui")
    for n in range(6):  # seis versões depois da proposta
        apply_change(admin, faq["id"], content=f"# versão {n}\n")
    login(admin, "admin")

    aws_calls.clear()
    history = admin.get(f"/api/admin/pages/{faq['id']}/history").json()
    assert len(history) == 6 and aws_calls == ["Query"]

    aws_calls.clear()
    detail = admin.get(f"/api/admin/reviews/{mine['id']}").json()
    assert detail["items"][0]["merge"]["state"] == "conflicts"
    assert len(aws_calls) <= 9, aws_calls  # proposta, árvore, página, textos e a versão-base (1 Query)
    assert aws_calls.count("Query") <= 1 + 1  # páginas (árvore) + versão-base


def test_no_route_scans_the_table(admin, aws_calls):
    faq = faq_of(admin)
    apply_change(admin, faq["id"], content="# FAQ\n\nNovo.")
    for url in (
        "/api/tree",
        "/api/search?q=token",
        "/api/admin/stats",
        "/api/admin/link-report",
        "/api/admin/reviews?state=all",
        "/api/admin/assets",
        "/api/admin/templates",
        f"/api/admin/pages/{faq['id']}/history",
    ):
        assert admin.get(url).status_code == 200, url
    admin.delete(f"/api/admin/pages/{find(admin.get('/api/admin/tree').json(), 'guias')['id']}")
    assert "Scan" not in aws_calls


def test_asset_library_is_one_query(admin, aws_calls):
    for name in ("a.yaml", "b.json", "c.png"):
        admin.post("/api/admin/assets", files={"file": (name, b"openapi: 3.0.0\ninfo: {}\npaths: {}\n", "text/plain")})
    aws_calls.clear()
    assert len(admin.get("/api/admin/assets").json()) == 3
    assert aws_calls == ["Query"]


def test_moving_a_page_is_one_transaction(admin, aws_calls):
    tree = admin.get("/api/admin/tree").json()
    aws_calls.clear()
    admin.post(f"/api/admin/pages/{find(tree, 'faq')['id']}/move", json={"parent_id": None, "index": 0})
    assert aws_calls.count("TransactWriteItems") == 1 and "UpdateItem" not in aws_calls


def test_a_stale_save_changes_nothing(admin):
    storage = admin.app.state.storage
    draft = admin.post("/api/admin/pages", json={"title": "Corrida", "content": "# um"}).json()
    stale = storage.get_page(draft["id"])
    admin.put(f"/api/admin/pages/{draft['id']}", json={"content": "# dois", "version": draft["version"]})

    fields = {"version": 3, "semver": "0.1.0", "note": "", "updated_by": "admin", "updated_at": "agora"}
    with pytest.raises(VersionConflict):
        storage.save_page(stale, fields, content="# atrasado", archive=False)
    assert admin.get(f"/api/admin/pages/{draft['id']}").json()["content"] == "# dois"
    # o texto da gravação recusada não fica para trás no S3; o rascunho anterior também não
    assert len(list(storage._list(f"pages/{draft['id']}/"))) == 1


def test_published_versions_keep_their_texts(admin):
    storage = admin.app.state.storage
    faq = faq_of(admin)
    apply_change(admin, faq["id"], content="# um")
    apply_change(admin, faq["id"], content="# dois")
    history = admin.get(f"/api/admin/pages/{faq['id']}/history").json()
    assert [h["semver"] for h in history] == ["1.0.1", "1.0.0"]
    assert admin.get(f"/api/admin/pages/{faq['id']}/history/{history[0]['id']}").json()["content"] == "# um"
    assert len(list(storage._list(f"pages/{faq['id']}/"))) == 3  # o atual + os dois do histórico
