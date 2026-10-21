---
title: Guia de escrita
icon: PenLine
description: Todos os recursos de markdown suportados pela documentação.
---

# Guia de escrita

Esta página demonstra tudo o que o renderizador suporta. Use-a como referência ao editar.

## Texto

Texto em **negrito**, *itálico*, ~~riscado~~, `código inline` e [links](https://example.com).

## Alertas

> [!NOTE]
> Informação útil que o leitor deve saber.

> [!TIP]
> Uma dica para fazer algo melhor.

> [!IMPORTANT]
> Informação essencial.

> [!WARNING]
> Requer atenção imediata.

> [!CAUTION]
> Consequências negativas de uma ação.

## Código

```python
from fastapi import FastAPI

app = FastAPI()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
```

## Mermaid

Qualquer bloco de código com a linguagem `mermaid` vira diagrama:

```mermaid
gantt
    title Roadmap
    dateFormat YYYY-MM-DD
    section Plataforma
    SSO corporativo        :done, 2026-01-01, 30d
    Permissões temporárias :active, 2026-02-01, 45d
    Auditoria exportável   :2026-03-20, 30d
```

```mermaid
pie title Logins por método
    "Senha" : 42
    "SSO" : 38
    "Passkey" : 20
```

## Tabelas e listas

| Recurso | Suporte |
| --- | --- |
| Tabelas GFM | ✅ |
| Listas de tarefas | ✅ |
| Notas de rodapé | ✅ |

- [x] Item concluído
- [ ] Item pendente

Uma nota de rodapé[^1].

[^1]: Notas de rodapé aparecem no fim da página.

## Imagens

Envie imagens pelo editor (botão **Imagem**, colando ou arrastando o arquivo) — elas são salvas no S3 e servidas por `/api/assets/...`.
