# Plano de auditoria e logs — API Financeira

**Grupo:** _(nomes dos integrantes)_  **Turma:** _____  **Data:** ___/___/______

## 1. Contexto e objetivo
A API financeira (provedor OAuth, API de recursos e App Finanças) processa logins, emissão de tokens, consultas e transferências. O objetivo do plano é **registrar o que importa, proteger os registros e analisá-los periodicamente** para detectar e responder a incidentes.

## 2. Ferramentas de auditoria (seleção e justificativa)
| Camada | No laboratório | Em produção (recomendado) | Por quê |
|---|---|---|---|
| Geração | `src/auditoria.js` (JSON Lines) | Biblioteca de log estruturado (ex.: pino) com o mesmo formato | Um evento por linha, campos fixos: qualquer ferramenta lê sem conversão |
| Coleta/centralização | Pasta `logs/` | Filebeat → **ELK Stack** (Elasticsearch + Kibana) ou **Splunk** | Consolida logs de vários servidores; busca e correlação em segundos |
| Análise | `npm run analisar` (KPIs, correlação, relatório) | Dashboards do Kibana/Splunk + consultas salvas | Visualização, filtros e indicadores |
| Alerta | Console + `logs/alertas.log` + webhook | Regras do SIEM → Slack/Teams/e-mail/plantão | Resposta rápida a eventos críticos |

## 3. Eventos registrados
| Categoria | Eventos | Nível |
|---|---|---|
| Acesso (todas as requisições) | `HTTP_REQUISICAO` (método, rota, status, duração, IP, req_id) | INFO/AVISO/ERRO |
| Autenticação | `LOGIN_SUCESSO`, `LOGIN_FALHA`, `CLIENTE_AUTH_FALHA`, `CONSENTIMENTO_NEGADO` | INFO/AVISO |
| Tokens | `TOKEN_EMITIDO` (com `jti`), `TOKEN_RECUSADO`, `TOKEN_REVOGADO`, `REFRESH_REUSO` | INFO/AVISO/**CRITICO** |
| Autorização | `ACESSO_PERMITIDO`, `ACESSO_NEGADO` (401/403 + motivo), `AUTORIZACAO_RECUSADA` | INFO/AVISO |
| Operações sensíveis | `OPERACAO_SENSIVEL` (transferências) | INFO |
| Ataques detectados | `ALERTA_FORCA_BRUTA`, `ALERTA_TOKEN_ADULTERADO`, `REQUISICAO_BLOQUEADA` | **CRITICO**/AVISO |
| Falhas | `ERRO_SERVIDOR` | ERRO |

**Nunca registrar em claro:** senhas, `client_secret`, tokens, código de autorização, query string. Tokens viram impressão digital (`sha256:…`); o login digitado errado vai **cifrado (AES-256-GCM)**.

## 4. Configuração e proteção dos logs
- **Integridade:** HMAC encadeado — cada linha assina o conteúdo + o hash da anterior; edição ou remoção é apontada pela verificação.
- **Confidencialidade:** arquivos com permissão restrita, dados sensíveis cifrados, chaves em cofre/variável de ambiente, `logs/` fora do Git.
- **Rotação:** novo arquivo ao atingir `LOG_MAX_BYTES` (lab: 256 KB; produção: diária ou 100 MB).
- **Retenção:** manter `LOG_RETENCAO_ARQUIVOS` arquivos / `LOG_RETENCAO_DIAS` dias localmente; no SIEM, 90 dias quentes + 1 ano arquivado (ajustar à LGPD e às normas do setor financeiro).
- **Correlação:** `X-Request-Id` propagado do App Finanças ao provedor e à API; `jti` liga o token emitido a cada uso.

## 5. Análise periódica e resposta
| Frequência | O que fazer | Indicador / meta |
|---|---|---|
| Tempo real | Alertas críticos (força bruta, token adulterado, reuso de refresh) | 0 alertas não tratados |
| Diária | `npm run analisar`: KPIs, IPs suspeitos, recomendações | Falha de login < 20%; erro HTTP < 10% |
| Semanal | Revisar 403 (escalonamento), novos IPs, clientes com falhas | Tendência estável |
| Mensal | Verificar integridade de todos os arquivos, revisar regras e limites | Integridade 100% |

**Procedimento de incidente:** (1) alerta recebido → (2) rastrear por IP/`req_id`/`jti` → (3) conter (bloquear IP, revogar tokens) → (4) comunicar → (5) registrar lições aprendidas e ajustar regras.

## 6. Evidências do laboratório
- [ ] `npm test` com 25 + 27 OK
- [ ] Saída do `npm run simular` com os 429
- [ ] Relatório `relatorio/relatorio-auditoria.html` (print dos KPIs e alertas)
- [ ] Bloqueio pelo navegador (5 senhas erradas → 429)
- [ ] Adulteração detectada pelo analisador (linha apontada)
- [ ] Rotação observada com `LOG_MAX_BYTES` pequeno

## Referências
- SEDUC-SP. *Rastreando ameaças: auditoria e logs para APIs seguras* — Programação Back-End, 2ª série, 4º bimestre, semana 25, aula 3.
- [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)
- [NIST SP 800-92 — Guide to Computer Security Log Management](https://csrc.nist.gov/pubs/sp/800/92/final)
