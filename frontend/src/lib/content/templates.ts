import type { PageKind, Template } from "@/lib/api";

export interface PageTemplate {
  id: string;
  name: string;
  description: string;
  icon: string | null;
  kind: PageKind;
  content: string;
  /** modelos criados pelo time (guardados no S3) */
  custom?: Template;
}

const GUIDE = `# {{title}}

Explique em uma ou duas frases o que a pessoa vai conseguir fazer ao fim deste guia.

> [!NOTE]
> **Antes de começar:** tenha acesso ao ambiente de sandbox e um token de API com o escopo \`accounts:write\`.

## 1. Prepare o ambiente

Descreva o primeiro passo.

\`\`\`bash
curl -H "Authorization: Bearer $TOKEN" https://api.example.com/v1/accounts
\`\`\`

## 2. Faça a integração

Descreva o segundo passo.

## 3. Valide o resultado

Como saber que deu certo?

## Referência

A especificação abaixo vem da página de referência da API e fica sempre atualizada:

\`\`\`openapi
ref: /docs/referencia-api/api-rest
operations:
  - GET /accounts
\`\`\`

## Próximos passos

- [Referência da API](/docs/referencia-api)
`;

const RUNBOOK = `# {{title}}

| | |
|---|---|
| **Serviço** | account-hub |
| **Severidade** | SEV-2 |
| **Responsável** | {{author}} |
| **Atualizado em** | {{date}} |

## Sintomas

- Alerta disparado: \`nome-do-alerta\`
- O que o usuário percebe

## Diagnóstico

1. Verifique o painel de métricas do serviço.
2. Consulte os logs:

\`\`\`bash
kubectl logs -l app=account-hub --since=15m | grep ERROR
\`\`\`

## Mitigação

> [!WARNING]
> Descreva o que **não** fazer durante a mitigação.

1. Passo de mitigação imediata.
2. Como confirmar que o serviço normalizou.

## Escalonamento

| Quando | Quem |
|---|---|
| Sem melhora em 30 min | Plantão de plataforma |

## Pós-incidente

- [ ] Abrir o post-mortem
- [ ] Atualizar este runbook
`;

const ADR = `# {{title}}

| Status | Data | Decisores |
|---|---|---|
| Proposta | {{date}} | {{author}} |

## Contexto

Qual problema estamos resolvendo? Quais forças e restrições estão em jogo?

## Opções consideradas

1. **Opção A** — prós e contras.
2. **Opção B** — prós e contras.

## Decisão

Escolhemos a **opção A** porque…

## Consequências

- O que fica mais fácil
- O que fica mais difícil
- O que precisa ser acompanhado

\`\`\`mermaid
flowchart LR
  A[Situação atual] --> B{Decisão}
  B --> C[Opção A]
  B -.descartada.-> D[Opção B]
\`\`\`
`;

const RELEASE_NOTES = `# {{title}}

Publicado em {{date}}.

## Novidades

- **Recurso** — o que mudou e por que importa.

## Melhorias

- Descrição da melhoria.

## Correções

- Descrição da correção.

## Mudanças incompatíveis

> [!CAUTION]
> Descreva o que integradores precisam alterar e até quando.

## Como atualizar

\`\`\`bash
npm install @account-hub/sdk@latest
\`\`\`
`;

const SERVICE = `# {{title}}

Uma frase sobre a responsabilidade do serviço.

## Arquitetura

\`\`\`mermaid
flowchart LR
  Client[Cliente] --> API[{{title}}]
  API --> DB[(DynamoDB)]
  API --> Queue[[Eventos]]
\`\`\`

## Responsabilidades

- O que este serviço faz
- O que ele **não** faz

## Dependências

| Serviço | Tipo | Criticidade |
|---|---|---|
| DynamoDB | Banco de dados | Alta |

## Operação

- **Time responsável:** {{author}}
- **Dashboards:** link
- **Runbooks:** link
`;

const FAQ = `# {{title}}

Respostas para as dúvidas mais comuns.

## Como faço para…?

Resposta direta, com link para o guia completo.

## Por que…?

Explique o motivo e o que fazer a respeito.

## Onde encontro…?

Aponte para a página certa.

> [!TIP]
> Não achou sua dúvida? Fale com o time pelo canal #account-hub.
`;

const OPENAPI = `openapi: 3.0.3
info:
  title: {{title}}
  version: 1.0.0
  description: |
    Descreva a API: para que serve e como autenticar.
# x-environment: nome do ambiente na documentação; x-default: usado nos exemplos de código
servers:
  - url: https://api.dev.example.com/v1
    x-environment: Desenvolvimento
    description: Integração contínua do time.
  - url: https://api.hml.example.com/v1
    x-environment: Homologação
    description: Validação antes de cada release.
  - url: https://sandbox.api.example.com/v1
    x-environment: Sandbox
    x-default: true
    description: Testes de parceiros com dados fictícios.
  - url: https://api.example.com/v1
    x-environment: Produção
    description: Dados reais.
tags:
  - name: Recursos
paths:
  /recursos:
    get:
      tags: [Recursos]
      summary: Lista recursos
      operationId: listarRecursos
      parameters:
        - name: limit
          in: query
          schema: { type: integer, default: 20, maximum: 100 }
      responses:
        "200":
          description: Lista paginada
          content:
            application/json:
              schema:
                type: object
                properties:
                  items:
                    type: array
                    items: { $ref: "#/components/schemas/Recurso" }
    post:
      tags: [Recursos]
      summary: Cria um recurso
      operationId: criarRecurso
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/Recurso" }
      responses:
        "201":
          description: Criado
components:
  securitySchemes:
    bearer:
      type: http
      scheme: bearer
  schemas:
    Recurso:
      type: object
      required: [nome]
      properties:
        id: { type: string, readOnly: true, example: rec_123 }
        nome: { type: string, example: Exemplo }
security:
  - bearer: []
`;

const ASYNCAPI = `asyncapi: 3.0.0
info:
  title: {{title}}
  version: 1.0.0
  description: Eventos publicados pelo serviço.
servers:
  desenvolvimento:
    host: kafka.dev.example.com:9092
    protocol: kafka
    title: Desenvolvimento
  homologacao:
    host: kafka.hml.example.com:9093
    protocol: kafka-secure
    title: Homologação
  sandbox:
    host: kafka.sandbox.example.com:9093
    protocol: kafka-secure
    title: Sandbox
  producao:
    host: kafka.example.com:9093
    protocol: kafka-secure
    title: Produção
channels:
  recursoCriado:
    address: recursos.criado.v1
    messages:
      RecursoCriado:
        $ref: "#/components/messages/RecursoCriado"
operations:
  publicarRecursoCriado:
    action: send
    channel:
      $ref: "#/channels/recursoCriado"
    summary: Publicado quando um recurso é criado
components:
  messages:
    RecursoCriado:
      contentType: application/json
      payload:
        type: object
        properties:
          id: { type: string, example: rec_123 }
          criadoEm: { type: string, format: date-time }
`;

export const BUILTIN_TEMPLATES: PageTemplate[] = [
  { id: "blank", name: "Página em branco", description: "Comece do zero, só com o título.", icon: "FileText", kind: "doc", content: "# {{title}}\n\n" },
  { id: "guide", name: "Guia passo a passo", description: "Tutorial com pré-requisitos, etapas e próximos passos.", icon: "Compass", kind: "doc", content: GUIDE },
  { id: "runbook", name: "Runbook", description: "Sintomas, diagnóstico, mitigação e escalonamento.", icon: "LifeBuoy", kind: "doc", content: RUNBOOK },
  { id: "adr", name: "Decisão de arquitetura", description: "ADR com contexto, opções, decisão e consequências.", icon: "Scale", kind: "doc", content: ADR },
  { id: "release-notes", name: "Notas de release", description: "Novidades, correções e mudanças incompatíveis.", icon: "Megaphone", kind: "doc", content: RELEASE_NOTES },
  { id: "service", name: "Visão geral de serviço", description: "Arquitetura, dependências e operação de um serviço.", icon: "Server", kind: "doc", content: SERVICE },
  { id: "faq", name: "Perguntas frequentes", description: "Respostas curtas para dúvidas recorrentes.", icon: "CircleHelp", kind: "doc", content: FAQ },
  { id: "openapi", name: "Referência OpenAPI", description: "API REST interativa, com “Testar” e exemplos de código.", icon: "Plug", kind: "openapi", content: OPENAPI },
  { id: "asyncapi", name: "Referência AsyncAPI", description: "Canais e mensagens de eventos assíncronos.", icon: "Webhook", kind: "asyncapi", content: ASYNCAPI },
];

export const fromCustom = (t: Template): PageTemplate => ({
  id: `custom:${t.id}`,
  name: t.name,
  description: t.description,
  icon: t.icon,
  kind: t.kind,
  content: t.content,
  custom: t,
});

/** Preenche {{title}}, {{date}} e {{author}}. */
export function fillTemplate(content: string, values: { title: string; author: string }) {
  const date = new Date().toLocaleDateString("pt-BR");
  return content.replace(/\{\{\s*(title|date|author)\s*\}\}/g, (_, key: string) =>
    key === "title" ? values.title : key === "date" ? date : values.author,
  );
}
