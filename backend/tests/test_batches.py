from .conftest import apply_change, login

BASE = "# Guia\n\nIntrodução.\n\nPasso um.\n\nPasso dois.\n\nPasso três.\n\nConclusão.\n"


def published(admin, title):
    created = admin.post("/api/admin/pages", json={"title": title, "content": BASE}).json()
    return apply_change(admin, created["id"], fields={"published": True})


def item(page, content, bump="patch"):
    return {"page_id": page["id"], "content": content, "base_version": page["version"], "bump": bump}


def open_batch(admin, pages, contents, title="Atualiza duas páginas"):
    items = [item(p, c) for p, c in zip(pages, contents, strict=True)]
    resp = admin.post(
        "/api/admin/review-batches", json={"title": title, "description": "Mudança em conjunto.", "items": items}
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_batch_groups_the_pages_under_one_number(admin):
    a, b = published(admin, "Pacote A"), published(admin, "Pacote B")
    batch = open_batch(admin, [a, b], [BASE.replace("um", "1"), BASE.replace("dois", "2")])
    assert batch["status"] == "open" and len(batch["pages"]) == 2
    assert {p["page_title"] for p in batch["pages"]} == {"Pacote A", "Pacote B"}

    # as propostas de cada página levam o número e o pacote
    reviews = [r for r in admin.get("/api/admin/reviews").json() if r["batch_id"] == batch["id"]]
    assert len(reviews) == 2 and {r["number"] for r in reviews} == {batch["number"]}

    listed = admin.get("/api/admin/review-batches").json()
    assert [x["id"] for x in listed] == [batch["id"]]
    assert admin.get("/api/admin/stats").json()["open_reviews"] == 1  # o pacote conta como uma revisão
    detail = admin.get(f"/api/admin/review-batches/{batch['id']}").json()
    assert len(detail["reviews"]) == 2 and detail["reviews"][0]["proposed_content"]


def test_approve_and_merge_apply_every_page_together(admin):
    a, b = published(admin, "Junto A"), published(admin, "Junto B")
    batch = open_batch(admin, [a, b], [BASE.replace("um", "1"), BASE.replace("dois", "2")])

    early = admin.post(f"/api/admin/review-batches/{batch['id']}/merge")
    assert early.status_code == 409 and "Aprove" in early.json()["detail"]

    approved = admin.post(f"/api/admin/review-batches/{batch['id']}/approve", json={"body": "Ok"}).json()
    assert approved["status"] == "approved"
    merged = admin.post(f"/api/admin/review-batches/{batch['id']}/merge").json()
    assert merged["status"] == "merged"
    assert admin.get(f"/api/admin/pages/{a['id']}").json()["content"] == BASE.replace("um", "1")
    assert admin.get(f"/api/admin/pages/{b['id']}").json()["content"] == BASE.replace("dois", "2")
    assert admin.get("/api/admin/review-batches").json() == []
    assert [x["id"] for x in admin.get("/api/admin/review-batches?state=done").json()] == [batch["id"]]


def test_merge_is_all_or_nothing(admin):
    a, b = published(admin, "Tudo A"), published(admin, "Tudo B")
    batch = open_batch(admin, [a, b], [BASE.replace("Passo um.", "Um."), BASE.replace("Passo um.", "Primeiro.")])
    # a página B muda o mesmo trecho depois da proposta: conflito
    login(admin, "rui")  # outro autor: o mesmo autor atualizaria a proposta do pacote em vez de abrir outra
    apply_change(admin, b["id"], content=BASE.replace("Passo um.", "Outro."))
    login(admin, "admin")
    admin.post(f"/api/admin/review-batches/{batch['id']}/approve", json={})

    blocked = admin.post(f"/api/admin/review-batches/{batch['id']}/merge")
    assert blocked.status_code == 409 and "Nada foi aplicado" in blocked.json()["detail"]
    assert "Tudo B" in blocked.json()["detail"]
    assert admin.get(f"/api/admin/pages/{a['id']}").json()["content"] == BASE  # A não foi aplicada


def test_request_changes_comment_and_close(admin):
    a, b = published(admin, "Fecha A"), published(admin, "Fecha B")
    batch = open_batch(admin, [a, b], [BASE + "\nA.\n", BASE + "\nB.\n"])
    assert admin.post(f"/api/admin/review-batches/{batch['id']}/request-changes", json={}).status_code == 400
    changed = admin.post(f"/api/admin/review-batches/{batch['id']}/request-changes", json={"body": "Revise."}).json()
    assert changed["status"] == "changes_requested"
    commented = admin.post(f"/api/admin/review-batches/{batch['id']}/comments", json={"body": "Pergunta"}).json()
    assert commented["events"][-1]["type"] == "comment"
    closed = admin.post(f"/api/admin/review-batches/{batch['id']}/close").json()
    assert closed["status"] == "closed"
    assert admin.post(f"/api/admin/review-batches/{batch['id']}/approve", json={}).status_code == 409


def test_batch_rules(admin):
    a = published(admin, "Regras A")
    dup = admin.post(
        "/api/admin/review-batches",
        json={"title": "x", "description": "y", "items": [item(a, BASE + "1"), item(a, BASE + "2")]},
    )
    assert dup.status_code == 400
    nothing = admin.post(
        "/api/admin/review-batches",
        json={"title": "x", "description": "y", "items": [{"page_id": a["id"], "base_version": a["version"]}]},
    )
    assert nothing.status_code == 400
    empty = admin.post("/api/admin/review-batches", json={"title": "x", "description": " ", "items": []})
    assert empty.status_code == 422

    # editor propõe, mas só administrador aprova e aplica
    login(admin, "edna")
    b = {**a}
    batch = open_batch(admin, [b], [BASE + "\nEditora.\n"], title="Da editora")
    assert admin.post(f"/api/admin/review-batches/{batch['id']}/approve", json={}).status_code == 403
    assert admin.post(f"/api/admin/review-batches/{batch['id']}/merge").status_code == 403
