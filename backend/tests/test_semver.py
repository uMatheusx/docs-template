import os

import boto3

from .conftest import apply_change, find, login, publish


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


def test_each_direct_draft_save_bumps_the_patch(admin):
    page = new_draft(admin)
    v2 = admin.put(f"/api/admin/pages/{page['id']}", json={"content": "# dois", "version": 1}).json()
    v3 = admin.put(f"/api/admin/pages/{page['id']}", json={"description": "x", "version": 2}).json()
    assert (v2["semver"], v3["semver"]) == ("0.1.1", "0.1.2")
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
    url = f"/api/admin/pages/{page['id']}/reviews"
    base = {"title": "T", "description": "D", "content": "# x", "base_version": page["version"]}
    created = admin.post(url, json=base)
    assert created.status_code == 201 and created.json()["bump"] == "patch"
    assert admin.post(url, json={**base, "bump": "gigante"}).status_code == 422
    assert admin.post(url, json={**base, "base_semver": "v1"}).status_code == 422


def test_review_detail_shows_versions_and_next_version(admin):
    page = publish(admin, new_draft(admin)["id"])
    review = admin.post(
        f"/api/admin/pages/{page['id']}/reviews",
        json={
            "title": "T",
            "description": "D",
            "content": "# x",
            "base_version": page["version"],
            "base_semver": page["semver"],
            "bump": "minor",
        },
    ).json()
    detail = admin.get(f"/api/admin/reviews/{review['id']}").json()
    assert detail["base_semver"] == "1.0.0" and detail["current_semver"] == "1.0.0"
    assert detail["bump"] == "minor" and detail["next_semver"] == "1.1.0"
    admin.post(f"/api/admin/reviews/{review['id']}/approve", json={})
    merged = admin.post(f"/api/admin/reviews/{review['id']}/merge", json={}).json()
    assert merged["merged_semver"] == "1.1.0"
    assert merged["events"][-1]["body"].startswith("Aplicada como 1.1.0.")


def test_next_version_of_a_publication_request_is_1_0_0(admin):
    draft = new_draft(admin)
    review = admin.post(
        f"/api/admin/pages/{draft['id']}/reviews",
        json={
            "title": "T",
            "description": "D",
            "fields": {"published": True},
            "base_version": 1,
            "bump": "patch",
        },
    ).json()
    assert admin.get(f"/api/admin/reviews/{review['id']}").json()["next_semver"] == "1.0.0"


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
    mine = admin.post(
        f"/api/admin/pages/{page['id']}/reviews",
        json={
            "title": "T",
            "description": "D",
            "content": "# mine",
            "base_version": page["version"],
            "base_semver": page["semver"],
        },
    ).json()
    admin.post(f"/api/admin/reviews/{mine['id']}/approve", json={})
    login(admin, "rui")
    apply_change(admin, page["id"], content="# other", bump="minor")
    info = admin.get(f"/api/admin/reviews/{mine['id']}").json()["merge"]
    assert info["base_semver"] == "1.0.0" and info["current_semver"] == "1.1.0"


def test_pages_saved_before_semver_get_an_equivalent_version(admin):
    faq = find(admin.get("/api/admin/tree").json(), "faq")
    updated = apply_change(admin, faq["id"], content="# x")  # revisão 2
    table = boto3.resource("dynamodb", region_name="us-east-1").Table(
        os.environ.get("DYNAMODB_TABLE", "accounthub-docs-pages")
    )
    table.update_item(Key={"id": faq["id"]}, UpdateExpression="REMOVE semver")
    assert updated["version"] == 2
    legacy = find(admin.get("/api/tree").json(), "faq")
    assert legacy["semver"] == "1.0.1"  # revisão 2 → 1.0.1
    next_one = apply_change(admin, faq["id"], content="# y")
    assert next_one["semver"] == "1.0.2"
