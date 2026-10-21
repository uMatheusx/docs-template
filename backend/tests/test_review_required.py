from app.config import get_settings

from .conftest import apply_change, find, login


def faq_of(client):
    return find(client.get("/api/admin/tree").json(), "faq")


def test_admin_cannot_edit_published_page_directly(admin):
    faq = faq_of(admin)
    resp = admin.put(f"/api/admin/pages/{faq['id']}", json={"content": "# direto", "version": faq["version"]})
    assert resp.status_code == 403
    assert "proposta de revisão" in resp.json()["detail"]
    assert admin.get(f"/api/admin/pages/{faq['id']}").json()["version"] == faq["version"]


def test_nobody_publishes_without_review(admin):
    created = admin.post("/api/admin/pages", json={"title": "Nova", "published": True}).json()
    assert created["published"] is False

    # rascunhos continuam editáveis direto...
    saved = admin.put(
        f"/api/admin/pages/{created['id']}", json={"content": "# Rascunho", "version": created["version"]}
    ).json()
    assert saved["content"] == "# Rascunho"
    # ...mas publicar exige revisão
    resp = admin.put(f"/api/admin/pages/{created['id']}", json={"published": True, "version": saved["version"]})
    assert resp.status_code == 403
    assert apply_change(admin, created["id"], fields={"published": True})["published"] is True


def test_review_description_is_required(admin):
    faq = faq_of(admin)
    base = {"title": "Mudança", "content": "# Novo", "base_version": faq["version"]}
    url = f"/api/admin/pages/{faq['id']}/reviews"
    assert admin.post(url, json=base).status_code == 422  # sem descrição
    assert admin.post(url, json={**base, "description": ""}).status_code == 422
    blank = admin.post(url, json={**base, "description": "   "})
    assert blank.status_code == 422 and "Descreva o que mudou" in blank.text
    ok = admin.post(url, json={**base, "description": "  Corrige um erro de digitação.  "})
    assert ok.status_code == 201 and ok.json()["description"] == "Corrige um erro de digitação."


def test_author_can_approve_and_apply_own_change(admin):
    faq = faq_of(admin)
    page = apply_change(admin, faq["id"], content="# FAQ revisado")
    assert page["content"] == "# FAQ revisado" and page["version"] == faq["version"] + 1
    assert page["updated_by"] == "admin"


def test_self_approval_can_still_be_disabled(admin, monkeypatch):
    monkeypatch.setattr(get_settings(), "review_self_approval", False)
    faq = faq_of(admin)
    review = admin.post(
        f"/api/admin/pages/{faq['id']}/reviews",
        json={"title": "Minha", "description": "Texto.", "content": "# x", "base_version": faq["version"]},
    ).json()
    assert admin.post(f"/api/admin/reviews/{review['id']}/approve", json={}).status_code == 403
    login(admin, "rui")  # outro admin revisa
    assert admin.post(f"/api/admin/reviews/{review['id']}/approve", json={}).status_code == 200


def test_restoring_a_version_of_a_published_page_needs_review(admin):
    faq = faq_of(admin)
    apply_change(admin, faq["id"], content="# FAQ novo")
    history = admin.get(f"/api/admin/pages/{faq['id']}/history").json()
    resp = admin.post(f"/api/admin/pages/{faq['id']}/history/{history[-1]['id']}/restore")
    assert resp.status_code == 403 and "proposta de revisão" in resp.json()["detail"]


def test_restoring_a_version_of_a_draft_still_works(admin):
    draft = admin.post("/api/admin/pages", json={"title": "Rascunho com histórico"}).json()
    v2 = admin.put(f"/api/admin/pages/{draft['id']}", json={"content": "# dois", "version": 1}).json()
    admin.put(f"/api/admin/pages/{draft['id']}", json={"content": "# três", "version": v2["version"]})
    history = admin.get(f"/api/admin/pages/{draft['id']}/history").json()
    old = next(h for h in history if h.get("version") == 1)
    restored = admin.post(f"/api/admin/pages/{draft['id']}/history/{old['id']}/restore")
    assert restored.status_code == 200


def test_published_page_goes_back_to_draft_only_by_review(admin):
    faq = faq_of(admin)
    direct = admin.put(f"/api/admin/pages/{faq['id']}", json={"published": False, "version": faq["version"]})
    assert direct.status_code == 403

    page = apply_change(admin, faq["id"], fields={"published": False})
    assert page["published"] is False
    admin.cookies.clear()
    assert admin.get("/api/pages/by-path", params={"path": "faq"}).status_code == 404  # leitor não vê mais
