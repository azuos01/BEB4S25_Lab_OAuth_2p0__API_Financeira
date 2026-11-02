// =============================================================
// api-financeira.js — SERVIDOR DE RECURSOS (porta 5000)
// Valida o access token (assinatura, expiração, emissor,
// audiência) e exige o ESCOPO certo para cada rota.
// Lab 2: registra acessos permitidos/negados, operações
// sensíveis e alerta tokens adulterados.
// =============================================================
const http = require('node:http');
const cfg = require('./config');
const jwt = require('./jwt');
const { lerCorpo, json } = require('./util');
const auditoria = require('./auditoria');

const audit = (req, tipo, extra = {}) =>
  auditoria.registrar({ origem: 'api', tipo, req, rota: new URL(req.url, 'http://local').pathname, ...extra });

const log = (...a) => { if (!process.env.OAUTH_QUIET) console.log('[api]', ...a); };

const contas = {
  u1: {
    saldo: 2350.75,
    transacoes: [
      { id: 1, data: '2026-10-01', descricao: 'Salário', valor: 3200.0 },
      { id: 2, data: '2026-10-05', descricao: 'Aluguel', valor: -1100.0 },
      { id: 3, data: '2026-10-12', descricao: 'Supermercado', valor: -412.35 },
      { id: 4, data: '2026-10-20', descricao: 'Conta de energia', valor: -186.9 },
      { id: 5, data: '2026-10-28', descricao: 'Pix recebido', valor: 850.0 },
    ],
  },
};

// Middleware de autorização: devolve as claims ou responde 401/403
function autorizar(req, res, escopoExigido) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) {
    audit(req, 'ACESSO_NEGADO', { nivel: 'AVISO', status: 401, motivo: 'sem token', escopo_exigido: escopoExigido });
    json(res, 401, { error: 'invalid_token', error_description: 'Envie o cabeçalho Authorization: Bearer <access_token>.' }, { 'WWW-Authenticate': 'Bearer realm="api-financeira"' });
    return null;
  }
  let claims;
  try {
    claims = jwt.verificar(auth.slice(7), cfg.SEGREDO_ASSINATURA);
  } catch (e) {
    const claims = jwt.decodificar(auth.slice(7)) || {};
    if (e.message.startsWith('assinatura')) {
      // assinatura inválida = alguém fabricou ou alterou o token: evento CRÍTICO
      audit(req, 'ALERTA_TOKEN_ADULTERADO', { nivel: 'CRITICO', status: 401, sub_alegado: claims.sub, scope_alegado: claims.scope, motivo: e.message });
    } else {
      audit(req, 'ACESSO_NEGADO', { nivel: 'AVISO', status: 401, motivo: e.message, sub: claims.sub, client_id: claims.client_id, jti: claims.jti });
    }
    json(res, 401, { error: 'invalid_token', error_description: e.message }, { 'WWW-Authenticate': 'Bearer realm="api-financeira", error="invalid_token"' });
    return null;
  }
  if (claims.iss !== cfg.EMISSOR || claims.aud !== cfg.AUDIENCIA_API) {
    audit(req, 'ACESSO_NEGADO', { nivel: 'AVISO', status: 401, motivo: 'iss/aud inválidos', sub: claims.sub, jti: claims.jti });
    json(res, 401, { error: 'invalid_token', error_description: 'Emissor (iss) ou audiência (aud) inválidos.' }, { 'WWW-Authenticate': 'Bearer error="invalid_token"' });
    return null;
  }
  const escopos = String(claims.scope || '').split(' ');
  if (!escopos.includes(escopoExigido)) {
    audit(req, 'ACESSO_NEGADO', { nivel: 'AVISO', status: 403, motivo: 'insufficient_scope', escopo_exigido: escopoExigido, sub: claims.sub, client_id: claims.client_id, jti: claims.jti });
    json(res, 403, { error: 'insufficient_scope', error_description: `Este recurso exige o escopo "${escopoExigido}".`, escopos_do_token: escopos },
      { 'WWW-Authenticate': `Bearer error="insufficient_scope", scope="${escopoExigido}"` });
    return null;
  }
  audit(req, 'ACESSO_PERMITIDO', { escopo: escopoExigido, sub: claims.sub, client_id: claims.client_id, jti: claims.jti });
  return claims;
}

function criarServidor() {
  return http.createServer(auditoria.envolver('api', async (req, res) => {
    const url = new URL(req.url, `http://localhost:${cfg.PORTAS.api}`);
    log(req.method, url.pathname);
    try {
      if (req.method === 'GET' && url.pathname === '/') {
        return json(res, 200, { api: 'API Financeira (didática)', rotas: { 'GET /saldo': 'saldo:read', 'GET /transacoes': 'transacoes:read', 'POST /transferencias': 'transacoes:write', 'GET /relatorios/resumo': 'relatorios:read' } });
      }
      if (req.method === 'GET' && url.pathname === '/saldo') {
        const c = autorizar(req, res, 'saldo:read'); if (!c) return;
        return json(res, 200, { usuario: c.sub, saldo: contas[c.sub]?.saldo ?? 0, moeda: 'BRL' });
      }
      if (req.method === 'GET' && url.pathname === '/transacoes') {
        const c = autorizar(req, res, 'transacoes:read'); if (!c) return;
        return json(res, 200, { usuario: c.sub, transacoes: contas[c.sub]?.transacoes ?? [] });
      }
      if (req.method === 'POST' && url.pathname === '/transferencias') {
        const c = autorizar(req, res, 'transacoes:write'); if (!c) return;
        const corpo = await lerCorpo(req);
        audit(req, 'OPERACAO_SENSIVEL', { operacao: 'transferencia', sub: c.sub, client_id: c.client_id, valor: Number(corpo.valor) || 0, destino: String(corpo.destino || '').slice(0, 40) });
        return json(res, 201, { status: 'transferência registrada', usuario: c.sub, ...corpo });
      }
      if (req.method === 'GET' && url.pathname === '/relatorios/resumo') {
        const c = autorizar(req, res, 'relatorios:read'); if (!c) return;
        const todas = Object.values(contas).flatMap((x) => x.transacoes);
        const entradas = todas.filter((t) => t.valor > 0).reduce((s, t) => s + t.valor, 0);
        const saidas = todas.filter((t) => t.valor < 0).reduce((s, t) => s + t.valor, 0);
        return json(res, 200, { solicitante: c.sub, periodo: '2026-10', entradas, saidas: Math.abs(saidas), quantidade: todas.length });
      }
      json(res, 404, { error: 'not_found' });
    } catch (e) {
      console.error('[api] erro:', e);
      audit(req, 'ERRO_SERVIDOR', { nivel: 'ERRO', motivo: e.message });
      json(res, 500, { error: 'server_error' });
    }
  }));
}

function iniciar(porta = cfg.PORTAS.api) {
  return new Promise((resolve, reject) => {
    const s = criarServidor();
    s.once('error', reject);
    s.listen(porta, () => { log(`API Financeira em http://localhost:${porta}`); resolve(s); });
  });
}

if (require.main === module) iniciar().catch((e) => { console.error(e.message); process.exit(1); });
module.exports = { iniciar };
