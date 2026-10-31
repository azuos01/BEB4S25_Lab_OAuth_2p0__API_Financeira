// =============================================================
// iniciar.js — Sobe os três papéis do OAuth no mesmo processo
// =============================================================
const cfg = require('./config');
const auth = require('./auth-server');
const api = require('./api-financeira');
const cliente = require('./cliente-web');

(async () => {
  await auth.iniciar();
  await api.iniciar();
  await cliente.iniciar();
  console.log(`
==============================================================
 Laboratório OAuth em execução
  Servidor de Autorização : ${cfg.EMISSOR}
  API Financeira (recursos): http://localhost:${cfg.PORTAS.api}
  App Finanças (cliente)   : http://localhost:${cfg.PORTAS.cliente}   <-- abra no navegador
  Usuário demo: aluno / senha123   | access token: ${cfg.ACCESS_TOKEN_TTL}s
  Pressione Ctrl+C para encerrar.
==============================================================`);
})().catch((e) => {
  console.error(`Falha ao iniciar: ${e.message}`);
  if (e.code === 'EADDRINUSE') console.error('Porta ocupada. Feche o outro servidor (Ctrl+C) ou defina AUTH_PORT/API_PORT/CLIENT_PORT.');
  process.exit(1);
});
