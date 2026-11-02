// =============================================================
// teste-auditoria.js — Testes automáticos do Laboratório 2
// (npm run test:auditoria) — logs, alertas, integridade, rotação
// =============================================================
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PASTA = fs.mkdtempSync(path.join(os.tmpdir(), 'auditoria-teste-'));
Object.assign(process.env, {
  AUTH_PORT: '24000', API_PORT: '25000', CLIENT_PORT: '23000', OAUTH_QUIET: '1',
  LOG_DIR: PASTA, LOG_MAX_BYTES: '20000', LOG_RETENCAO_ARQUIVOS: '50', LIMITE_FALHAS: '5', JANELA_S: '60', BLOQUEIO_S: '300',
});

const cfg = require('../src/config');
const jwt = require('../src/jwt');
const auditoria = require('../src/auditoria');
const { analisar } = require('../src/analisar-logs');
const { sha256b64url, aleatorio } = require('../src/util');

const AUTH = cfg.EMISSOR;
const API = `http://localhost:${cfg.PORTAS.api}`;
const WEB = cfg.CLIENTES[0];
const basic = (c) => `Basic ${Buffer.from(`${c.client_id}:${c.client_secret}`).toString('base64')}`;
const eventos = (tipo) => auditoria.memoria.filter((e) => e.tipo === tipo);

let ok = 0;
let falhas = 0;
function verificar(descricao, condicao, detalhe = '') {
  if (condicao) { ok++; console.log(`  [OK]    ${descricao}`); }
  else { falhas++; console.log(`  [FALHA] ${descricao}${detalhe ? ` -> ${detalhe}` : ''}`); }
}

async function login(ip, senha = 'senha123') {
  const v = aleatorio(32);
  const r = await fetch(`${AUTH}/authorize`, {
    method: 'POST', redirect: 'manual', headers: { 'X-Forwarded-For': ip },
    body: new URLSearchParams({ response_type: 'code', client_id: WEB.client_id, redirect_uri: WEB.redirect_uris[0], scope: 'saldo:read transacoes:read', state: 'st', code_challenge: sha256b64url(v), code_challenge_method: 'S256', login: 'aluno', senha, decisao: 'permitir' }),
  });
  const loc = r.headers.get('location');
  return { status: r.status, code: loc ? new URL(loc).searchParams.get('code') : null, v };
}

async function token(params, ip = '10.0.0.5') {
  const r = await fetch(`${AUTH}/token`, { method: 'POST', headers: { Authorization: basic(WEB), 'X-Forwarded-For': ip }, body: new URLSearchParams(params) });
  return { status: r.status, corpo: await r.json() };
}

(async () => {
  await require('../src/auth-server').iniciar();
  await require('../src/api-financeira').iniciar();
  await require('../src/cliente-web').iniciar();
  console.log(`\nTestes do Laboratório 2 — auditoria e logs (pasta ${PASTA})\n`);

  console.log('1. Log de acesso e correlação');
  const r0 = await fetch(`${AUTH}/.well-known/oauth-authorization-server`, { headers: { 'X-Request-Id': 'teste-correlacao-001' } });
  verificar('X-Request-Id válido é devolvido na resposta', r0.headers.get('x-request-id') === 'teste-correlacao-001');
  verificar('HTTP_REQUISICAO registrada com o mesmo req_id', eventos('HTTP_REQUISICAO').some((e) => e.req_id === 'teste-correlacao-001' && e.status === 200));
  const r1 = await fetch(`${AUTH}/`, { headers: { 'X-Request-Id': 'x"}{inj' } });
  verificar('X-Request-Id inválido é substituído (anti-injeção)', /^[0-9a-f-]{36}$/.test(r1.headers.get('x-request-id')));

  console.log('2. Eventos de autenticação');
  const falha = await login('10.1.1.1', 'senha-errada-xyz');
  const ev = eventos('LOGIN_FALHA').at(-1);
  verificar('login inválido -> LOGIN_FALHA (AVISO) com IP', falha.status === 401 && ev?.nivel === 'AVISO' && ev?.ip === '10.1.1.1');
  verificar('login digitado é gravado cifrado e pode ser decifrado com a chave', ev?.login_cifrado?.startsWith('gcm:') && auditoria.decifrar(ev.login_cifrado) === 'aluno');
  const l = await login('10.1.1.2');
  verificar('login válido -> LOGIN_SUCESSO', l.code && eventos('LOGIN_SUCESSO').at(-1)?.ip === '10.1.1.2');
  const t = await token({ grant_type: 'authorization_code', code: l.code, redirect_uri: WEB.redirect_uris[0], code_verifier: l.v });
  const jti = jwt.decodificar(t.corpo.access_token).jti;
  verificar('TOKEN_EMITIDO traz o jti do token', eventos('TOKEN_EMITIDO').some((e) => e.jti === jti));

  console.log('3. Eventos da API');
  await fetch(`${API}/transacoes`, { headers: { Authorization: `Bearer ${t.corpo.access_token}` } });
  verificar('ACESSO_PERMITIDO correlacionável ao token pelo jti', eventos('ACESSO_PERMITIDO').some((e) => e.jti === jti && e.escopo === 'transacoes:read'));
  await fetch(`${API}/transferencias`, { method: 'POST', headers: { Authorization: `Bearer ${t.corpo.access_token}` } });
  verificar('403 -> ACESSO_NEGADO com escopo exigido', eventos('ACESSO_NEGADO').some((e) => e.status === 403 && e.escopo_exigido === 'transacoes:write'));
  const [h, , s] = t.corpo.access_token.split('.');
  const falso = Buffer.from(JSON.stringify({ ...jwt.decodificar(t.corpo.access_token), scope: 'transacoes:write' })).toString('base64url');
  await fetch(`${API}/transferencias`, { method: 'POST', headers: { Authorization: `Bearer ${h}.${falso}.${s}`, 'X-Forwarded-For': '198.51.100.23' } });
  verificar('token adulterado -> ALERTA_TOKEN_ADULTERADO (CRITICO)', eventos('ALERTA_TOKEN_ADULTERADO').some((e) => e.nivel === 'CRITICO' && e.ip === '198.51.100.23'));
  verificar('alerta crítico também vai para alertas.log', fs.readFileSync(path.join(PASTA, 'alertas.log'), 'utf8').includes('ALERTA_TOKEN_ADULTERADO'));

  console.log('4. Força bruta: alerta e bloqueio');
  const st = [];
  for (let i = 0; i < 5; i++) st.push((await login('203.0.113.9', `chute${i}`)).status);
  verificar('5 falhas do mesmo IP -> ALERTA_FORCA_BRUTA', eventos('ALERTA_FORCA_BRUTA').some((e) => e.ip === '203.0.113.9'), st.join(','));
  verificar('IP bloqueado recebe 429 mesmo com a senha certa', (await login('203.0.113.9')).status === 429);
  verificar('bloqueio registrado como REQUISICAO_BLOQUEADA', eventos('REQUISICAO_BLOQUEADA').some((e) => e.ip === '203.0.113.9'));
  verificar('outro IP continua conseguindo entrar', (await login('203.0.113.10')).status === 302);

  console.log('5. Refresh token reutilizado');
  const t2 = await token({ grant_type: 'refresh_token', refresh_token: t.corpo.refresh_token });
  await token({ grant_type: 'refresh_token', refresh_token: t.corpo.refresh_token }, '198.51.100.50');
  verificar('reuso -> REFRESH_REUSO (CRITICO) com impressão do token, não o token', eventos('REFRESH_REUSO').some((e) => e.nivel === 'CRITICO' && /^sha256:[0-9a-f]{12}$/.test(e.refresh_token)) && t2.status === 200);

  console.log('6. Nada sensível em claro nos arquivos');
  const tudo = auditoria.listarArquivos(PASTA).map((f) => fs.readFileSync(f, 'utf8')).join('') + fs.readFileSync(path.join(PASTA, 'alertas.log'), 'utf8');
  const proibidos = { 'senha correta': 'senha123', 'senha errada': 'senha-errada-xyz', client_secret: WEB.client_secret, access_token: t.corpo.access_token, refresh_token: t.corpo.refresh_token, 'código de autorização': l.code };
  const vazou = Object.entries(proibidos).filter(([, v]) => tudo.includes(v)).map(([k]) => k);
  verificar('nenhuma senha, segredo, token ou code nos logs', vazou.length === 0, vazou.join(', '));
  const linhas = tudo.split('\n').filter(Boolean);
  verificar('todas as linhas são JSON com ts, nivel, tipo e hash', linhas.every((x) => { try { const o = JSON.parse(x); return o.ts && o.nivel && o.tipo && o.hash; } catch { return false; } }));

  console.log('7. Integridade (HMAC encadeado)');
  const integ = auditoria.verificarIntegridade(PASTA);
  verificar(`cadeia íntegra (${integ.total} registros)`, integ.ok, JSON.stringify(integ.erros.slice(0, 2)));
  const copia = fs.mkdtempSync(path.join(os.tmpdir(), 'auditoria-adulterada-'));
  for (const f of auditoria.listarArquivos(PASTA)) fs.copyFileSync(f, path.join(copia, path.basename(f)));
  const alvo = path.join(copia, 'auditoria.log');
  const ls = fs.readFileSync(alvo, 'utf8').split('\n');
  const iAlvo = ls.findIndex((x) => x.includes('"status":401'));
  ls[iAlvo] = ls[iAlvo].replace('"status":401', '"status":200');
  fs.writeFileSync(alvo, ls.join('\n'));
  const v1 = auditoria.verificarIntegridade(copia);
  verificar('edição de uma linha é detectada (linha exata)', !v1.ok && v1.erros.some((e) => e.linha === iAlvo + 1 && e.motivo.includes('alterado')));
  ls.splice(iAlvo, 2);
  fs.writeFileSync(alvo, ls.join('\n'));
  verificar('remoção de linhas é detectada (encadeamento)', auditoria.verificarIntegridade(copia).erros.some((e) => e.motivo.includes('encadeamento')));

  console.log('8. Rotação e retenção');
  for (let i = 0; i < 40; i++) await fetch(`${API}/saldo`);
  const arquivos = auditoria.listarArquivos(PASTA);
  verificar('arquivo rotacionado ao passar de LOG_MAX_BYTES', arquivos.length >= 2, arquivos.map((f) => path.basename(f)).join(','));
  verificar('rotação fica registrada no próximo evento', auditoria.lerEventos(PASTA).some((e) => e.rotacao?.arquivo_rotacionado));
  verificar('cadeia continua íntegra entre arquivos', auditoria.verificarIntegridade(PASTA).ok);

  console.log('9. Análise');
  const a = analisar(PASTA);
  verificar('IP de força bruta aparece como bloqueado na análise', a.suspeitos_por_ip.some((x) => x.ip === '203.0.113.9' && x.bloqueado));
  verificar('análise lista alertas críticos (>= 3)', a.alertas.length >= 3, String(a.alertas.length));
  verificar('KPIs calculados (6 indicadores)', a.kpis.length === 6);

  console.log(`\nResultado: ${ok} OK, ${falhas} FALHA(S)\n`);
  process.exit(falhas ? 1 : 0);
})().catch((e) => {
  console.error(`Erro inesperado nos testes: ${e.stack || e.message}`);
  if (e.code === 'EADDRINUSE') console.error('Portas de teste 23000/24000/25000 ocupadas.');
  process.exit(2);
});
