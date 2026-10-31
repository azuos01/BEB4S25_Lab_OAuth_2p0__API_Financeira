# Plano de implementação de OAuth 2.0 — API Financeira

**Grupo:** _(nomes dos integrantes)_  **Turma:** _____  **Data:** ___/___/______

## 1. Contexto
A API financeira expõe saldo, extrato e transferências. Ela é consumida por (a) um aplicativo web usado por pessoas e (b) um serviço interno de relatórios que roda sem usuário. Objetivo: permitir esse acesso **sem que nenhuma aplicação conheça a senha do usuário**, com permissões mínimas e tokens de vida curta.

## 2. Escolha do fluxo (justificativa)
| Cliente | Fluxo escolhido | Por quê |
|---|---|---|
| App Finanças (web, com back-end) | **Authorization Code + PKCE** | O usuário se autentica só no provedor; o código trafega pelo navegador mas só vale junto com o `code_verifier` (PKCE) e o `client_secret`, que ficam no back-end. É o fluxo recomendado pelas boas práticas atuais (RFC 9700 / OAuth 2.1). |
| SPA ou app mobile (futuro) | **Authorization Code + PKCE** (cliente público, sem segredo) | O **Implicit Flow** foi descontinuado: entrega o token na URL, expondo-o a histórico, logs e scripts. |
| Serviço de Relatórios | **Client Credentials** | Comunicação servidor-servidor: não existe usuário, a aplicação age em nome próprio. Não recebe refresh token. |

## 3. Configuração
1. **Registro da aplicação** no provedor (no laboratório: `src/config.js`): `client_id`, `client_secret` (guardado em variável de ambiente/cofre, nunca no Git), tipo de cliente e fluxos permitidos (`grant_types`).
2. **URLs de redirecionamento**: lista exata, sempre HTTPS em produção (`https://app.exemplo.com.br/callback`), sem curingas. O provedor recusa qualquer outra — no lab, `http://site-malicioso.exemplo/callback` é bloqueada.
3. **Escopos** (menor privilégio):

| Escopo | Permite | Quem recebe |
|---|---|---|
| `saldo:read` | Consultar saldo | App Finanças |
| `transacoes:read` | Consultar extrato | App Finanças |
| `transacoes:write` | Transferências | Somente com consentimento explícito e, idealmente, autenticação forte (MFA) |
| `relatorios:read` | Relatório consolidado | Serviço de Relatórios |

4. **Proteções do pedido**: `state` aleatório por pedido (anti-CSRF), PKCE `S256` obrigatório, código de autorização de **uso único** com validade de 60 s.
5. **Validação na API**: assinatura do JWT, `exp`, `iss`, `aud` e escopo por rota — 401 para token inválido/expirado, 403 para escopo insuficiente.

## 4. Gestão de tokens
| Token | Formato | Validade | Onde fica |
|---|---|---|---|
| Access token | JWT assinado | 5–15 min (lab: 2 min) | Memória do back-end do cliente |
| Refresh token | Opaco (aleatório) | 30 min a alguns dias, conforme risco | Back-end do cliente (nunca em localStorage) |
| Código de autorização | Opaco | 60 s, uso único | Trafega uma vez pelo navegador |

**Exemplo prático:** às 10h00 o usuário autoriza o app e recebe access (expira 10h05) + refresh. Às 10h06 a API responde 401 → o back-end usa o refresh e recebe um **novo par** (rotação); o refresh antigo é invalidado. Se alguém reutilizar o refresh antigo, o provedor detecta o **reuso** e revoga toda a família de tokens, forçando novo login. No logout, o app chama `/revoke`.

## 5. Comunicação com a equipe
- Resumo de uma página + diagrama de sequência do fluxo; decisão registrada (ADR) no repositório.
- Checklist obrigatório em code review (PKCE, `state`, redirect exato, escopos mínimos, segredos fora do código, validação `iss/aud/exp`).
- Testes automatizados de segurança no CI (`npm test`) — o pipeline falha se uma regra for quebrada.
- Demonstração ao vivo no laboratório e canal único de dúvidas; revisão do plano a cada mudança de escopo.

## 6. Evidências do laboratório
- [ ] Print do `npm test` com 25 OK
- [ ] Print do consentimento no provedor e das claims do token
- [ ] Print do 403 (escopo) e do erro de redirect_uri
- [ ] Print da renovação e da detecção de reuso
- [ ] Saída do `npm run cc`

## Referências
- SEDUC-SP. *Descomplicando o OAuth: autorização segura para APIs* — Programação Back-End, 2ª série, 4º bimestre, semana 25, aula 1.
- [RFC 6749 — The OAuth 2.0 Authorization Framework](https://www.rfc-editor.org/rfc/rfc6749)
- [RFC 7636 — PKCE](https://www.rfc-editor.org/rfc/rfc7636)
- [RFC 9700 — Best Current Practice for OAuth 2.0 Security](https://www.rfc-editor.org/rfc/rfc9700)
