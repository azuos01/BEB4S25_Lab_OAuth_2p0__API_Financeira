# Laboratório OAuth 2.0 + Auditoria e Logs — API Financeira

Programação Back-End (2ª série, 4º bimestre, semana 25): **aula 1** (OAuth) e **aula 3** (auditoria e logs). Sem dependências externas: apenas Node.js 20+.

| Papel | Arquivo | Porta |
|---|---|---|
| Servidor de Autorização | `src/auth-server.js` | 4000 |
| Servidor de Recursos (API) | `src/api-financeira.js` | 5000 |
| Cliente (App Finanças) | `src/cliente-web.js` | 3000 |
| Auditoria (logs, alertas, integridade) | `src/auditoria.js` | — |

```powershell
npm test               # 25 testes OAuth + 27 testes de auditoria
npm start              # sobe os três servidores -> http://localhost:3000 (aluno / senha123)
npm run simular        # (outro terminal) tráfego normal + ataques
npm run analisar       # KPIs, alertas, integridade -> relatorio\relatorio-auditoria.html
node src\analisar-logs.js --decifrar        # logins digitados nas falhas (restrito)
node src\analisar-logs.js --req=<req_id>    # rastreia uma requisição ponta a ponta
$env:LOG_MAX_BYTES=8000; npm start          # força rotação rápida dos logs
```

Logs em `logs/` (fora do Git): `auditoria.log` (+ rotacionados) e `alertas.log`.
Planos do grupo: `docs/plano-oauth.md` (aula 1) e `docs/plano-auditoria.md` (aula 3).
