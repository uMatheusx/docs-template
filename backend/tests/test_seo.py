from app import main
from app.seo import page_meta, render_index

HTML = (
    '<html><head><meta name="description" content="Documentação do Account Hub" />'
    "<title>Account Hub Docs</title></head><body></body></html>"
)


def test_render_index_injects_and_escapes():
    meta = page_meta(site_name="Docs", title='Tokens <v2> & "escopos"', description="Uso de <b>OAuth</b>", url="https://x/y")
    html = render_index(HTML, meta, site_name="Docs")
    assert "<title>Tokens &lt;v2&gt; &amp; &quot;escopos&quot; · Docs</title>" in html
    assert '<meta name="description" content="Uso de &lt;b&gt;OAuth&lt;/b&gt;" />' in html
    assert '<meta property="og:type" content="article" />' in html
    assert '<meta property="og:url" content="https://x/y" />' in html
    assert html.count("<title>") == 1 and "<b>" not in html


def test_share_meta_for_published_page(client):
    meta = main._share_meta("docs/guias/autenticacao", "https://docs.exemplo/docs/guias/autenticacao")
    assert meta["og_title"] == "Autenticação"
    assert meta["description"] == "Fluxo OAuth 2.0 / OIDC com o Account Hub."


def test_share_meta_home_and_unknown_are_generic(client):
    assert main._share_meta("docs", "u")["og_title"] == main.settings.site_name
    assert main._share_meta("docs/nao-existe", "u")["description"] == main.settings.site_description


def test_share_meta_hides_drafts(admin):
    admin.post("/api/admin/pages", json={"title": "Plano secreto", "published": False})
    assert main._share_meta("docs/plano-secreto", "u")["og_title"] == main.settings.site_name


def test_share_meta_respects_private_docs(client, monkeypatch):
    monkeypatch.setattr(main.settings, "public_read", False)
    assert main._share_meta("docs/guias/autenticacao", "u")["og_title"] == main.settings.site_name
