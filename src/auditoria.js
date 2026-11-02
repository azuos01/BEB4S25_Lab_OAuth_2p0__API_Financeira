// =============================================================
// auditoria.js — LOG DE AUDITORIA estruturado e seguro
//  * JSON Lines (1 evento por linha) — formato aceito por ELK,
//    Splunk, Graylog, Loki... sem conversão
//  * Mascaramento de segredos (senha, tokens, client_secret)
//  * Cifra AES-256-GCM para dados sensíveis (login digitado)
//  * Integridade: HMAC encadeado linha a linha
//  * Rotação por tamanho + retenção por quantidade e idade
//  * Regras de alerta: força bruta (com bloqueio de IP) e
//    eventos CRÍTICOS (console, alertas.log e webhook opcional)
// =============================================================
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cfg = require('./config');

const A = cfg.AUDITORIA;
const arqAtual = (dir = A.LOG_DIR) => path.join(dir, 'auditoria.log');
const arqAlertas = () => path.join(A.LOG_DIR, 'alertas.log');
const PADRAO_ROTACIONADO = /^auditoria-\d{8}T\d{9}-\d{3}\.log$/;
const CHAVE_AES = crypto.createHash('sha256').update(A.CHAVE_CIFRA).digest(); // produção: chave vinda de cofre/KMS

let ultimoHash = null; // último elo da cadeia de integridade
const memoria = []; // últimos eventos em memória (consultas rápidas e testes)
const falhasPorIp = new Map(); // ip -> [timestamps] (janela deslizante)
const bloqueados = new Map(); // ip -> expira em (ms)

// ---------------------------------------------------------------- utilidades
const hmac = (anterior, corpo) => crypto.createHmac('sha256', A.CHAVE_INTEGRIDADE).update(`${anterior}|${corpo}`).digest('hex');
const impressao = (v) => `sha256:${crypto.createHash('sha256').update(String(v)).digest('hex').slice(0, 12)}`;

function cifrar(texto) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', CHAVE_AES, iv);
  const ct = Buffer.concat([c.update(String(texto), 'utf8'), c.final()]);
  return `gcm:${iv.toString('base64url')}.${ct.toString('base64url')}.${c.getAuthTag().toString('base64url')}`;
}

function decifrar(valor) {
  const [iv, ct, tag] = String(valor).slice(4).split('.').map((x) => Buffer.from(x, 'base64url'));
  const d = crypto.createDecipheriv('aes-256-gcm', CHAVE_AES, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}

// Campos cujo NOME indica segredo nunca são gravados em claro:
// strings viram uma impressão digital (permite correlacionar sem expor)
const SENSIVEL = /(senha|password|secret|authorization|code_verifier|^code$|token)/i;
function mascarar(valor, chave = '') {
  if (SENSIVEL.test(chave)) return typeof valor === 'string' ? impressao(valor) : '[OCULTO]';
  if (Array.isArray(valor)) return valor.map((v) => mascarar(v));
  if (valor && typeof valor === 'object') {
    return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, mascarar(v, k)]));
  }
  return valor;
}

// IP do cliente. X-Forwarded-For pode ser forjado: só use atrás de proxy confiável
function ipDe(req) {
  const xff = req.headers['x-forwarded-for'];
  if (A.CONFIAR_PROXY && xff) return String(xff).split(',')[0].trim().slice(0, 45);
  return String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
}

// ---------------------------------------------------------------- arquivos
function listarArquivos(dir = A.LOG_DIR) {
  if (!fs.existsSync(dir)) return [];
  const lista = fs.readdirSync(dir).filter((f) => PADRAO_ROTACIONADO.test(f)).sort().map((f) => path.join(dir, f));
  if (fs.existsSync(arqAtual(dir))) lista.push(arqAtual(dir));
  return lista; // ordem cronológica: rotacionados (mais antigo primeiro) + atual
}

function lerUltimoHash() {
  const arquivos = listarArquivos();
  for (let i = arquivos.length - 1; i >= 0; i--) {
    const linhas = fs.readFileSync(arquivos[i], 'utf8').split('\n').filter(Boolean);
    if (linhas.length) {
      try { return JSON.parse(linhas[linhas.length - 1]).hash || 'SEM-HASH'; } catch { return 'LINHA-CORROMPIDA'; }
    }
  }
  return 'GENESIS';
}

function garantirInicio() {
  if (ultimoHash !== null) return;
  fs.mkdirSync(A.LOG_DIR, { recursive: true });
  ultimoHash = lerUltimoHash(); // continua a cadeia após reiniciar o servidor
}

function aplicarRetencao() {
  const rotacionados = listarArquivos().filter((f) => PADRAO_ROTACIONADO.test(path.basename(f)));
  const limiteIdade = Date.now() - A.LOG_RETENCAO_DIAS * 86400000;
  const expurgados = [];
  rotacionados.forEach((f, i) => {
    const excedeQuantidade = i < rotacionados.length - A.LOG_RETENCAO_ARQUIVOS;
    if (excedeQuantidade || fs.statSync(f).mtimeMs < limiteIdade) {
      fs.unlinkSync(f);
      expurgados.push(path.basename(f));
    }
  });
  return expurgados;
}

// Renomeia o arquivo atual quando ele passaria do limite. Devolve a informação da
// rotação, que é gravada DENTRO do próximo evento (a própria rotação fica auditada).
function rotacionarSeNecessario(bytesNovos) {
  const atual = arqAtual();
  if (!fs.existsSync(atual) || fs.statSync(atual).size + bytesNovos <= A.LOG_MAX_BYTES) return null;
  const ts = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 18); // 20261102T190512345
  let n = 0;
  let destino;
  do { destino = path.join(A.LOG_DIR, `auditoria-${ts}-${String(n++).padStart(3, '0')}.log`); } while (fs.existsSync(destino));
  try {
    fs.renameSync(atual, destino); // no Windows falha se outro programa travar o arquivo
  } catch (e) {
    console.error(`[auditoria] rotação adiada: ${e.message}`);
    return null;
  }
  return { arquivo_rotacionado: path.basename(destino), expurgados: aplicarRetencao() };
}

// ---------------------------------------------------------------- registro
function registrar(dados) {
  garantirInicio();
  const { req, ...resto } = dados;
  const registro = { ts: new Date().toISOString(), nivel: 'INFO', ...mascarar(resto) };
  if (req) {
    if (!registro.ip) registro.ip = req.ipCliente || ipDe(req);
    if (!registro.req_id && req.idReq) registro.req_id = req.idReq;
  }
  const montar = () => {
    registro.hash_anterior = ultimoHash;
    delete registro.hash;
    registro.hash = hmac(ultimoHash, JSON.stringify(registro));
    return `${JSON.stringify(registro)}\n`;
  };
  let linha = montar();
  const rotacao = rotacionarSeNecessario(Buffer.byteLength(linha));
  if (rotacao) {
    delete registro.hash_anterior;
    registro.rotacao = rotacao;
    linha = montar();
  }
  fs.appendFileSync(arqAtual(), linha, { mode: 0o600 }); // síncrono: ordem garantida
  ultimoHash = registro.hash;
  memoria.push(registro);
  if (memoria.length > 2000) memoria.shift();
  avaliarRegras(registro);
  return registro;
}

// ---------------------------------------------------------------- regras / alertas
function estaBloqueado(ip) {
  const ate = bloqueados.get(ip);
  if (!ate) return false;
  if (Date.now() > ate) { bloqueados.delete(ip); return false; }
  return true;
}

function emitirAlerta(r) {
  const texto = `[ALERTA ${r.nivel}] ${r.ts} ${r.tipo} ip=${r.ip || '-'} ${r.motivo || r.acao || ''}`;
  if (!process.env.OAUTH_QUIET) console.error(`\x1b[41m\x1b[97m${texto}\x1b[0m`);
  fs.appendFileSync(arqAlertas(), `${JSON.stringify(r)}\n`, { mode: 0o600 });
  if (A.ALERTA_WEBHOOK) {
    fetch(A.ALERTA_WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: texto }) })
      .catch((e) => console.error(`[auditoria] webhook falhou: ${e.message}`));
  }
}

function avaliarRegras(r) {
  if (r.nivel === 'CRITICO') emitirAlerta(r);
  if (!A.EVENTOS_FALHA_AUTH.includes(r.tipo) || !r.ip) return;
  const agora = Date.now();
  const janela = (falhasPorIp.get(r.ip) || []).filter((t) => agora - t < A.JANELA_S * 1000);
  janela.push(agora);
  falhasPorIp.set(r.ip, janela);
  if (janela.length >= A.LIMITE_FALHAS && !estaBloqueado(r.ip)) {
    bloqueados.set(r.ip, agora + A.BLOQUEIO_S * 1000);
    falhasPorIp.delete(r.ip);
    registrar({ tipo: 'ALERTA_FORCA_BRUTA', nivel: 'CRITICO', origem: r.origem, ip: r.ip, req_id: r.req_id, falhas: janela.length, janela_s: A.JANELA_S, acao: `IP bloqueado por ${A.BLOQUEIO_S}s` });
  }
}

// ---------------------------------------------------------------- middleware HTTP
// Envolve o handler: gera/propaga X-Request-Id, mede a duração e grava o log de acesso.
// A query string NÃO é gravada (pode conter code, state e outros dados sensíveis).
function envolver(origem, handler) {
  return (req, res) => {
    const recebido = String(req.headers['x-request-id'] || '');
    req.idReq = /^[A-Za-z0-9._-]{8,64}$/.test(recebido) ? recebido : crypto.randomUUID(); // evita injeção no log
    req.ipCliente = ipDe(req);
    res.setHeader('X-Request-Id', req.idReq);
    const inicio = process.hrtime.bigint();
    res.on('finish', () => {
      const status = res.statusCode;
      registrar({
        tipo: 'HTTP_REQUISICAO', nivel: status >= 500 ? 'ERRO' : status >= 400 ? 'AVISO' : 'INFO', origem,
        metodo: req.method, rota: new URL(req.url, 'http://local').pathname, status,
        duracao_ms: Math.round(Number(process.hrtime.bigint() - inicio) / 1e4) / 100,
        user_agent: String(req.headers['user-agent'] || '').slice(0, 120), req,
      });
    });
    return handler(req, res);
  };
}

// ---------------------------------------------------------------- verificação
function verificarIntegridade(dir = A.LOG_DIR) {
  const arquivos = listarArquivos(dir);
  const erros = [];
  let anterior = null;
  let total = 0;
  let ancora = null;
  for (const arq of arquivos) {
    const nome = path.basename(arq);
    fs.readFileSync(arq, 'utf8').split('\n').forEach((linha, i) => {
      if (!linha.trim()) return;
      total++;
      let r;
      try { r = JSON.parse(linha); } catch {
        erros.push({ arquivo: nome, linha: i + 1, motivo: 'linha não é JSON válido' });
        anterior = null;
        return;
      }
      const { hash, ...corpo } = r;
      if (anterior === null && !ancora) ancora = { arquivo: nome, linha: i + 1, completa: r.hash_anterior === 'GENESIS' };
      else if (anterior !== null && r.hash_anterior !== anterior) erros.push({ arquivo: nome, linha: i + 1, motivo: 'encadeamento quebrado (linha removida, inserida ou reordenada)' });
      if (hmac(r.hash_anterior, JSON.stringify(corpo)) !== hash) erros.push({ arquivo: nome, linha: i + 1, motivo: 'conteúdo alterado (HMAC não confere)' });
      anterior = hash;
    });
  }
  return { ok: erros.length === 0, total, arquivos: arquivos.map((a) => path.basename(a)), ancora, erros };
}

function lerEventos(dir = A.LOG_DIR) {
  const eventos = [];
  for (const arq of listarArquivos(dir)) {
    for (const linha of fs.readFileSync(arq, 'utf8').split('\n')) {
      if (!linha.trim()) continue;
      try { eventos.push(JSON.parse(linha)); } catch { /* linha corrompida: apontada pela verificação */ }
    }
  }
  return eventos;
}

module.exports = {
  registrar, envolver, estaBloqueado, cifrar, decifrar, impressao, mascarar,
  verificarIntegridade, lerEventos, listarArquivos, memoria,
};
