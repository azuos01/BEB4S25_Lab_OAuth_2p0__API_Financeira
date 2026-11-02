// =============================================================
// auth-server.js — SERVIDOR DE AUTORIZAÇÃO (porta 4000)
// Implementa: Authorization Code + PKCE, Refresh Token (com
// rotação e detecção de reuso), Client Credentials e revogação.
// Lab 2: registra eventos de auditoria e bloqueia IPs com
// excesso de falhas de autenticação (força bruta).
// =============================================================
const http = require('node:http');
const cfg = require('./config');
const jwt = require('./jwt');
const { lerCorpo, json, html, redirecionar, aleatorio, sha256b64url, iguaisSeguro, esc, pagina } = require('./util');
const auditoria = require('./auditoria');

const audit = (req, tipo, extra = {}) => auditoria.registrar({ origem: 'auth', tipo, req, ...extra });

// IP em bloqueio temporário (força bruta): responde 429 sem processar o pedido
function recusarSeBloqueado(req, res, comoHtml = false) {
  if (!auditoria.estaBloqueado(req.ipCliente)) return false;
  audit(req, 'REQUISICAO_BLOQUEADA', { nivel: 'AVISO', rota: new URL(req.url, cfg.EMISSOR).pathname, motivo: 'IP em bloqueio temporário por força bruta' });
  const extras = { 'Retry-After': String(cfg.AUDITORIA.BLOQUEIO_S) };
  if (comoHtml) html(res, 429, paginaErro('Muitas tentativas de login falharam a partir deste endereço. Aguarde alguns minutos e tente de novo.'), extras);
  else json(res, 429, { error: 'too_many_requests', error_description: 'Muitas falhas de autenticação deste IP. Tente mais tarde.' }, extras);
  return true;
}

// client_id que o chamador AFIRMA ser (para registrar falhas de autenticação do cliente)
function idInformado(req, corpo) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Basic ')) return decodeURIComponent(Buffer.from(auth.slice(6), 'base64').toString().split(':')[0] || '').slice(0, 80);
  return String(corpo.client_id || '').slice(0, 80);
}

const codigos = new Map(); // code -> { client_id, redirect_uri, escopos, sub, code_challenge, exp }
const refreshTokens = new Map(); // refresh -> { sub, client_id, escopos, exp, familia }
const refreshUsados = new Map(); // refresh já trocado -> familia (para detectar reuso)

const agora = () => Math.floor(Date.now() / 1000);
const buscarCliente = (id) => cfg.CLIENTES.find((c) => c.client_id === id);
const log = (...a) => { if (!process.env.OAUTH_QUIET) console.log('[auth]', ...a); };

function validarEscopo(cliente, scope) {
  const pedidos = String(scope || '').split(' ').filter(Boolean);
  if (!pedidos.length) return null;
  return pedidos.every((e) => cliente.escopos_permitidos.includes(e)) ? pedidos : null;
}

function autenticarCliente(req, corpo) {
  let id = corpo.client_id;
  let segredo = corpo.client_secret;
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Basic ')) {
    const [i, s] = Buffer.from(auth.slice(6), 'base64').toString().split(':');
    id = decodeURIComponent(i || '');
    segredo = decodeURIComponent(s || '');
  }
  const cliente = buscarCliente(id);
  return cliente && iguaisSeguro(cliente.client_secret, segredo) ? cliente : null;
}

function emitirAccessToken(sub, client_id, escopos) {
  const iat = agora();
  return jwt.assinar(
    { iss: cfg.EMISSOR, aud: cfg.AUDIENCIA_API, sub, client_id, scope: escopos.join(' '), iat, exp: iat + cfg.ACCESS_TOKEN_TTL, jti: aleatorio(8) },
    cfg.SEGREDO_ASSINATURA
  );
}

function emitirTokens(sub, client_id, escopos, comRefresh, familia = aleatorio(8)) {
  const r = { access_token: emitirAccessToken(sub, client_id, escopos), token_type: 'Bearer', expires_in: cfg.ACCESS_TOKEN_TTL, scope: escopos.join(' ') };
  if (comRefresh) {
    r.refresh_token = aleatorio(32); // opaco: só o provedor sabe o que significa
    r.refresh_expires_in = cfg.REFRESH_TOKEN_TTL;
    refreshTokens.set(r.refresh_token, { sub, client_id, escopos, exp: agora() + cfg.REFRESH_TOKEN_TTL, familia });
  }
  return r;
}

function revogarFamilia(familia) {
  for (const [token, d] of refreshTokens) if (d.familia === familia) refreshTokens.delete(token);
}

// ---------- /authorize -------------------------------------------------
function validarPedido(p) {
  const cliente = buscarCliente(p.client_id);
  if (!cliente) return { fatal: 'client_id desconhecido: a aplicação não está registrada no provedor.' };
  if (!cliente.redirect_uris.includes(p.redirect_uri)) {
    return { fatal: `redirect_uri não registrada para "${cliente.client_id}": ${p.redirect_uri}. Por segurança o provedor NÃO redireciona para URLs desconhecidas (evita roubo do código).` };
  }
  const erro = (error, error_description) => ({ cliente, erro: { error, error_description } });
  if (!cliente.grant_types.includes('authorization_code')) return erro('unauthorized_client', 'Cliente não habilitado para o Authorization Code Flow.');
  if (p.response_type !== 'code') return erro('unsupported_response_type', 'Use response_type=code. O Implicit Flow (response_type=token) é desaconselhado pelas boas práticas atuais.');
  const escopos = validarEscopo(cliente, p.scope);
  if (!escopos) return erro('invalid_scope', 'Escopo ausente ou não permitido para este cliente.');
  if (!p.code_challenge || p.code_challenge_method !== 'S256') return erro('invalid_request', 'PKCE obrigatório: envie code_challenge com code_challenge_method=S256.');
  if (!p.state) return erro('invalid_request', 'Parâmetro state obrigatório (proteção contra CSRF).');
  return { cliente, escopos };
}

function voltarComErro(res, p, erro) {
  const u = new URL(p.redirect_uri);
  u.searchParams.set('error', erro.error);
  u.searchParams.set('error_description', erro.error_description);
  if (p.state) u.searchParams.set('state', p.state);
  redirecionar(res, u.toString());
}

function paginaErro(msg) {
  return pagina('Provedor OAuth — erro', `<p class="tag">Servidor de Autorização · porta ${cfg.PORTAS.auth}</p>
  <h1>Pedido de autorização recusado</h1><p class="erro">${esc(msg)}</p>
  <a class="btn sec" href="http://localhost:${cfg.PORTAS.cliente}/">Voltar ao App Finanças</a>`, '#7c3aed');
}

function telaConsentimento(p, cliente, escopos, mensagem = '') {
  const campos = ['client_id', 'redirect_uri', 'response_type', 'scope', 'state', 'code_challenge', 'code_challenge_method']
    .map((k) => `<input type="hidden" name="${k}" value="${esc(p[k])}">`).join('');
  return pagina('Provedor OAuth — login e consentimento', `
  <p class="tag">Servidor de Autorização · porta ${cfg.PORTAS.auth}</p>
  <h1>Entrar no Provedor OAuth</h1>
  <p>A aplicação <b>${esc(cliente.nome)}</b> (<code>${esc(cliente.client_id)}</code>) solicita acesso a:</p>
  <ul>${escopos.map((e) => `<li><code>${esc(e)}</code> — ${esc(cfg.ESCOPOS[e] || '')}</li>`).join('')}</ul>
  ${mensagem ? `<p class="erro">${esc(mensagem)}</p>` : ''}
  <form method="post" action="/authorize" class="bloco">${campos}
    <label>Usuário <input name="login" value="aluno" autocomplete="username"></label>
    <label>Senha <input name="senha" type="password" placeholder="senha123" autocomplete="current-password"></label>
    <p class="dica">A senha é digitada <b>somente aqui, no provedor</b>. O App Finanças nunca a recebe.</p>
    <button name="decisao" value="permitir">Permitir acesso</button>
    <button name="decisao" value="negar" class="sec">Negar</button>
  </form>`, '#7c3aed');
}

function registrarRecusa(req, p, v) {
  audit(req, 'AUTORIZACAO_RECUSADA', { nivel: 'AVISO', client_id: String(p.client_id || '').slice(0, 80), redirect_uri: String(p.redirect_uri || '').slice(0, 200), motivo: v.fatal ? 'redirect_uri ou client_id não registrados' : v.erro.error });
}

function getAuthorize(req, res, url) {
  const p = Object.fromEntries(url.searchParams);
  const v = validarPedido(p);
  if (v.fatal || v.erro) registrarRecusa(req, p, v);
  if (v.fatal) return html(res, 400, paginaErro(v.fatal));
  if (v.erro) return voltarComErro(res, p, v.erro);
  html(res, 200, telaConsentimento(p, v.cliente, v.escopos));
}

async function postAuthorize(req, res) {
  if (recusarSeBloqueado(req, res, true)) return;
  const p = await lerCorpo(req);
  const v = validarPedido(p);
  if (v.fatal || v.erro) registrarRecusa(req, p, v);
  if (v.fatal) return html(res, 400, paginaErro(v.fatal));
  if (v.erro) return voltarComErro(res, p, v.erro);
  if (p.decisao === 'negar') {
    audit(req, 'CONSENTIMENTO_NEGADO', { client_id: p.client_id });
    return voltarComErro(res, p, { error: 'access_denied', error_description: 'O usuário negou o acesso.' });
  }
  const usuario = cfg.USUARIOS.find((u) => u.login === p.login && iguaisSeguro(u.senha, p.senha));
  if (!usuario) {
    // o login digitado vai CIFRADO: usuários às vezes digitam a senha no campo de login
    audit(req, 'LOGIN_FALHA', { nivel: 'AVISO', client_id: p.client_id, login_cifrado: auditoria.cifrar(String(p.login || '').slice(0, 100)) });
    return html(res, 401, telaConsentimento(p, v.cliente, v.escopos, 'Usuário ou senha inválidos.'));
  }
  audit(req, 'LOGIN_SUCESSO', { sub: usuario.id, client_id: p.client_id, escopos: v.escopos });
  const code = aleatorio(24);
  codigos.set(code, { client_id: p.client_id, redirect_uri: p.redirect_uri, escopos: v.escopos, sub: usuario.id, code_challenge: p.code_challenge, exp: agora() + cfg.CODE_TTL });
  log(`código emitido para ${p.client_id} (usuário ${usuario.login}, escopos: ${v.escopos.join(' ')})`);
  const u = new URL(p.redirect_uri);
  u.searchParams.set('code', code);
  u.searchParams.set('state', p.state);
  redirecionar(res, u.toString());
}

// ---------- /token -----------------------------------------------------
function responderTokens(req, res, grant, sub, cliente, escopos, comRefresh, familia) {
  const tokens = emitirTokens(sub, cliente.client_id, escopos, comRefresh, familia);
  audit(req, 'TOKEN_EMITIDO', { grant_type: grant, client_id: cliente.client_id, sub, scope: tokens.scope, jti: jwt.decodificar(tokens.access_token).jti });
  return json(res, 200, tokens);
}

async function postToken(req, res) {
  if (recusarSeBloqueado(req, res)) return;
  const corpo = await lerCorpo(req);
  const grant = String(corpo.grant_type || '').slice(0, 40);
  const recusar = (status, error, d, nivel = 'AVISO') => {
    audit(req, 'TOKEN_RECUSADO', { nivel, grant_type: grant, client_id: idInformado(req, corpo), erro: error, motivo: d });
    return json(res, status, { error, error_description: d });
  };
  const erroGrant = (d) => recusar(400, 'invalid_grant', d);
  const suportados = ['authorization_code', 'refresh_token', 'client_credentials'];
  if (!suportados.includes(grant)) return recusar(400, 'unsupported_grant_type', `Use: ${suportados.join(', ')}`);

  const cliente = autenticarCliente(req, corpo);
  if (!cliente) {
    audit(req, 'CLIENTE_AUTH_FALHA', { nivel: 'AVISO', client_id: idInformado(req, corpo), grant_type: grant });
    return json(res, 401, { error: 'invalid_client', error_description: 'Falha na autenticação do cliente (client_id/client_secret).' }, { 'WWW-Authenticate': 'Basic realm="oauth"' });
  }
  if (!cliente.grant_types.includes(grant)) return recusar(400, 'unauthorized_client', `Cliente não habilitado para ${grant}.`);

  if (corpo.grant_type === 'authorization_code') {
    const d = codigos.get(corpo.code);
    codigos.delete(corpo.code); // uso único — descartado mesmo se a troca falhar
    if (!d || d.exp < agora()) return erroGrant('Código inválido, expirado ou já utilizado.');
    if (d.client_id !== cliente.client_id) return erroGrant('Código emitido para outro cliente.');
    if (d.redirect_uri !== corpo.redirect_uri) return erroGrant('redirect_uri diferente da usada na autorização.');
    if (!corpo.code_verifier || sha256b64url(corpo.code_verifier) !== d.code_challenge) return erroGrant('PKCE: code_verifier não confere com o code_challenge.');
    log(`tokens emitidos (authorization_code) para ${cliente.client_id}`);
    return responderTokens(req, res, grant, d.sub, cliente, d.escopos, true);
  }

  if (corpo.grant_type === 'refresh_token') {
    const rt = corpo.refresh_token;
    if (refreshUsados.has(rt)) {
      revogarFamilia(refreshUsados.get(rt));
      log('ALERTA: reuso de refresh token — família revogada');
      audit(req, 'REFRESH_REUSO', { nivel: 'CRITICO', client_id: cliente.client_id, refresh_token: rt, motivo: 'refresh token já trocado foi reapresentado (possível roubo); família revogada' });
      return erroGrant('REUSO de refresh token detectado: todos os tokens desta sessão foram revogados. Faça login novamente.');
    }
    const d = refreshTokens.get(rt);
    if (!d || d.client_id !== cliente.client_id) return erroGrant('Refresh token inválido ou revogado.');
    if (d.exp < agora()) {
      refreshTokens.delete(rt);
      return erroGrant('Refresh token expirado: faça login novamente.');
    }
    refreshTokens.delete(rt); // ROTAÇÃO: o antigo deixa de valer...
    refreshUsados.set(rt, d.familia); // ...e passa a ser vigiado
    log(`tokens renovados (refresh_token) para ${cliente.client_id}`);
    return responderTokens(req, res, grant, d.sub, cliente, d.escopos, true, d.familia);
  }

  // client_credentials: a aplicação age em nome PRÓPRIO (sem usuário, sem refresh)
  const escopos = validarEscopo(cliente, corpo.scope || cliente.escopos_permitidos.join(' '));
  if (!escopos) return recusar(400, 'invalid_scope', 'Escopo não permitido para este cliente.');
  log(`token emitido (client_credentials) para ${cliente.client_id}`);
  return responderTokens(req, res, grant, cliente.client_id, cliente, escopos, false);
}

// ---------- /revoke (RFC 7009) -----------------------------------------
async function postRevoke(req, res) {
  const corpo = await lerCorpo(req);
  const cliente = autenticarCliente(req, corpo);
  if (!cliente) {
    audit(req, 'CLIENTE_AUTH_FALHA', { nivel: 'AVISO', client_id: idInformado(req, corpo), grant_type: 'revoke' });
    return json(res, 401, { error: 'invalid_client' });
  }
  const d = refreshTokens.get(corpo.token);
  if (d) revogarFamilia(d.familia);
  audit(req, 'TOKEN_REVOGADO', { client_id: cliente.client_id, sub: d?.sub, encontrado: Boolean(d) });
  json(res, 200, { revogado: true }); // responde 200 mesmo se o token não existir
}

function metadados() {
  const e = cfg.EMISSOR;
  return {
    issuer: e,
    authorization_endpoint: `${e}/authorize`,
    token_endpoint: `${e}/token`,
    revocation_endpoint: `${e}/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token', 'client_credentials'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
    scopes_supported: Object.keys(cfg.ESCOPOS),
  };
}

function criarServidor() {
  return http.createServer(auditoria.envolver('auth', async (req, res) => {
    const url = new URL(req.url, cfg.EMISSOR);
    log(req.method, url.pathname);
    try {
      if (req.method === 'GET' && url.pathname === '/authorize') return getAuthorize(req, res, url);
      if (req.method === 'POST' && url.pathname === '/authorize') return await postAuthorize(req, res);
      if (req.method === 'POST' && url.pathname === '/token') return await postToken(req, res);
      if (req.method === 'POST' && url.pathname === '/revoke') return await postRevoke(req, res);
      if (req.method === 'GET' && url.pathname === '/.well-known/oauth-authorization-server') return json(res, 200, metadados());
      if (req.method === 'GET' && url.pathname === '/') {
        const lista = cfg.CLIENTES.map((c) => ({ client_id: c.client_id, nome: c.nome, redirect_uris: c.redirect_uris, grant_types: c.grant_types, escopos_permitidos: c.escopos_permitidos }));
        return html(res, 200, pagina('Provedor OAuth', `<p class="tag">Servidor de Autorização · porta ${cfg.PORTAS.auth}</p>
          <h1>Provedor OAuth (didático)</h1><h2>Aplicações registradas (segredos ocultos)</h2><pre>${esc(JSON.stringify(lista, null, 2))}</pre>
          <h2>Metadados</h2><pre>${esc(JSON.stringify(metadados(), null, 2))}</pre>`, '#7c3aed'));
      }
      json(res, 404, { error: 'not_found' });
    } catch (e) {
      console.error('[auth] erro:', e);
      audit(req, 'ERRO_SERVIDOR', { nivel: 'ERRO', motivo: e.message });
      json(res, 500, { error: 'server_error', error_description: 'Erro interno.' }); // detalhe só no log
    }
  }));
}

function iniciar(porta = cfg.PORTAS.auth) {
  return new Promise((resolve, reject) => {
    const s = criarServidor();
    s.once('error', reject);
    s.listen(porta, () => { log(`Servidor de Autorização em http://localhost:${porta}`); resolve(s); });
  });
}

if (require.main === module) iniciar().catch((e) => { console.error(e.message); process.exit(1); });
module.exports = { iniciar };
