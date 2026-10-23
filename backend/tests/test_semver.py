from .conftest import apply_change, find, login, propose, publish


def new_draft(admin, title="Versionada"):
    return admin.post("/api/admin/pages", json={"title": title, "content": "# Base\n\nTexto.\n"}).json()


def get(admin, page_id):
    return admin.get(f"/api/admin/pages/{page_id}").json()


def test_new_page_starts_as_a_0_1_0_draft(admin):
    page = new_draft(admin)
    assert page["semver"] == "0.1.0" and page["version"] == 1 and page["published"] is False


def test_seeded_published_pages_start_at_1_0_0(admin):
    faq = find(admin.get("/api/tree").json(), "faq")
    assert faq["semver"] == "1.0.0"


def test_direct_draft_saves_keep_the_version(admin):
    page = new_draft(admin)
    v2 = admin.put(f"/api/admin/pages/{page['id']}", json={"content": "# dois", "version": 1}).json()
    v3 = admin.put(f"/api/admin/pages/{page['id']}", json={"description": "x", "version": 2}).json()
    assert (v2["semver"], v3["semver"]) == ("0.1.0", "0.1.0")  # salvar rascunho não gera versão x.y.z
    assert (v2["version"], v3["version"]) == (2, 3)  # a revisão interna continua contando


def test_first_publication_becomes_1_0_0_whatever_the_chosen_bump(admin):
    page = new_draft(admin)
    published = apply_change(admin, page["id"], fields={"published": True}, bump="patch")
    assert published["semver"] == "1.0.0"
    other = new_draft(admin, "Outra")
    assert apply_change(admin, other["id"], fields={"published": True}, bump="minor")["semver"] == "1.0.0"


def test_applied_proposals_bump_by_the_chosen_kind(admin):
    page = publish(admin, new_draft(admin)["id"])
    assert page["semver"] == "1.0.0"
    assert apply_change(admin, page["id"], content="# a", bump="patch")["semver"] == "1.0.1"
    assert apply_change(admin, page["id"], content="# b", bump="minor")["semver"] == "1.1.0"
    assert apply_change(admin, page["id"], content="# c", bump="patch")["semver"] == "1.1.1"
    assert apply_change(admin, page["id"], content="# d", bump="major")["semver"] == "2.0.0"


def test_bump_defaults_to_patch_and_rejects_unknown_kinds(admin):
    page = publish(admin, new_draft(admin)["id"])
    created = propose(admin, page, "# x")
    assert created.status_code == 201 and created.json()["items"][0]["bump"] == "patch"
    assert propose(admin, page, "# x", bump="gigante").status_code == 422
    assert propose(admin, page, "# x", base_semver="v1").status_code == 422


def item_of(admin, review):
    """A página (única) da proposta, com os detalhes."""
    return admin.get(f"/api/admin/reviews/{review['id']}").json()["items"][0]


def test_review_detail_shows_versions_and_next_version(admin):
    page = publish(admin, new_draft(admin)["id"])
    review = propose(admin, page, "# x", base_semver=page["semver"], bump="minor").json()
    detail = item_of(admin, review)
    assert detail["base_semver"] == "1.0.0" and detail["current_semver"] == "1.0.0"
    assert detail["bump"] == "minor" and detail["next_semver"] == "1.1.0"
    admin.post(f"/api/admin/reviews/{review['id']}/approve", json={})
    merged = admin.post(f"/api/admin/reviews/{review['id']}/merge", json={}).json()
    assert merged["items"][0]["merged_semver"] == "1.1.0"
    assert merged["events"][-1]["body"].startswith("Aplicada como 1.1.0.")


def test_next_version_of_a_publication_request_is_1_0_0(admin):
    draft = new_draft(admin)
    review = propose(admin, draft, fields={"published": True}).json()
    assert item_of(admin, review)["next_semver"] == "1.0.0"


def test_history_entries_carry_their_semver(admin):
    page = publish(admin, new_draft(admin)["id"])
    apply_change(admin, page["id"], content="# a", bump="minor")
    apply_change(admin, page["id"], content="# b", bump="patch")
    history = admin.get(f"/api/admin/pages/{page['id']}/history").json()
    # o histórico guarda os textos anteriores: a publicação (1.0.0) não mudou o texto, então não tem entrada
    assert [h["semver"] for h in history] == ["1.1.0", "0.1.0"]
    assert get(admin, page["id"])["semver"] == "1.1.1"


def test_stale_proposal_messages_use_semver(admin):
    page = publish(admin, new_draft(admin)["id"])
    mine = propose(admin, page, "# mine", base_semver=page["semver"]).json()
    admin.post(f"/api/admin/reviews/{mine['id']}/approve", json={})
    login(admin, "rui")
    apply_change(admin, page["id"], content="# other", bump="minor")
    info = item_of(admin, mine)["merge"]
    assert info["base_semver"] == "1.0.0" and info["current_semver"] == "1.1.0"


# ---------------------------------------------------------------- versão escolhida à mão
def propose_custom(client, page, content="# novo", **extra):
    return propose(client, page, content, base_semver=page["semver"], **extra)


def test_author_can_pick_any_greater_version(admin):
    page = publish(admin, new_draft(admin)["id"])  # 1.0.0
    review = propose_custom(admin, page, bump="patch", semver="1.3.0")
    assert review.status_code == 201 and review.json()["items"][0]["semver"] == "1.3.0"
    detail = item_of(admin, review.json())
    assert detail["next_semver"] == "1.3.0" and detail["recommended_semver"] == "1.0.1"
    assert detail["semver_outdated"] is False
    admin.post(f"/api/admin/reviews/{review.json()['id']}/approve", json={})
    merged = admin.post(f"/api/admin/reviews/{review.json()['id']}/merge", json={}).json()
    assert merged["items"][0]["merged_semver"] == "1.3.0"
    assert get(admin, page["id"])["semver"] == "1.3.0"


def test_picked_version_must_be_greater_and_well_formed(admin):
    page = publish(admin, new_draft(admin)["id"])
    for bad in ("1.0.0", "0.9.9", "1.0"):
        resp = propose_custom(admin, page, semver=bad)
        assert resp.status_code in (400, 422), (bad, resp.status_code)
    assert "maior que a atual" in propose_custom(admin, page, semver="1.0.0").json()["detail"]
    assert propose_custom(admin, page, semver="1.0.1").status_code == 201


def test_comparison_is_numeric_not_textual(admin):
    page = new_draft(admin)
    page = apply_change(admin, page["id"], fields={"published": True})  # 1.0.0
    page = apply_change(admin, page["id"], content="# a", bump="minor")  # 1.1.0
    assert propose_custom(admin, page, semver="1.10.0").status_code == 201  # 1.10.0 > 1.1.0
    assert propose_custom(admin, page, semver="1.9.0").status_code == 201


def test_reviewer_can_override_the_version_when_applying(admin):
    page = publish(admin, new_draft(admin)["id"])
    review = propose_custom(admin, page, bump="patch").json()
    admin.post(f"/api/admin/reviews/{review['id']}/approve", json={})
    url = f"/api/admin/reviews/{review['id']}/merge"
    assert admin.post(url, json={"semver": {page["id"]: "1.0.0"}}).status_code == 400  # não é maior
    assert admin.post(url, json={"semver": {page["id"]: "um"}}).status_code == 422
    assert get(admin, page["id"])["semver"] == "1.0.0"  # nada foi aplicado
    merged = admin.post(url, json={"semver": {page["id"]: "2.4.1"}})
    assert merged.status_code == 200 and merged.json()["items"][0]["merged_semver"] == "2.4.1"


def test_picked_version_that_was_overtaken_falls_back_to_the_recommended(admin):
    page = publish(admin, new_draft(admin)["id"])  # 1.0.0
    mine = propose_custom(admin, page, bump="minor", semver="1.1.0").json()
    admin.post(f"/api/admin/reviews/{mine['id']}/approve", json={})
    login(admin, "rui")
    apply_change(admin, page["id"], content="# outra", bump="minor")  # a página vai a 1.1.0

    detail = item_of(admin, mine)
    assert detail["semver_outdated"] is True
    assert detail["recommended_semver"] == "1.2.0" and detail["next_semver"] == "1.2.0"
    merged = admin.post(f"/api/admin/reviews/{mine['id']}/merge", json={"force": True}).json()
    assert merged["items"][0]["merged_semver"] == "1.2.0"


def test_first_publication_can_still_be_given_another_version(admin):
    draft = new_draft(admin)
    review = propose_custom(admin, draft, content=None, fields={"published": True}, semver="2.0.0").json()
    admin.post(f"/api/admin/reviews/{review['id']}/approve", json={})
    merged = admin.post(f"/api/admin/reviews/{review['id']}/merge", json={}).json()
    assert merged["items"][0]["merged_semver"] == "2.0.0"
