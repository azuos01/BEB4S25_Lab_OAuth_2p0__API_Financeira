// =============================================================
// cliente-web.js — APLICAÇÃO CLIENTE "App Finanças" (porta 3000)
// Cliente confidencial: o back-end guarda client_secret, tokens e
// code_verifier; o navegador recebe apenas um cookie de sessão.
// Lab 2: propaga o X-Request-Id para provedor e API (rastreio ponta a ponta).
// =============================================================
const http = require('node:http');
const cfg = require('./config');
const jwt = require('./jwt');
const { lerCookies, html, redirecionar, aleatorio, sha256b64url, esc, pagina } = require('./util');
const auditoria = require('./auditoria');

const AUTH = cfg.EMISSOR;
const API = `http://localhost:${cfg.PORTAS.api}`;
const CLIENTE = cfg.CLIENTES.find((c) => c.client_id === 'app-financas-web');
const REDIRECT_URI = CLIENTE.redirect_uris[0];
const ESCOPOS_PEDIDOS = 'saldo:read transacoes:read'; // menor privilégio: NÃO pede transacoes:write
const sessoes = new Map();
const log = (...a) => { if (!process.env.OAUTH_QUIET) console.log('[cliente]', ...a); };

function obterSessao(req, res) {
  let sid = lerCookies(req).sid;
  if (!sid || !sessoes.has(sid)) {
    sid = aleatorio(16);
    sessoes.set(sid, { log: [] });
    res.setHeader('Set-Cookie', `sid=${sid}; HttpOnly; SameSite=Lax; Path=/`);
  }
  return sessoes.get(sid);
}

async function pedirToken(params, reqId) {
  const basic = Buffer.from(`${encodeURIComponent(CLIENTE.client_id)}:${encodeURIComponent(CLIENTE.client_secret)}`).toString('base64');
  const r = await fetch(`${AUTH}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}`, 'X-Request-Id': reqId },
    body: new URLSearchParams(params),
  });
  return { status: r.status, corpo: await r.json() };
}

const resumir = (t) => (t ? `${t.slice(0, 16)}…` : undefined);
function guardarTokens(s, corpo) {
  s.refreshAnterior = s.tokens?.refresh_token;
  s.tokens = corpo;
}

function telaInicial(s) {
  const t = s.tokens;
  const claims = t ? jwt.decodificar(t.access_token) : null;
  const restante = claims ? claims.exp - Math.floor(Date.now() / 1000) : 0;
  const blocoLogin = `<p>Você ainda não autorizou o App Finanças a acessar sua conta.</p>
    <a class="btn" href="/login">Entrar com o Provedor OAuth</a>
    <a class="btn perigo" href="/login-redirect-invalido">Testar redirect_uri NÃO registrada</a>`;
  const blocoLogado = () => `<h2>Access token — claims (decodificado, sem validar)</h2>
    <pre>${esc(JSON.stringify(claims, null, 2))}</pre>
    <p>Expira em: <b>${restante > 0 ? `${restante} s` : 'EXPIRADO'}</b> · refresh token: <code>${esc(resumir(t.refresh_token))}</code></p>
    <div>
      <a class="btn" href="/chamar/saldo">GET /saldo</a>
      <a class="btn" href="/chamar/transacoes">GET /transacoes</a>
      <form method="post" action="/transferir"><button class="perigo">POST /transferencias (escopo não concedido)</button></form>
    </div><div>
      <form method="post" action="/renovar"><button class="sec">Renovar token (refresh)</button></form>
      ${s.refreshAnterior ? '<form method="post" action="/reusar-refresh"><button class="perigo">Reutilizar refresh token ANTIGO</button></form>' : ''}
      <form method="post" action="/sair"><button class="sec">Sair (revogar)</button></form>
      <a class="btn sec" href="/">Atualizar</a>
    </div>`;
  const u = s.ultimo;
  return pagina('App Finanças — cliente OAuth', `
    <p class="tag">Aplicação cliente · App Finanças · porta ${cfg.PORTAS.cliente}</p>
    <h1>App Finanças</h1>
    ${t ? blocoLogado() : blocoLogin}
    ${u ? `<h2>Última operação: ${esc(u.titulo)} → HTTP ${u.status}</h2><pre>${esc(JSON.stringify(u.corpo, null, 2))}</pre>` : ''}
    ${s.log.length ? `<h2>Linha do tempo do fluxo</h2><ol>${s.log.map((l) => `<li>${esc(l)}</li>`).join('')}</ol>` : ''}`);
}

function urlAutorizacao(s, redirectUri) {
  s.state = aleatorio(16); // anti-CSRF
  s.verifier = aleatorio(32); // PKCE: segredo que só o back-end do cliente conhece
  const challenge = sha256b64url(s.verifier);
  const u = new URL(`${AUTH}/authorize`);
  u.search = new URLSearchParams({ response_type: 'code', client_id: CLIENTE.client_id, redirect_uri: redirectUri, scope: ESCOPOS_PEDIDOS, state: s.state, code_challenge: challenge, code_challenge_method: 'S256' });
  s.log = [
    `Cliente gerou state=${s.state.slice(0, 8)}… e um code_verifier secreto; calculou code_challenge=${challenge.slice(0, 10)}… (SHA-256).`,
    `Navegador redirecionado para ${AUTH}/authorize pedindo os escopos "${ESCOPOS_PEDIDOS}".`,
  ];
  return u.toString();
}

async function callback(s, url, res) {
  const q = url.searchParams;
  if (q.get('error')) {
    s.ultimo = { titulo: 'Autorização não concedida', status: 400, corpo: Object.fromEntries(q) };
    s.log.push(`Provedor devolveu erro: ${q.get('error')}.`);
    return redirecionar(res, '/');
  }
  if (!s.state || q.get('state') !== s.state) {
    auditoria.registrar({ origem: 'cliente', tipo: 'CALLBACK_STATE_INVALIDO', nivel: 'AVISO', req: s.req, motivo: 'state ausente ou diferente (possível CSRF)' });
    return html(res, 400, pagina('Erro', '<h1>state inválido</h1><p class="erro">Possível ataque CSRF: esta resposta não corresponde a um pedido iniciado nesta sessão.</p><a class="btn" href="/">Voltar</a>'));
  }
  const code = q.get('code');
  s.log.push(`Callback recebeu code=${code.slice(0, 8)}… e o state conferiu.`);
  const r = await pedirToken({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, code_verifier: s.verifier }, s.reqId);
  delete s.state;
  delete s.verifier;
  if (r.status !== 200) {
    s.ultimo = { titulo: 'Troca do código falhou', ...r };
    return redirecionar(res, '/');
  }
  s.log.push('Back-end do cliente trocou code + code_verifier + client_secret por tokens em POST /token (canal servidor-servidor).');
  guardarTokens(s, r.corpo);
  s.ultimo = { titulo: 'Tokens recebidos (valores abreviados)', status: 200, corpo: { ...r.corpo, access_token: resumir(r.corpo.access_token), refresh_token: resumir(r.corpo.refresh_token) } };
  redirecionar(res, '/');
}

async function chamarApi(s, metodo, caminho, corpo) {
  const r = await fetch(`${API}${caminho}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${s.tokens.access_token}`, 'Content-Type': 'application/json', 'X-Request-Id': s.reqId },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  s.ultimo = { titulo: `${metodo} ${caminho}`, status: r.status, corpo: await r.json() };
  s.log.push(`Chamou ${metodo} ${caminho} com Authorization: Bearer → HTTP ${r.status}.`);
}

async function renovar(s, refresh, titulo) {
  const r = await pedirToken({ grant_type: 'refresh_token', refresh_token: refresh }, s.reqId);
  if (r.status === 200) {
    guardarTokens(s, r.corpo);
    s.ultimo = { titulo, status: 200, corpo: { ...r.corpo, access_token: resumir(r.corpo.access_token), refresh_token: resumir(r.corpo.refresh_token) } };
    s.log.push('Refresh token trocado por um NOVO par de tokens (rotação: o refresh antigo foi invalidado).');
  } else {
    s.ultimo = { titulo, ...r };
    s.log.push(`Renovação recusada: ${r.corpo.error_description}`);
    if (String(r.corpo.error_description).includes('REUSO')) delete s.tokens; // sessão comprometida
  }
}

function criarServidor() {
  return http.createServer(auditoria.envolver('cliente', async (req, res) => {
    const url = new URL(req.url, `http://localhost:${cfg.PORTAS.cliente}`);
    const s = obterSessao(req, res);
    s.reqId = req.idReq; // o mesmo ID segue nas chamadas ao provedor e à API
    s.req = req;
    log(req.method, url.pathname);
    try {
      if (req.method === 'GET' && url.pathname === '/') return html(res, 200, telaInicial(s));
      if (req.method === 'GET' && url.pathname === '/login') return redirecionar(res, urlAutorizacao(s, REDIRECT_URI));
      if (req.method === 'GET' && url.pathname === '/login-redirect-invalido') return redirecionar(res, urlAutorizacao(s, 'http://site-malicioso.exemplo/callback'));
      if (req.method === 'GET' && url.pathname === '/callback') return await callback(s, url, res);
      if (!s.tokens) return redirecionar(res, '/'); // rotas abaixo exigem login
      if (req.method === 'GET' && url.pathname === '/chamar/saldo') await chamarApi(s, 'GET', '/saldo');
      else if (req.method === 'GET' && url.pathname === '/chamar/transacoes') await chamarApi(s, 'GET', '/transacoes');
      else if (req.method === 'POST' && url.pathname === '/transferir') await chamarApi(s, 'POST', '/transferencias', { destino: 'Conta 9999-0', valor: 100 });
      else if (req.method === 'POST' && url.pathname === '/renovar') await renovar(s, s.tokens.refresh_token, 'Renovação com refresh token atual');
      else if (req.method === 'POST' && url.pathname === '/reusar-refresh' && s.refreshAnterior) await renovar(s, s.refreshAnterior, 'Tentativa de REUSO do refresh token antigo');
      else if (req.method === 'POST' && url.pathname === '/sair') {
        const basic = Buffer.from(`${CLIENTE.client_id}:${CLIENTE.client_secret}`).toString('base64');
        await fetch(`${AUTH}/revoke`, { method: 'POST', headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded', 'X-Request-Id': s.reqId }, body: new URLSearchParams({ token: s.tokens.refresh_token }) });
        delete s.tokens;
        delete s.refreshAnterior;
        s.ultimo = { titulo: 'Logout', status: 200, corpo: { mensagem: 'Refresh token revogado no provedor e sessão local encerrada.' } };
        s.log = [];
      }
      redirecionar(res, '/'); // padrão Post/Redirect/Get
    } catch (e) {
      console.error('[cliente] erro:', e);
      html(res, 502, pagina('Erro', `<h1>Falha ao falar com o provedor/API</h1><pre>${esc(e.message)}</pre><p>Os três servidores estão rodando? Use <code>npm start</code>.</p>`));
    }
  }));
}

function iniciar(porta = cfg.PORTAS.cliente) {
  return new Promise((resolve, reject) => {
    const s = criarServidor();
    s.once('error', reject);
    s.listen(porta, () => { log(`App Finanças em http://localhost:${porta}`); resolve(s); });
  });
}

if (require.main === module) iniciar().catch((e) => { console.error(e.message); process.exit(1); });
module.exports = { iniciar };
