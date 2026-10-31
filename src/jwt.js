// =============================================================
// jwt.js — Assinatura e validação de JWT (HS256) sem bibliotecas
// Em produção prefira bibliotecas consolidadas (ex.: "jose") e
// assinatura assimétrica (RS256/ES256) publicada via JWKS.
// =============================================================
const crypto = require('node:crypto');

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const hmac = (dados, segredo) => crypto.createHmac('sha256', segredo).update(dados).digest('base64url');

function assinar(payload, segredo) {
  const cabecalho = b64({ alg: 'HS256', typ: 'JWT' });
  const corpo = b64(payload);
  return `${cabecalho}.${corpo}.${hmac(`${cabecalho}.${corpo}`, segredo)}`;
}

function verificar(token, segredo) {
  const partes = String(token || '').split('.');
  if (partes.length !== 3) throw new Error('token malformado');
  const [cabecalho, corpo, assinatura] = partes;
  const esperado = Buffer.from(hmac(`${cabecalho}.${corpo}`, segredo));
  const recebido = Buffer.from(assinatura);
  // comparação em tempo constante (evita ataque de temporização)
  if (esperado.length !== recebido.length || !crypto.timingSafeEqual(esperado, recebido)) {
    throw new Error('assinatura invalida (token adulterado ou de outro emissor)');
  }
  const payload = JSON.parse(Buffer.from(corpo, 'base64url').toString());
  if (!payload.exp || Math.floor(Date.now() / 1000) >= payload.exp) throw new Error('token expirado');
  return payload;
}

// Apenas lê as claims (NÃO valida) — usado pelo cliente para exibir na tela
function decodificar(token) {
  try {
    return JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString());
  } catch {
    return null;
  }
}

module.exports = { assinar, verificar, decodificar };
