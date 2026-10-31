// =============================================================
// util.js — Funções auxiliares HTTP (somente módulos nativos)
// =============================================================
const crypto = require('node:crypto');

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    let dados = '';
    req.on('data', (parte) => {
      dados += parte;
      if (dados.length > 1e6) req.destroy(); // limite de 1 MB
    });
    req.on('end', () => {
      try {
        const tipo = req.headers['content-type'] || '';
        if (tipo.includes('application/json')) return resolve(dados ? JSON.parse(dados) : {});
        resolve(Object.fromEntries(new URLSearchParams(dados)));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function json(res, status, obj, extras = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extras });
  res.end(JSON.stringify(obj, null, 2));
}

function html(res, status, corpo, extras = {}) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...extras });
  res.end(corpo);
}

function redirecionar(res, url) {
  res.writeHead(302, { Location: url });
  res.end();
}

function lerCookies(req) {
  return Object.fromEntries(
    (req.headers.cookie || '').split(';').filter((c) => c.includes('=')).map((c) => {
      const i = c.indexOf('=');
      return [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1).trim())];
    })
  );
}

const aleatorio = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
const sha256b64url = (texto) => crypto.createHash('sha256').update(texto).digest('base64url');

function iguaisSeguro(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function pagina(titulo, corpo, cor = '#2563eb') {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(titulo)}</title>
<style>
 body{font-family:system-ui,Segoe UI,sans-serif;max-width:860px;margin:2rem auto;padding:0 1rem;color:#1f2937;background:#f8fafc}
 .tag{display:inline-block;background:${cor};color:#fff;padding:.2rem .6rem;border-radius:99px;font-size:.8rem}
 h1{margin:.4rem 0 1rem} h2{font-size:1.05rem;margin-top:1.6rem}
 pre{background:#0f172a;color:#e2e8f0;padding:1rem;border-radius:8px;overflow:auto;font-size:.85rem}
 .btn,button{display:inline-block;background:${cor};color:#fff;border:0;padding:.55rem .9rem;border-radius:6px;
   text-decoration:none;font-size:.9rem;cursor:pointer;margin:.2rem .2rem .2rem 0}
 .sec{background:#475569} .perigo{background:#b91c1c}
 form{display:inline} label{display:block;margin:.5rem 0} input{padding:.45rem;border:1px solid #cbd5e1;border-radius:6px}
 form.bloco{display:block;background:#fff;padding:1rem;border-radius:8px;border:1px solid #e2e8f0}
 .erro{color:#b91c1c;font-weight:600} .dica{font-size:.85rem;color:#475569} ol li{margin:.25rem 0;font-size:.9rem}
</style></head><body>${corpo}</body></html>`;
}

module.exports = { lerCorpo, json, html, redirecionar, lerCookies, aleatorio, sha256b64url, iguaisSeguro, esc, pagina };
