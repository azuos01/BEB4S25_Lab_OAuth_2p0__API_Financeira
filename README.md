# Laboratório OAuth 2.0 — API Financeira

Atividade de Programação Back-End (2ª série, 4º bimestre, semana 25, aula 1). Sem dependências externas: apenas Node.js 20+.

| Papel OAuth | Arquivo | Porta |
|---|---|---|
| Servidor de Autorização | `src/auth-server.js` | 4000 |
| Servidor de Recursos (API) | `src/api-financeira.js` | 5000 |
| Cliente (App Finanças) | `src/cliente-web.js` | 3000 |

```powershell
npm test      # testes automáticos de segurança
npm start     # sobe os três servidores -> abra http://localhost:3000 (aluno / senha123)
npm run cc    # (outro terminal) demonstração Client Credentials
$env:ACCESS_TTL=20; npm start   # tokens de 20 s para observar a expiração
```

Plano de implementação do grupo: `docs/plano-oauth.md`.
