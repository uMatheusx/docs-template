export const MERMAID_SNIPPETS: Record<string, { label: string; code: string }> = {
  flowchart: {
    label: "Fluxograma",
    code: `flowchart LR
    A[Início] --> B{Decisão?}
    B -- sim --> C[Processa]
    B -- não --> D[Fim]
    C --> D`,
  },
  sequence: {
    label: "Sequência",
    code: `sequenceDiagram
    participant C as Cliente
    participant API as Account Hub
    C->>API: Requisição
    API-->>C: Resposta`,
  },
  er: {
    label: "Entidade-relacionamento",
    code: `erDiagram
    ACCOUNT ||--o{ SESSION : possui
    ACCOUNT {
        string id PK
        string email
    }`,
  },
  state: {
    label: "Estados",
    code: `stateDiagram-v2
    [*] --> Ativo
    Ativo --> Suspenso
    Suspenso --> Ativo
    Ativo --> [*]`,
  },
  class: {
    label: "Classes",
    code: `classDiagram
    class Account {
        +String id
        +String email
        +activate()
    }
    Account <|-- AdminAccount`,
  },
  gantt: {
    label: "Gantt",
    code: `gantt
    title Cronograma
    dateFormat YYYY-MM-DD
    section Fase 1
    Tarefa A :a1, 2026-01-01, 10d
    Tarefa B :after a1, 7d`,
  },
  pie: {
    label: "Pizza",
    code: `pie title Distribuição
    "A" : 40
    "B" : 35
    "C" : 25`,
  },
};

export const CALLOUT_TYPES = [
  { type: "NOTE", label: "Nota" },
  { type: "TIP", label: "Dica" },
  { type: "IMPORTANT", label: "Importante" },
  { type: "WARNING", label: "Atenção" },
  { type: "CAUTION", label: "Cuidado" },
] as const;

export const TABLE_SNIPPET = `| Coluna A | Coluna B | Coluna C |
| --- | --- | --- |
| valor | valor | valor |`;
