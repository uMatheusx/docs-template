---
title: Referência da API
icon: Code
description: Endpoints REST do Account Hub.
---

# Referência da API

Base URL: `https://api.example.com/v1`

## Contas

### `GET /accounts/{id}`

Retorna uma conta.

```bash
curl -H "Authorization: Bearer $TOKEN" https://api.example.com/v1/accounts/acc_123
```

```json
{
  "id": "acc_123",
  "email": "maria@example.com",
  "status": "active",
  "organization_id": "org_42",
  "created_at": "2026-01-15T10:22:00Z"
}
```

### `POST /accounts`

| Campo | Tipo | Obrigatório | Descrição |
| --- | --- | :---: | --- |
| `email` | string | ✅ | E-mail único |
| `name` | string | ✅ | Nome de exibição |
| `organization_id` | string | ❌ | Organização inicial |

## Erros

| Código | Significado |
| --- | --- |
| `400` | Payload inválido |
| `401` | Token ausente ou expirado |
| `403` | Sem permissão no escopo |
| `404` | Recurso não encontrado |
| `409` | Conflito de versão |
