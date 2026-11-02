// =============================================================
// analisar-logs.js — ANÁLISE dos logs de auditoria
// Verifica a integridade, calcula indicadores (KPIs), correlaciona
// eventos por IP / usuário / req_id e gera relatório HTML + JSON.
// Uso:  npm run analisar
//       npm run analisar -- --decifrar        (mostra logins digitados errado)
//       npm run analisar -- --req=<req_id>    (rastreia uma requisição ponta a ponta)
//       npm run analisar -- --dir=<pasta>     (outra pasta de logs)
// Código de saída: 0 = ok | 2 = integridade violada
// =============================================================
const fs = require('node:fs');
const path = require('node:path');
const cfg = require('./config');
const auditoria = require('./auditoria');

const contar = (lista, chave) => lista.reduce((m, x) => { const k = chave(x); if (k !== undefined) m[k] = (m[k] || 0) + 1; return m; }, {});
const top = (obj, n = 5) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n);
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
function p95(valores) {
  if (!valores.length) return 0;
  const v = [...valores].sort((a, b) => a - b);
  return v[Math.min(v.length - 1, Math.ceil(v.length * 0.95) - 1)];
}

function analisar(dir = cfg.AUDITORIA.LOG_DIR) {
  const integridade = auditoria.verificarIntegridade(dir);
  const ev = auditoria.lerEventos(dir);
  const http = ev.filter((e) => e.tipo === 'HTTP_REQUISICAO');
  const seguranca = ev.filter((e) => e.tipo !== 'HTTP_REQUISICAO');
  const criticos = ev.filter((e) => e.nivel === 'CRITICO');
  const loginsOk = ev.filter((e) => e.tipo === 'LOGIN_SUCESSO').length;
  const loginsFalha = ev.filter((e) => e.tipo === 'LOGIN_FALHA').length;
  const apiHttp = http.filter((e) => e.origem === 'api');
  const errosHttp = http.filter((e) => e.status >= 400).length;

  const porOrigem = {};
  for (const o of ['auth', 'api', 'cliente']) {
    const l = http.filter((e) => e.origem === o);
    porOrigem[o] = { total: l.length, erros_4xx: l.filter((e) => e.status >= 400 && e.status < 500).length, erros_5xx: l.filter((e) => e.status >= 500).length, p95_ms: p95(l.map((e) => e.duracao_ms)) };
  }

  // Correlação por IP: eventos de segurança com nível AVISO/CRITICO (exclui log de acesso)
  const suspeitos = seguranca.filter((e) => ['AVISO', 'CRITICO'].includes(e.nivel) && e.ip);
  const suspeitosPorIp = top(contar(suspeitos, (e) => e.ip), 8).map(([ip, n]) => ({
    ip, eventos: n, tipos: contar(suspeitos.filter((e) => e.ip === ip), (e) => e.tipo),
    bloqueado: ev.some((e) => e.tipo === 'ALERTA_FORCA_BRUTA' && e.ip === ip),
  }));

  // Linha do tempo por minuto
  const linhaDoTempo = Object.entries(ev.reduce((m, e) => {
    const k = e.ts.slice(0, 16);
    m[k] = m[k] || { total: 0, avisos: 0, criticos: 0 };
    m[k].total++;
    if (e.nivel === 'AVISO') m[k].avisos++;
    if (e.nivel === 'CRITICO') m[k].criticos++;
    return m;
  }, {})).map(([minuto, v]) => ({ minuto, ...v }));

  const taxaFalhaLogin = pct(loginsFalha, loginsOk + loginsFalha);
  const taxaErroHttp = pct(errosHttp, http.length);
  const p95Api = p95(apiHttp.map((e) => e.duracao_ms));
  const ipsBloqueados = [...new Set(ev.filter((e) => e.tipo === 'ALERTA_FORCA_BRUTA').map((e) => e.ip))];
  const kpis = [
    { nome: 'Integridade dos logs', valor: integridade.ok ? 'íntegros' : `${integridade.erros.length} violação(ões)`, meta: 'íntegros', ok: integridade.ok },
    { nome: 'Alertas críticos', valor: criticos.length, meta: '0', ok: criticos.length === 0 },
    { nome: 'IPs bloqueados (força bruta)', valor: ipsBloqueados.length, meta: '0', ok: ipsBloqueados.length === 0 },
    { nome: 'Taxa de falha de login', valor: `${taxaFalhaLogin}%`, meta: '< 20%', ok: taxaFalhaLogin < 20 },
    { nome: 'Taxa de erro HTTP (4xx+5xx)', valor: `${taxaErroHttp}%`, meta: '< 10%', ok: taxaErroHttp < 10 },
    { nome: 'Latência p95 da API', valor: `${p95Api} ms`, meta: '< 200 ms', ok: p95Api < 200 },
  ];

  const recomendacoes = [];
  if (!integridade.ok) recomendacoes.push('Logs adulterados ou corrompidos: preservar cópia, abrir incidente e investigar acesso ao servidor de logs.');
  for (const s of suspeitosPorIp.filter((x) => x.bloqueado)) recomendacoes.push(`IP ${s.ip}: força bruta (${s.eventos} eventos suspeitos) — manter bloqueio, avaliar bloqueio permanente no firewall/WAF.`);
  if (ev.some((e) => e.tipo === 'ALERTA_TOKEN_ADULTERADO')) recomendacoes.push('Tokens com assinatura inválida: alguém está forjando tokens — verificar exposição do segredo de assinatura e migrar para chaves assimétricas (RS256/ES256).');
  if (ev.some((e) => e.tipo === 'REFRESH_REUSO')) recomendacoes.push('Reuso de refresh token: sessão possivelmente roubada — avisar o usuário, revisar dispositivos e forçar novo login.');
  const escal = ev.filter((e) => e.tipo === 'ACESSO_NEGADO' && e.status === 403);
  if (escal.length >= 3) recomendacoes.push(`${escal.length} tentativas de acesso fora do escopo (403): revisar o cliente ${[...new Set(escal.map((e) => e.client_id))].join(', ')} e criar alerta para picos de 403.`);
  if (!recomendacoes.length) recomendacoes.push('Nenhuma anomalia relevante no período. Manter revisão periódica.');

  return {
    gerado_em: new Date().toISOString(), pasta: dir,
    periodo: { inicio: ev[0]?.ts, fim: ev[ev.length - 1]?.ts },
    integridade, total_eventos: ev.length,
    por_tipo: contar(ev, (e) => e.tipo), por_nivel: contar(ev, (e) => e.nivel),
    http: { total: http.length, taxa_erro_pct: taxaErroHttp, por_origem: porOrigem, por_status: contar(http, (e) => e.status) },
    autenticacao: { logins_sucesso: loginsOk, logins_falha: loginsFalha, taxa_falha_pct: taxaFalhaLogin, falhas_cliente: ev.filter((e) => e.tipo === 'CLIENTE_AUTH_FALHA').length },
    suspeitos_por_ip: suspeitosPorIp, ips_bloqueados: ipsBloqueados,
    alertas: criticos.map((e) => ({ ts: e.ts, tipo: e.tipo, ip: e.ip, req_id: e.req_id, detalhe: e.acao || e.motivo || '' })),
    negados_por_motivo: contar(ev.filter((e) => e.tipo === 'ACESSO_NEGADO'), (e) => `${e.status} ${e.motivo}`),
    linha_do_tempo: linhaDoTempo, kpis, recomendacoes,
  };
}

// ---------------------------------------------------------------- relatório HTML
function htmlRelatorio(r) {
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const maxIp = Math.max(1, ...r.suspeitos_por_ip.map((s) => s.eventos));
  const maxMin = Math.max(1, ...r.linha_do_tempo.map((m) => m.total));
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Relatório de auditoria</title><style>
body{margin:0;background:#0e1116;color:#e6edf3;font:15px/1.5 "Segoe UI",system-ui,sans-serif}main{max-width:1000px;margin:0 auto;padding:20px 16px 48px}
h1{margin:.2rem 0}h2{font-size:1.1rem;margin:1.6rem 0 .6rem}.sub{color:#9aa6b2}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}.kpi{background:#161b22;border:1px solid #2a313c;border-radius:10px;padding:12px}
.kpi b{display:block;font-size:1.4rem;font-variant-numeric:tabular-nums}.kpi small{color:#9aa6b2}.kpi.ok{border-left:4px solid #3fb68b}.kpi.ruim{border-left:4px solid #f85149}
table{width:100%;border-collapse:collapse;font-size:.88rem}th,td{text-align:left;padding:.4rem;border-bottom:1px solid #2a313c;vertical-align:top}th{color:#9aa6b2}
.barra{height:12px;background:#f0883e;border-radius:3px}.barra.c{background:#f85149}.tl{display:flex;align-items:flex-end;gap:3px;height:120px;border-bottom:1px solid #2a313c}
.tl div{flex:1;max-width:48px;background:#3fb68b;min-width:4px;border-radius:2px 2px 0 0}.tl div.c{background:#f85149}.tag{display:inline-block;background:#222a35;border-radius:5px;padding:0 .4rem;margin:1px;font-size:.8rem}
.box{background:#161b22;border:1px solid #2a313c;border-radius:10px;padding:12px 14px}.erro{color:#ff7b72}.okc{color:#3fb68b}code{font-family:Consolas,monospace}
</style></head><body><main>
<p class="sub">Laboratório 2 · Auditoria e logs da API Financeira</p><h1>Relatório de auditoria</h1>
<p class="sub">Período: ${esc(r.periodo.inicio)} → ${esc(r.periodo.fim)} · ${r.total_eventos} eventos · gerado em ${esc(r.gerado_em)}</p>
<h2>Indicadores</h2><div class="kpis">${r.kpis.map((k) => `<div class="kpi ${k.ok ? 'ok' : 'ruim'}"><small>${esc(k.nome)}</small><b>${esc(k.valor)}</b><small>meta: ${esc(k.meta)} · ${k.ok ? 'OK' : 'ATENÇÃO'}</small></div>`).join('')}</div>
<h2>Integridade da cadeia de logs</h2><div class="box">${r.integridade.ok ? `<span class="okc">✔ ${r.integridade.total} registros verificados em ${r.integridade.arquivos.length} arquivo(s); nenhum alterado.</span>` : `<span class="erro">✘ ${r.integridade.erros.length} problema(s):</span><ul>${r.integridade.erros.slice(0, 20).map((e) => `<li class="erro">${esc(e.arquivo)} linha ${e.linha}: ${esc(e.motivo)}</li>`).join('')}</ul>`}
${r.integridade.ancora && !r.integridade.ancora.completa ? '<p class="sub">Início da cadeia em arquivo posterior ao GENESIS: arquivos mais antigos foram expurgados pela política de retenção.</p>' : ''}</div>
<h2>Alertas críticos (${r.alertas.length})</h2><table><tr><th>Horário</th><th>Tipo</th><th>IP</th><th>Detalhe</th><th>req_id</th></tr>
${r.alertas.map((a) => `<tr><td>${esc(a.ts)}</td><td>${esc(a.tipo)}</td><td>${esc(a.ip)}</td><td>${esc(a.detalhe)}</td><td><code>${esc(String(a.req_id || '').slice(0, 8))}</code></td></tr>`).join('') || '<tr><td colspan="5">Nenhum</td></tr>'}</table>
<h2>IPs com mais eventos suspeitos</h2><table><tr><th>IP</th><th style="width:35%">Eventos</th><th>Tipos</th></tr>
${r.suspeitos_por_ip.map((s) => `<tr><td>${esc(s.ip)}${s.bloqueado ? ' <span class="tag">bloqueado</span>' : ''}</td><td><div class="barra ${s.bloqueado ? 'c' : ''}" style="width:${(s.eventos / maxIp) * 100}%"></div>${s.eventos}</td><td>${Object.entries(s.tipos).map(([t, n]) => `<span class="tag">${esc(t)} ×${n}</span>`).join('')}</td></tr>`).join('')}</table>
<h2>Eventos por minuto</h2><div class="tl">${r.linha_do_tempo.map((m) => `<div class="${m.criticos ? 'c' : ''}" style="height:${(m.total / maxMin) * 100}%" title="${esc(m.minuto)}: ${m.total} eventos, ${m.criticos} críticos"></div>`).join('')}</div>
<p class="sub">Barras vermelhas = minutos com eventos críticos.</p>
<h2>Acessos negados por motivo</h2><table>${Object.entries(r.negados_por_motivo).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v}</td></tr>`).join('') || '<tr><td>Nenhum</td></tr>'}</table>
<h2>Tráfego HTTP por serviço</h2><table><tr><th>Serviço</th><th>Requisições</th><th>4xx</th><th>5xx</th><th>p95</th></tr>
${Object.entries(r.http.por_origem).map(([o, v]) => `<tr><td>${o}</td><td>${v.total}</td><td>${v.erros_4xx}</td><td>${v.erros_5xx}</td><td>${v.p95_ms} ms</td></tr>`).join('')}</table>
<h2>Recomendações</h2><ul>${r.recomendacoes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
</main></body></html>`;
}

// ---------------------------------------------------------------- CLI
if (require.main === module) {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
  const dir = args.dir || cfg.AUDITORIA.LOG_DIR;
  if (!auditoria.listarArquivos(dir).length) {
    console.error(`Nenhum log em ${dir}. Rode "npm start" e gere tráfego ("npm run simular") antes.`);
    process.exit(1);
  }
  if (args.req) {
    const lista = auditoria.lerEventos(dir).filter((e) => e.req_id === args.req);
    console.log(`Rastreio do req_id ${args.req} (${lista.length} eventos):`);
    for (const e of lista) console.log(`  ${e.ts} [${e.origem}] ${e.tipo} ${e.metodo || ''} ${e.rota || ''} ${e.status || ''} ${e.motivo || ''}`);
    process.exit(0);
  }
  const r = analisar(dir);
  const L = (s = '') => console.log(s);
  L('==================== ANÁLISE DOS LOGS DE AUDITORIA ====================');
  L(`Pasta: ${dir}`);
  L(`Período: ${r.periodo.inicio} -> ${r.periodo.fim} | ${r.total_eventos} eventos`);
  L(`Integridade: ${r.integridade.ok ? 'OK' : 'VIOLADA'} (${r.integridade.total} registros, ${r.integridade.arquivos.length} arquivo(s))`);
  for (const e of r.integridade.erros.slice(0, 10)) L(`   ! ${e.arquivo} linha ${e.linha}: ${e.motivo}`);
  L('\nIndicadores:');
  for (const k of r.kpis) L(`  [${k.ok ? 'OK' : 'ATENCAO'}] ${k.nome}: ${k.valor} (meta ${k.meta})`);
  L(`\nAlertas críticos: ${r.alertas.length}`);
  for (const a of r.alertas) L(`  ${a.ts} ${a.tipo} ip=${a.ip} ${a.detalhe}`);
  L('\nIPs com mais eventos suspeitos:');
  for (const s of r.suspeitos_por_ip) L(`  ${s.ip.padEnd(16)} ${String(s.eventos).padStart(3)} ${s.bloqueado ? '[BLOQUEADO] ' : ''}${Object.keys(s.tipos).join(', ')}`);
  if (args.decifrar) {
    L('\nLogins digitados nas falhas (decifrados — acesso restrito à equipe de segurança):');
    for (const e of auditoria.lerEventos(dir).filter((x) => x.tipo === 'LOGIN_FALHA')) {
      let login; try { login = auditoria.decifrar(e.login_cifrado); } catch { login = '(chave incorreta)'; }
      L(`  ${e.ts} ip=${e.ip} login="${login}"`);
    }
  }
  L('\nRecomendações:');
  for (const x of r.recomendacoes) L(`  - ${x}`);
  const pasta = path.join(__dirname, '..', 'relatorio');
  fs.mkdirSync(pasta, { recursive: true });
  fs.writeFileSync(path.join(pasta, 'indicadores.json'), JSON.stringify(r, null, 2));
  fs.writeFileSync(path.join(pasta, 'relatorio-auditoria.html'), htmlRelatorio(r));
  L(`\nRelatório: ${path.join(pasta, 'relatorio-auditoria.html')}`);
  process.exit(r.integridade.ok ? 0 : 2);
}

module.exports = { analisar, htmlRelatorio };
