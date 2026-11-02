// =============================================================
// simular-trafego.js — Gera tráfego NORMAL + ATAQUES para análise
// Uso (com "npm start" rodando em outro terminal): npm run simular
// IPs simulados via X-Forwarded-For (faixas reservadas para
// documentação: 10.0.0.0/8 interna, 203.0.113.0/24 e 198.51.100.0/24)
// =============================================================
const cfg = require('./config');
const jwt = require('./jwt');
const { aleatorio, sha256b64url } = require('./util');

const AUTH = cfg.EMISSOR;
const API = `http://localhost:${cfg.PORTAS.api}`;
const WEB = cfg.CLIENTES.find((c) => c.client_id === 'app-financas-web');
const SVC = cfg.CLIENTES.find((c) => c.client_id === 'servico-relatorios');
const IP_APP = '10.0.0.5'; // servidor do App Finanças (canal back-end)
const basic = (c) => `Basic ${Buffer.from(`${c.client_id}:${c.client_secret}`).toString('base64')}`;
const cont = { normal: 0, ataque: 0, status: {} };

async function req(url, { ip, metodo = 'GET', corpo, headers = {}, ataque = false } = {}) {
  const r = await fetch(url, { method: metodo, body: corpo, redirect: 'manual', headers: { 'X-Forwarded-For': ip, 'User-Agent': ataque ? 'python-requests/2.31' : 'Mozilla/5.0 (Lab)', ...headers } });
  cont[ataque ? 'ataque' : 'normal']++;
  cont.status[r.status] = (cont.status[r.status] || 0) + 1;
  return r;
}

async function login(ipUsuario, senha = 'senha123', ataque = false, usuario = 'aluno') {
  const verifier = aleatorio(32);
  const corpo = new URLSearchParams({
    response_type: 'code', client_id: WEB.client_id, redirect_uri: WEB.redirect_uris[0], scope: 'saldo:read transacoes:read',
    state: aleatorio(8), code_challenge: sha256b64url(verifier), code_challenge_method: 'S256', login: usuario, senha, decisao: 'permitir',
  });
  const r = await req(`${AUTH}/authorize`, { ip: ipUsuario, metodo: 'POST', corpo, ataque });
  const loc = r.headers.get('location');
  return { status: r.status, code: loc ? new URL(loc).searchParams.get('code') : null, verifier };
}

async function token(params, cliente = WEB, ip = IP_APP, ataque = false) {
  const r = await req(`${AUTH}/token`, { ip, metodo: 'POST', corpo: new URLSearchParams(params), headers: { Authorization: basic(cliente) }, ataque });
  return { status: r.status, corpo: await r.json() };
}

const api = (caminho, tk, ip = IP_APP, metodo = 'GET', ataque = false) =>
  req(`${API}${caminho}`, { ip, metodo, headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json' }, corpo: metodo === 'POST' ? '{"destino":"Conta 9999-0","valor":5000}' : undefined, ataque });

async function sessaoNormal(ipUsuario) {
  const l = await login(ipUsuario);
  if (!l.code) throw new Error(`login normal falhou (HTTP ${l.status}) — o IP ${ipUsuario} está bloqueado?`);
  const t = await token({ grant_type: 'authorization_code', code: l.code, redirect_uri: WEB.redirect_uris[0], code_verifier: l.verifier });
  for (const c of ['/saldo', '/transacoes', '/saldo']) await api(c, t.corpo.access_token);
  return t.corpo;
}

(async () => {
  console.log('Simulando tráfego... (servidores precisam estar no ar: npm start)\n');

  console.log('1) Uso normal: 3 usuários fazem login e consultam saldo/extrato');
  const sessoes = [];
  for (const ip of ['10.0.0.11', '10.0.0.12', '10.0.0.13']) sessoes.push(await sessaoNormal(ip));
  await token({ grant_type: 'refresh_token', refresh_token: sessoes[0].refresh_token }); // renovação legítima

  console.log('2) Serviço de Relatórios (Client Credentials) gera o relatório do mês');
  const cc = await token({ grant_type: 'client_credentials', scope: 'relatorios:read' }, SVC, '10.0.0.20');
  await api('/relatorios/resumo', cc.corpo.access_token, '10.0.0.20');

  console.log('3) ATAQUE: força bruta de senha a partir de 203.0.113.66');
  const tentativas = [];
  const chutes = [['admin', 'admin'], ['root', '123456'], ['aluno', 'aluno123'], ['aluno', 'qwerty'], ['aluno', 'senha1234'], ['aluno', 'Senha123'], ['aluno', 'senha123'], ['aluno', 'senha123']];
  for (const [usuario, senha] of chutes) tentativas.push((await login('203.0.113.66', senha, true, usuario)).status);
  console.log(`   status recebidos: ${tentativas.join(', ')}  (429 = IP bloqueado; nem a senha certa passa)`);

  console.log('4) ATAQUE: token adulterado (escopo alterado) a partir de 198.51.100.23');
  const [h, , s] = sessoes[1].access_token.split('.');
  const falso = Buffer.from(JSON.stringify({ ...jwt.decodificar(sessoes[1].access_token), scope: 'saldo:read transacoes:read transacoes:write' })).toString('base64url');
  for (let i = 0; i < 3; i++) await api('/transferencias', `${h}.${falso}.${s}`, '198.51.100.23', 'POST', true);

  console.log('5) ATAQUE: escalonamento — token legítimo tentando transferir sem escopo');
  for (let i = 0; i < 4; i++) await api('/transferencias', sessoes[2].access_token, '10.0.0.13', 'POST', true);

  console.log('6) ATAQUE: reuso de refresh token roubado (já trocado no passo 1)');
  await token({ grant_type: 'refresh_token', refresh_token: sessoes[0].refresh_token }, WEB, '198.51.100.23', true);

  console.log('7) ATAQUE: varredura de client_secret a partir de 203.0.113.99');
  for (const seg of ['secret', 'segredo', '123', 'admin', 'teste', 'segredo-app']) {
    await token({ grant_type: 'client_credentials' }, { client_id: 'app-financas-web', client_secret: seg }, '203.0.113.99', true);
  }

  console.log('8) Acessos sem token (robôs varrendo a API)');
  for (const c of ['/saldo', '/transacoes', '/admin', '/.env']) await req(`${API}${c}`, { ip: '198.51.100.77', ataque: true });

  console.log(`\nConcluído: ${cont.normal} requisições normais e ${cont.ataque} de ataque. Status: ${JSON.stringify(cont.status)}`);
  console.log('Próximo passo: npm run analisar');
})().catch((e) => {
  console.error(`Erro: ${e.message}. O laboratório está rodando? Execute "npm start" em outro terminal.`);
  process.exit(1);
});
