---
title: Configuração
icon: Settings
description: Variáveis de ambiente suportadas.
---

# Configuração

Todas as opções são lidas de variáveis de ambiente.

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `AWS_REGION` | `us-east-1` | Região AWS |
| `DYNAMODB_TABLE` | `accounthub-docs` | Tabela com os metadados (páginas, histórico, revisões, arquivos) |
| `S3_BUCKET` | `accounthub-docs` | Bucket com os textos das versões, propostas e arquivos |
| `PUBLIC_READ` | `true` | Se `false`, exige login para ler a doc |
| `SEED_ON_STARTUP` | `false` | Cria páginas de exemplo se a tabela estiver vazia |

> [!WARNING]
> Em produção deixe `DYNAMODB_ENDPOINT_URL` e `S3_ENDPOINT_URL` vazios para usar os endpoints reais da AWS.
