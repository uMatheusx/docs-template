"""Metadados de compartilhamento (Open Graph / Twitter) no HTML da SPA.

Robôs de chats e redes sociais não executam JavaScript: título e descrição de cada página
precisam sair prontos no index.html servido para /docs/<caminho>.
"""

import re
from html import escape

TITLE_RE = re.compile(r"<title>.*?</title>", re.S)
DESCRIPTION_RE = re.compile(r'<meta\s+name="description"[^>]*>', re.S)


def page_meta(*, site_name: str, title: str | None, description: str, url: str) -> dict[str, str]:
    full_title = f"{title} · {site_name}" if title else site_name
    return {"title": full_title, "og_title": title or site_name, "description": description, "url": url}


def render_index(html: str, meta: dict[str, str], *, site_name: str) -> str:
    title = escape(meta["title"])
    description = escape(meta["description"])
    tags = "\n".join(
        [
            f'<meta property="og:type" content="{"article" if meta["og_title"] != site_name else "website"}" />',
            f'<meta property="og:site_name" content="{escape(site_name)}" />',
            f'<meta property="og:title" content="{escape(meta["og_title"])}" />',
            f'<meta property="og:description" content="{description}" />',
            f'<meta property="og:url" content="{escape(meta["url"])}" />',
            '<meta name="twitter:card" content="summary" />',
            f'<meta name="twitter:title" content="{escape(meta["og_title"])}" />',
            f'<meta name="twitter:description" content="{description}" />',
        ]
    )
    html = TITLE_RE.sub(lambda _: f"<title>{title}</title>", html, count=1)
    html = DESCRIPTION_RE.sub(lambda _: f'<meta name="description" content="{description}" />', html, count=1)
    return html.replace("</head>", f"{tags}\n</head>", 1)
