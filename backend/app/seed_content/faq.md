---
title: FAQ
icon: CircleHelp
description: Perguntas frequentes.
---

# Perguntas frequentes

## Onde ficam salvos os dados?

Os **metadados** das páginas (título, slug, hierarquia, ordem) ficam no **DynamoDB**. O **conteúdo markdown**, o **histórico de versões** e os **arquivos de mídia** ficam no **S3**.

## Como editar uma página?

Entre em `/admin`, selecione a página na árvore e use o editor com pré-visualização ao vivo. Você também pode **arrastar um arquivo `.md`** para o editor ou importar vários de uma vez.

## Posso restaurar uma versão anterior?

Sim. Cada versão publicada guarda o texto anterior no histórico. Use a aba **Histórico** no editor.

## Como esconder uma página?

Desmarque **Publicada**. Ela continua visível apenas para administradores logados.
