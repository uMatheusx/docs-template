from .conftest import apply_change, find, login
from .conftest import propose as open_proposal

BASE = "# Guia\n\nIntrodução.\n\nPasso um.\n\nPasso dois.\n\nPasso três.\n\nConclusão.\n"


def make_page(admin):
    """Página publicada com um texto conhecido (v do texto = a atual)."""
    created = admin.post("/api/admin/pages", json={"title": "Guia de mesclagem", "content": BASE}).json()
    return apply_change(admin, created["id"], fields={"published": True})


def propose(client, page, content):
    resp = open_proposal(client, page, content)
    assert resp.status_code == 201, resp.text
    review = resp.json()
    assert client.post(f"/api/admin/reviews/{review['id']}/approve", json={}).status_code == 200
    return review


def merge_info(client, review):
    return client.get(f"/api/admin/reviews/{review['id']}").json()["items"][0]["merge"]


def content_of(client, page):
    return client.get(f"/api/admin/pages/{page['id']}").json()["content"]


def test_up_to_date_proposal_reports_current(admin):
    page = make_page(admin)
    review = propose(admin, page, BASE.replace("Passo um.", "Passo 1."))
    info = merge_info(admin, review)
    assert info["state"] == "current" and info["conflicts"] == []


def test_changes_in_different_places_are_combined_automatically(admin):
    page = make_page(admin)
    mine = propose(admin, page, BASE.replace("Conclusão.", "Conclusão revisada."))
    # outro admin muda outro trecho e aplica antes
    login(admin, "rui")
    apply_change(admin, page["id"], content=BASE.replace("Passo um.", "Passo 1, atualizado."))

    info = merge_info(admin, mine)
    assert info["state"] == "clean"
    assert "Passo 1, atualizado." in info["merged_content"] and "Conclusão revisada." in info["merged_content"]

    merged = admin.post(f"/api/admin/reviews/{mine['id']}/merge", json={})
    assert merged.status_code == 200
    text = content_of(admin, page)
    assert "Passo 1, atualizado." in text and "Conclusão revisada." in text
    last = merged.json()["events"][-1]
    assert last["type"] == "merged" and "Combinada automaticamente" in last["body"]


def test_overlapping_changes_need_a_choice_per_conflict(admin):
    page = make_page(admin)
    mine = propose(admin, page, BASE.replace("Passo dois.", "Passo dois, versão da proposta."))
    login(admin, "rui")
    apply_change(admin, page["id"], content=BASE.replace("Passo dois.", "Passo dois, versão da página."))

    info = merge_info(admin, mine)
    assert info["state"] == "conflicts" and len(info["conflicts"]) == 1
    conflict = info["conflicts"][0]
    assert conflict["ours"] == "Passo dois, versão da página.\n"
    assert conflict["theirs"] == "Passo dois, versão da proposta.\n"
    assert conflict["base"] == "Passo dois.\n"

    url = f"/api/admin/reviews/{mine['id']}/merge"
    sem_escolha = admin.post(url, json={})
    assert sem_escolha.status_code == 409 and "escolha uma opção" in sem_escolha.json()["detail"]
    assert admin.post(url, json={"resolutions": {page["id"]: ["ours", "theirs"]}}).status_code == 400
    assert admin.post(url, json={"resolutions": {page["id"]: ["nenhuma"]}}).status_code == 422
    assert "versão da página" in content_of(admin, page)  # nada foi aplicado ainda

    done = admin.post(url, json={"resolutions": {page["id"]: ["both"]}})
    assert done.status_code == 200
    text = content_of(admin, page)
    assert "Passo dois, versão da página.\nPasso dois, versão da proposta.\n" in text
    assert "Conflitos resolvidos" in done.json()["events"][-1]["body"]


def test_resolutions_keep_clean_parts_of_both_sides(admin):
    page = make_page(admin)
    edited = BASE.replace("Passo dois.", "Passo dois, proposta.").replace("Conclusão.", "Conclusão da proposta.")
    mine = propose(admin, page, edited)
    login(admin, "rui")
    theirs = BASE.replace("Passo dois.", "Passo dois, página.").replace("Introdução.", "Intro nova.")
    apply_change(admin, page["id"], content=theirs)

    assert (
        admin.post(f"/api/admin/reviews/{mine['id']}/merge", json={"resolutions": {page["id"]: ["theirs"]}}).status_code
        == 200
    )
    text = content_of(admin, page)
    assert "Passo dois, proposta." in text  # conflito: escolhida a proposta
    assert "Intro nova." in text  # mudança só da página, preservada
    assert "Conclusão da proposta." in text  # mudança só da proposta, aplicada


def test_force_still_overrides_the_page_with_the_proposal(admin):
    page = make_page(admin)
    mine = propose(admin, page, BASE.replace("Passo dois.", "Passo dois, proposta."))
    login(admin, "rui")
    changed = BASE.replace("Passo dois.", "Passo dois, página.").replace("Intro", "Início")
    apply_change(admin, page["id"], content=changed)
    assert admin.post(f"/api/admin/reviews/{mine['id']}/merge", json={"force": True}).status_code == 200
    text = content_of(admin, page)
    assert "Passo dois, proposta." in text and "Introdução." in text  # a proposta inteira, como antes


def test_unavailable_base_falls_back_to_confirmation(admin, monkeypatch):
    page = make_page(admin)
    mine = propose(admin, page, BASE.replace("Passo um.", "Passo 1."))
    login(admin, "rui")
    apply_change(admin, page["id"], content=BASE.replace("Conclusão.", "Fim."))
    monkeypatch.setattr(admin.app.state.storage, "content_at_version", lambda *a, **k: None)

    assert merge_info(admin, mine)["state"] == "unavailable"
    blocked = admin.post(f"/api/admin/reviews/{mine['id']}/merge", json={})
    assert blocked.status_code == 409 and "não foi possível combinar" in blocked.json()["detail"]
    assert admin.post(f"/api/admin/reviews/{mine['id']}/merge", json={"force": True}).status_code == 200


def test_content_at_version_handles_metadata_only_versions(admin):
    storage = admin.app.state.storage
    page = make_page(admin)  # publicada, texto BASE
    v1 = page["version"]
    v2 = apply_change(admin, page["id"], fields={"description": "só metadados"})["version"]
    v3 = apply_change(admin, page["id"], content="v3\n")["version"]
    assert v1 < v2 < v3
    assert storage.content_at_version(page["id"], v1) == BASE
    assert storage.content_at_version(page["id"], v2) == BASE  # a v2 não mudou o texto
    assert storage.content_at_version(page["id"], v3) == "v3\n"
    assert storage.content_at_version(page["id"], v3 + 6) == "v3\n"
    assert storage.content_at_version(page["id"], 0) is None


def test_page_found_by_tree_after_merge(admin):
    # sanidade: a página mesclada continua publicada e acessível
    page = make_page(admin)
    mine = propose(admin, page, BASE.replace("Passo um.", "Passo 1."))
    admin.post(f"/api/admin/reviews/{mine['id']}/merge", json={})
    assert find(admin.get("/api/tree").json(), "guia-de-mesclagem")
