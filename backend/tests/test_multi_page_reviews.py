from .conftest import apply_change, login, propose

BASE = "# Guia\n\nIntrodução.\n\nPasso um.\n\nPasso dois.\n\nPasso três.\n\nConclusão.\n"


def published(admin, title):
    created = admin.post("/api/admin/pages", json={"title": title, "content": BASE}).json()
    return apply_change(admin, created["id"], fields={"published": True})


def item(page, content, bump="patch"):
    return {"page_id": page["id"], "content": content, "base_version": page["version"], "bump": bump}


def open_review(admin, pages, contents, title="Atualiza duas páginas"):
    items = [item(p, c) for p, c in zip(pages, contents, strict=True)]
    resp = admin.post(
        "/api/admin/reviews", json={"title": title, "description": "Mudança em conjunto.", "items": items}
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def content_of(admin, page):
    return admin.get(f"/api/admin/pages/{page['id']}").json()["content"]


def test_one_proposal_holds_several_pages(admin):
    a, b = published(admin, "Pacote A"), published(admin, "Pacote B")
    review = open_review(admin, [a, b], [BASE.replace("um", "1"), BASE.replace("dois", "2")])
    assert review["status"] == "open" and [i["page_title"] for i in review["items"]] == ["Pacote A", "Pacote B"]

    assert [r["id"] for r in admin.get("/api/admin/reviews").json()] == [review["id"]]
    # filtrar por página encontra a proposta por qualquer uma das páginas
    assert [r["id"] for r in admin.get("/api/admin/reviews", params={"page_id": b["id"]}).json()] == [review["id"]]
    assert admin.get("/api/admin/stats").json()["open_reviews"] == 1
    detail = admin.get(f"/api/admin/reviews/{review['id']}").json()
    assert [i["proposed_content"] for i in detail["items"]] == [BASE.replace("um", "1"), BASE.replace("dois", "2")]


def test_approve_and_merge_apply_every_page_together(admin):
    a, b = published(admin, "Junto A"), published(admin, "Junto B")
    review = open_review(admin, [a, b], [BASE.replace("um", "1"), BASE.replace("dois", "2")])

    early = admin.post(f"/api/admin/reviews/{review['id']}/merge", json={})
    assert early.status_code == 409 and "aprovada" in early.json()["detail"]

    assert admin.post(f"/api/admin/reviews/{review['id']}/approve", json={"body": "Ok"}).json()["status"] == "approved"
    merged = admin.post(f"/api/admin/reviews/{review['id']}/merge", json={}).json()
    assert merged["status"] == "merged"
    assert [i["merged_semver"] for i in merged["items"]] == ["1.0.1", "1.0.1"]
    assert merged["events"][-1]["body"] == "Aplicada: “Junto A” como 1.0.1; “Junto B” como 1.0.1."
    assert content_of(admin, a) == BASE.replace("um", "1")
    assert content_of(admin, b) == BASE.replace("dois", "2")
    assert admin.get("/api/admin/reviews").json() == []
    assert review["id"] in [r["id"] for r in admin.get("/api/admin/reviews", params={"state": "done"}).json()]


def test_merge_is_all_or_nothing(admin):
    a, b = published(admin, "Tudo A"), published(admin, "Tudo B")
    review = open_review(admin, [a, b], [BASE.replace("Passo um.", "Um."), BASE.replace("Passo um.", "Primeiro.")])
    # a página B muda o mesmo trecho depois da proposta: conflito
    login(admin, "rui")
    apply_change(admin, b["id"], content=BASE.replace("Passo um.", "Outro."))
    login(admin, "admin")
    admin.post(f"/api/admin/reviews/{review['id']}/approve", json={})

    url = f"/api/admin/reviews/{review['id']}/merge"
    blocked = admin.post(url, json={})
    assert blocked.status_code == 409 and "Nada foi aplicado" in blocked.json()["detail"]
    assert "Tudo B" in blocked.json()["detail"]
    assert content_of(admin, a) == BASE  # A não foi aplicada

    # o conflito se resolve na própria proposta, página por página
    detail = admin.get(f"/api/admin/reviews/{review['id']}").json()
    assert [i["merge"]["state"] for i in detail["items"]] == ["current", "conflicts"]
    done = admin.post(url, json={"resolutions": {b["id"]: ["theirs"]}})
    assert done.status_code == 200, done.text
    assert content_of(admin, a) == BASE.replace("Passo um.", "Um.")
    assert content_of(admin, b) == BASE.replace("Passo um.", "Primeiro.")


def test_an_invalid_chosen_version_applies_nothing(admin):
    a, b = published(admin, "Versão A"), published(admin, "Versão B")
    review = open_review(admin, [a, b], [BASE + "a", BASE + "b"])
    admin.post(f"/api/admin/reviews/{review['id']}/approve", json={})
    resp = admin.post(f"/api/admin/reviews/{review['id']}/merge", json={"semver": {b["id"]: "0.0.1"}})
    assert resp.status_code == 400
    assert content_of(admin, a) == BASE


def test_request_changes_comment_and_close(admin):
    a, b = published(admin, "Fecha A"), published(admin, "Fecha B")
    review = open_review(admin, [a, b], [BASE + "\nA.\n", BASE + "\nB.\n"])
    url = f"/api/admin/reviews/{review['id']}"
    assert admin.post(f"{url}/request-changes", json={}).status_code == 400
    assert admin.post(f"{url}/request-changes", json={"body": "Revise."}).json()["status"] == "changes_requested"
    assert admin.post(f"{url}/comments", json={"body": "Pergunta"}).json()["events"][-1]["type"] == "comment"
    assert admin.post(f"{url}/close").json()["status"] == "closed"
    assert admin.post(f"{url}/approve", json={}).status_code == 409


def test_proposal_rules(admin):
    a = published(admin, "Regras A")
    url = "/api/admin/reviews"
    dup = admin.post(url, json={"title": "x", "description": "y", "items": [item(a, BASE + "1"), item(a, BASE + "2")]})
    assert dup.status_code == 400
    nothing = admin.post(
        url, json={"title": "x", "description": "y", "items": [{"page_id": a["id"], "base_version": a["version"]}]}
    )
    assert nothing.status_code == 400 and "Regras A" in nothing.json()["detail"]
    assert admin.post(url, json={"title": "x", "description": "y", "items": []}).status_code == 422

    # editor propõe, mas só administrador aprova e aplica
    login(admin, "edna")
    review = open_review(admin, [a], [BASE + "\nEditora.\n"], title="Da editora")
    assert admin.post(f"/api/admin/reviews/{review['id']}/approve", json={}).status_code == 403
    assert admin.post(f"/api/admin/reviews/{review['id']}/merge", json={}).status_code == 403


def test_resending_one_page_updates_it_inside_the_proposal(admin):
    a, b = published(admin, "Reenvio A"), published(admin, "Reenvio B")
    review = open_review(admin, [a, b], [BASE + "a1", BASE + "b1"], title="Duas de uma vez")
    admin.post(f"/api/admin/reviews/{review['id']}/approve", json={})

    again = propose(admin, b, BASE + "b2", title="Atualiza Reenvio B").json()
    assert again["id"] == review["id"] and again["status"] == "open"  # volta para revisão
    assert again["title"] == "Duas de uma vez"  # só uma das páginas: o resumo da proposta continua
    detail = admin.get(f"/api/admin/reviews/{review['id']}").json()
    assert [i["proposed_content"] for i in detail["items"]] == [BASE + "a1", BASE + "b2"]


def test_pages_split_between_proposals_must_be_sent_apart(admin):
    a, b = published(admin, "Separa A"), published(admin, "Separa B")
    first = propose(admin, a, BASE + "a").json()
    mixed = admin.post(
        "/api/admin/reviews",
        json={"title": "x", "description": "y", "items": [item(a, BASE + "a2"), item(b, BASE + "b")]},
    )
    assert mixed.status_code == 409 and f"#{first['number']}" in mixed.json()["detail"]
    # outro autor pode propor nas mesmas páginas
    login(admin, "rui")
    assert open_review(admin, [a, b], [BASE + "r1", BASE + "r2"])["id"] != first["id"]


def test_deleting_a_page_removes_it_from_proposals(admin):
    a, b = published(admin, "Some A"), published(admin, "Some B")
    both = open_review(admin, [a, b], [BASE + "a", BASE + "b"])
    login(admin, "rui")
    only_b = propose(admin, b, BASE + "só b").json()
    login(admin, "admin")

    assert admin.delete(f"/api/admin/pages/{b['id']}").json() == {"deleted": 1}
    remaining = admin.get(f"/api/admin/reviews/{both['id']}").json()
    assert [i["page_id"] for i in remaining["items"]] == [a["id"]]
    assert admin.get(f"/api/admin/reviews/{only_b['id']}").status_code == 404
