// =============================================================
// client-credentials.js — Comunicação SERVIDOR-SERVIDOR
// O "Serviço de Relatórios" não tem usuário: autentica-se com o
// próprio client_id/client_secret e recebe um token só dele.
// Uso (com "npm start" rodando em outro terminal): npm run cc
// =============================================================
const cfg = require('./config');

const svc = cfg.CLIENTES.find((c) => c.client_id === 'servico-relatorios');
const API = `http://localhost:${cfg.PORTAS.api}`;
const basic = Buffer.from(`${svc.client_id}:${svc.client_secret}`).toString('base64');

async function chamar(caminho, token) {
  const r = await fetch(`${API}${caminho}`, { headers: { Authorization: `Bearer ${token}` } });
  console.log(`   GET ${caminho} -> HTTP ${r.status}`);
  console.log(JSON.stringify(await r.json(), null, 2).replace(/^/gm, '   '));
}

(async () => {
  console.log('1) Serviço de Relatórios pede token direto ao provedor (grant_type=client_credentials)');
  const r = await fetch(`${cfg.EMISSOR}/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'relatorios:read' }),
  });
  const t = await r.json();
  console.log(`   HTTP ${r.status} | scope=${t.scope} | expires_in=${t.expires_in}s | refresh_token=${t.refresh_token ?? '(nenhum — não há usuário)'}`);
  if (!r.ok) process.exit(1);

  console.log('2) Usa o token no recurso permitido pelo escopo:');
  await chamar('/relatorios/resumo', t.access_token);

  console.log('3) Tenta um recurso de usuário (fora do escopo) — esperado 403:');
  await chamar('/transacoes', t.access_token);
})().catch((e) => {
  console.error(`Erro: ${e.message}. O laboratório está rodando? Execute "npm start" em outro terminal.`);
  process.exit(1);
});
