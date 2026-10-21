---
title: Instalação
icon: Download
description: Requisitos e passo a passo para rodar localmente.
---

# Instalação

## Requisitos

- Docker 24+ e Docker Compose v2
- (Opcional) Node.js 22+ e Python 3.11 para desenvolvimento sem Docker

## Subindo com Docker

```bash
cp .env.example .env
docker compose up --build
```

A aplicação ficará disponível em `http://localhost:8000`.

> [!IMPORTANT]
> Troque `ADMIN_PASSWORD` e `JWT_SECRET` antes de publicar em qualquer ambiente compartilhado.

## Desenvolvimento local

```bash
# backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload

# frontend (outro terminal)
cd frontend
npm install
npm run dev
```
