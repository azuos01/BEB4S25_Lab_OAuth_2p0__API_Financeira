// =============================================================
// teste-fluxo.js — Testes automáticos do laboratório (npm test)
// Sobe os servidores em portas de teste e verifica cada regra de
// segurança do OAuth. Saída: [OK] / [FALHA] e código de saída.
// =============================================================
process.env.AUTH_PORT = '14000';
process.env.API_PORT = '15000';
process.env.CLIENT_PORT = '13000';
process.env.OAUTH_QUIET = '1';

const cfg = require('../src/config');
const jwt = require('../src/jwt');
const { sha256b64url, aleatorio } = require('../src/util');

const AUTH = cfg.EMISSOR;
const API = `http://localhost:${cfg.PORTAS.api}`;
const WEB = cfg.CLIENTES[0];
const SVC = cfg.CLIENTES[1];
const REDIRECT = WEB.redirect_uris[0];
const basic = (c) => `Basic ${Buffer.from(`${c.client_id}:${c.client_secret}`).toString('base64')}`;

let ok = 0;
let falhas = 0;
function verificar(descricao, condicao, detalhe = '') {
  if (condicao) { ok++; console.log(`  [OK]    ${descricao}`); }
  else { falhas++; console.log(`  [FALHA] ${descricao}${detalhe ? ` -> ${detalhe}` : ''}`); }
}

async function token(params, cliente = WEB) {
  const r = await fetch(`${AUTH}/token`, { method: 'POST', headers: { Authorization: basic(cliente) }, body: new URLSearchParams(params) });
  return { status: r.status, corpo: await r.json() };
}

async function obterCodigo(verifier, extra = {}) {
  const corpo = new URLSearchParams({
    response_type: 'code', client_id: WEB.client_id, redirect_uri: REDIRECT, scope: 'saldo:read transacoes:read',
    state: 'estado123', code_challenge: sha256b64url(verifier), code_challenge_method: 'S256',
    login: 'aluno', senha: 'senha123', decisao: 'permitir', ...extra,
  });
  const r = await fetch(`${AUTH}/authorize`, { method: 'POST', body: corpo, redirect: 'manual' });
  const loc = r.headers.get('location');
  return loc ? new URL(loc).searchParams : null;
}

const getApi = (caminho, tk) => fetch(`${API}${caminho}`, { headers: tk ? { Authorization: `Bearer ${tk}` } : {} });

(async () => {
  await require('../src/auth-server').iniciar();
  await require('../src/api-financeira').iniciar();
  await require('../src/cliente-web').iniciar();
  console.log('\nTestes do laboratório OAuth\n');

  console.log('1. Registro e descoberta');
  const meta = await (await fetch(`${AUTH}/.well-known/oauth-authorization-server`)).json();
  verificar('metadados publicam token_endpoint e PKCE S256', meta.token_endpoint && meta.code_challenge_methods_supported.includes('S256'));
  verificar('App Finanças responde na porta do cliente', (await fetch(`http://localhost:${cfg.PORTAS.cliente}/`)).status === 200);

  console.log('2. Pedido de autorização');
  const ruim = await fetch(`${AUTH}/authorize?${new URLSearchParams({ response_type: 'code', client_id: WEB.client_id, redirect_uri: 'http://site-malicioso.exemplo/cb', scope: 'saldo:read', state: 'x', code_challenge: 'abc', code_challenge_method: 'S256' })}`, { redirect: 'manual' });
  verificar('redirect_uri não registrada é recusada SEM redirecionar (400)', ruim.status === 400 && !ruim.headers.get('location'));
  const semPkce = await fetch(`${AUTH}/authorize?${new URLSearchParams({ response_type: 'code', client_id: WEB.client_id, redirect_uri: REDIRECT, scope: 'saldo:read', state: 'x' })}`, { redirect: 'manual' });
  verificar('pedido sem PKCE volta com error=invalid_request', new URL(semPkce.headers.get('location') || 'http://x').searchParams.get('error') === 'invalid_request');
  const implicito = await fetch(`${AUTH}/authorize?${new URLSearchParams({ response_type: 'token', client_id: WEB.client_id, redirect_uri: REDIRECT, scope: 'saldo:read', state: 'x' })}`, { redirect: 'manual' });
  verificar('Implicit Flow (response_type=token) é recusado', new URL(implicito.headers.get('location') || 'http://x').searchParams.get('error') === 'unsupported_response_type');
  const escopoIndevido = await obterCodigo('v'.repeat(43), { scope: 'relatorios:read' });
  verificar('escopo não permitido ao cliente -> invalid_scope', escopoIndevido?.get('error') === 'invalid_scope');
  const negado = await obterCodigo('v'.repeat(43), { decisao: 'negar' });
  verificar('usuário que nega o consentimento -> access_denied', negado?.get('error') === 'access_denied');

  console.log('3. Troca do código (Authorization Code + PKCE)');
  const v1 = aleatorio(32);
  const q1 = await obterCodigo(v1);
  verificar('login correto devolve code e o mesmo state', q1?.get('code') && q1.get('state') === 'estado123');
  const pkceErrado = await token({ grant_type: 'authorization_code', code: q1.get('code'), redirect_uri: REDIRECT, code_verifier: 'verificador-errado' });
  verificar('code_verifier errado -> invalid_grant', pkceErrado.status === 400 && pkceErrado.corpo.error === 'invalid_grant');
  const v2 = aleatorio(32);
  const q2 = await obterCodigo(v2);
  const segredoErrado = await token({ grant_type: 'authorization_code', code: q2.get('code'), redirect_uri: REDIRECT, code_verifier: v2 }, { ...WEB, client_secret: 'errado' });
  verificar('client_secret errado -> 401 invalid_client', segredoErrado.status === 401);
  const v3 = aleatorio(32);
  const q3 = await obterCodigo(v3);
  const t1 = await token({ grant_type: 'authorization_code', code: q3.get('code'), redirect_uri: REDIRECT, code_verifier: v3 });
  verificar('troca correta devolve access_token + refresh_token', t1.status === 200 && t1.corpo.access_token && t1.corpo.refresh_token);
  verificar('token traz apenas os escopos pedidos (menor privilégio)', t1.corpo.scope === 'saldo:read transacoes:read');
  const reuso = await token({ grant_type: 'authorization_code', code: q3.get('code'), redirect_uri: REDIRECT, code_verifier: v3 });
  verificar('código é de uso único (2ª troca -> invalid_grant)', reuso.status === 400);

  console.log('4. Servidor de recursos (API)');
  verificar('GET /transacoes com token válido -> 200', (await getApi('/transacoes', t1.corpo.access_token)).status === 200);
  verificar('GET /transacoes sem token -> 401', (await getApi('/transacoes')).status === 401);
  const transf = await fetch(`${API}/transferencias`, { method: 'POST', headers: { Authorization: `Bearer ${t1.corpo.access_token}` } });
  verificar('POST /transferencias sem escopo transacoes:write -> 403', transf.status === 403);
  const [h, , s] = t1.corpo.access_token.split('.');
  const pAdulterado = Buffer.from(JSON.stringify({ ...jwt.decodificar(t1.corpo.access_token), scope: 'transacoes:write' })).toString('base64url');
  verificar('token adulterado (escopo alterado) -> 401', (await getApi('/transacoes', `${h}.${pAdulterado}.${s}`)).status === 401);
  const expirado = jwt.assinar({ ...jwt.decodificar(t1.corpo.access_token), exp: Math.floor(Date.now() / 1000) - 5 }, cfg.SEGREDO_ASSINATURA);
  verificar('token expirado -> 401', (await getApi('/transacoes', expirado)).status === 401);

  console.log('5. Renovação (refresh token com rotação)');
  const t2 = await token({ grant_type: 'refresh_token', refresh_token: t1.corpo.refresh_token });
  verificar('refresh válido devolve NOVO par de tokens', t2.status === 200 && t2.corpo.refresh_token !== t1.corpo.refresh_token);
  const reusoRt = await token({ grant_type: 'refresh_token', refresh_token: t1.corpo.refresh_token });
  verificar('reuso do refresh antigo é detectado (invalid_grant)', reusoRt.status === 400 && reusoRt.corpo.error_description.includes('REUSO'));
  const t3 = await token({ grant_type: 'refresh_token', refresh_token: t2.corpo.refresh_token });
  verificar('após reuso, o refresh novo também foi revogado (família)', t3.status === 400);

  console.log('6. Client Credentials (servidor-servidor)');
  const cc = await token({ grant_type: 'client_credentials', scope: 'relatorios:read' }, SVC);
  verificar('serviço obtém token sem usuário e sem refresh_token', cc.status === 200 && !cc.corpo.refresh_token);
  verificar('GET /relatorios/resumo com token do serviço -> 200', (await getApi('/relatorios/resumo', cc.corpo.access_token)).status === 200);
  verificar('token do serviço não acessa /transacoes -> 403', (await getApi('/transacoes', cc.corpo.access_token)).status === 403);
  const ccWeb = await token({ grant_type: 'client_credentials' }, WEB);
  verificar('App Finanças não pode usar client_credentials -> unauthorized_client', ccWeb.corpo.error === 'unauthorized_client');

  console.log(`\nResultado: ${ok} OK, ${falhas} FALHA(S)\n`);
  process.exit(falhas ? 1 : 0);
})().catch((e) => {
  console.error(`Erro inesperado nos testes: ${e.stack || e.message}`);
  if (e.code === 'EADDRINUSE') console.error('Portas de teste 13000/14000/15000 ocupadas.');
  process.exit(2);
});
