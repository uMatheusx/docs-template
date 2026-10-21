---
title: Autenticação
icon: KeyRound
description: Fluxo OAuth 2.0 / OIDC com o Account Hub.
---

# Autenticação

O Account Hub implementa **OAuth 2.0 Authorization Code com PKCE**.

```mermaid
sequenceDiagram
    autonumber
    participant U as Usuário
    participant App as Aplicação
    participant AH as Account Hub
    U->>App: Clica em "Entrar"
    App->>AH: /authorize (code_challenge)
    AH->>U: Tela de login
    U->>AH: Credenciais
    AH-->>App: redirect com code
    App->>AH: /token (code + code_verifier)
    AH-->>App: access_token + id_token
    App->>U: Sessão iniciada
```

## Exemplo de troca de token

```ts
const response = await fetch("https://accounts.example.com/oauth/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    redirect_uri: "https://app.example.com/callback",
  }),
});
const { access_token } = await response.json();
```

> [!CAUTION]
> Nunca armazene `client_secret` em aplicações que rodam no navegador.
