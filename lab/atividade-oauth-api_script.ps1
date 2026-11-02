<#
=====================================================================================
 atividade-oauth-api_script.ps1
 Laboratório "Descomplicando o OAuth: autorização segura para APIs"
 Programação Back-End · 2ª série · 4º bimestre · Semana 25 · Aula 1
 Prof. Marcos Souza — gerado com apoio do Claude (Anthropic) em 31/10/2026, às 14:20 (horário de Brasília)
=====================================================================================

USO (sem interação humana; não precisa ser administrador):
  powershell -ExecutionPolicy Bypass -File .\atividade-oauth-api_script.ps1
  powershell -ExecutionPolicy Bypass -File .\atividade-oauth-api_script.ps1 -Destino "D:\lab\oauth" -SemServidor

O QUE É AUTOMÁTICO x O QUE É MANUAL
  Automático (local): verificar ferramentas, criar pastas e 14 arquivos, checar sintaxe,
    commit inicial, testes (25 regras), subir os 3 servidores, validar respostas HTTP,
    executar o Client Credentials Flow, abrir navegador e VS Code, gerar o relatório CSV.
  Manual (aluno): fluxo Authorization Code no navegador (login + consentimento), testes de
    segurança com prints, expiração/renovação, redigir o plano, commit do plano, entrega e,
    se a turma usar, criar repositório remoto + login + git push.
    >>> Este script NUNCA faz login, push ou deploy remoto. <<<

TABELA DE REFERÊNCIA (guia de suporte em sala)
-------------------------------------------------------------------------------------
 ID | Passo                    | Ambiente   | Comando equivalente
    |   Sucesso (exemplo)      ->  Falha típica (exemplo)
-------------------------------------------------------------------------------------
 01 | Node.js >= 20            | PowerShell | node -v
    |   v22.11.0               ->  node : O termo 'node' não é reconhecido como nome de cmdlet
 02 | npm >= 10                | PowerShell | npm.cmd -v
    |   10.9.0                 ->  npm.ps1 não pode ser carregado ... execução de scripts desabilitada
 03 | Git >= 2.40              | PowerShell | git --version
    |   git version 2.47.1.windows.1 -> git : O termo 'git' não é reconhecido
 04 | VS Code >= 1.85 (opc.)   | PowerShell | code --version
    |   1.95.3                 ->  code : O termo 'code' não é reconhecido (faltou "Add to PATH")
 05 | Estrutura de pastas      | PowerShell | New-Item -ItemType Directory <destino>\src,testes,docs
    |   3 subpastas criadas    ->  Acesso ao caminho '...' foi negado
 06 | Gravar arquivos          | PowerShell | [IO.File]::WriteAllText(...)
    |   14 de 14 arquivos      ->  O processo não pode acessar o arquivo ... sendo usado por outro processo
 07 | Sintaxe JavaScript       | Node.js    | node --check src\<arquivo>.js
    |   9 arquivos sem erro   ->  SyntaxError: Unexpected end of input
 08 | package.json válido      | PowerShell | Get-Content package.json | ConvertFrom-Json
    |   scripts start/test/cc  ->  ConvertFrom-Json : Primitivo JSON inválido
 09 | Git init + commit        | Git        | git init; git add -A; git commit -m "..."
    |   commit 3f9c2ab (main)  ->  Author identity unknown *** Please tell me who you are.
 10 | Testes automáticos       | Node.js    | npm test  (node testes\teste-fluxo.js)
    |   Resultado: 25 OK, 0 FALHA(S) -> [FALHA] ... / Resultado: 24 OK, 1 FALHA(S)
 11 | Portas 3000/4000/5000    | PowerShell | Get-NetTCPConnection -LocalPort 3000,4000,5000
    |   todas livres           ->  em uso: 4000
 12 | Iniciar servidores       | Node.js    | npm start  (node src\iniciar.js)
    |   PID 1234; 3 portas responderam -> não responderam após 8 tentativas
 13 | Metadados do provedor    | HTTP       | GET http://localhost:4000/.well-known/oauth-authorization-server
    |   issuer=http://localhost:4000, PKCE S256 -> Não é possível conectar-se ao servidor remoto
 14 | Tela de consentimento    | HTTP       | GET http://localhost:4000/authorize?...
    |   HTTP 200 "Entrar no Provedor OAuth" -> HTTP 302 com error=invalid_request
 15 | Bloqueio redirect_uri    | HTTP       | GET /authorize?redirect_uri=http://site-malicioso.exemplo/callback
    |   HTTP 400 sem redirecionar -> HTTP 302 (provedor aceitou URL não registrada!)
 16 | API exige token          | HTTP       | GET http://localhost:5000/transacoes (sem Authorization)
    |   HTTP 401               ->  HTTP 200 (API não validou o token!)
 17 | Client Credentials       | Node.js    | npm run cc  (node src\client-credentials.js)
    |   resumo 200 e transacoes 403 -> Erro: fetch failed. O laboratório está rodando?
 18 | Abrir navegador (opc.)   | Windows    | Start-Process http://localhost:3000
 19 | Abrir VS Code (opc.)     | Windows    | code <destino>
-------------------------------------------------------------------------------------

ARMADILHAS CONHECIDAS (Windows / PowerShell 5.1) — tratadas neste script
  * Política de execução: npm.ps1 costuma ser bloqueado; por isso chamamos npm.cmd e,
    para testes/servidor, o node diretamente (equivalente a npm test / npm start).
  * Em PS 5.1, saída de erro (stderr) de programas nativos vira ErrorRecord; com
    $ErrorActionPreference='Stop' o git/node "quebrariam" o script mesmo com sucesso.
    Usamos 'Continue' e decidimos pelo $LASTEXITCODE.
  * Codificação: este .ps1 é salvo em UTF-8 COM BOM (o PS 5.1 lê arquivo sem BOM como
    ANSI e estraga acentos). Os arquivos gerados são UTF-8 SEM BOM (BOM no package.json
    quebra ferramentas Node).
  * Here-strings @' ... '@ são literais (não interpretam $ nem crase) e o '@ de
    fechamento precisa estar na coluna 1.
  * Invoke-WebRequest lança exceção para HTTP 4xx no PS 5.1: o status é lido em
    $_.Exception.Response.StatusCode. -UseBasicParsing evita depender do Internet Explorer.
  * Condição de corrida: o servidor leva alguns instantes para abrir as portas; os testes
    HTTP usam novas tentativas com espera crescente (backoff) antes de declarar falha.
  * Node escuta em '::' (IPv4+IPv6); a checagem de porta usa 127.0.0.1 para evitar o
    atraso de resolução de 'localhost' no Windows.
  * O Firewall do Windows pode pedir permissão ao node na 1ª execução: tráfego em
    localhost funciona mesmo se o aluno clicar em Cancelar.
  * "Documentos" pode estar no OneDrive (sincronização bloqueia arquivos): use -Destino.
  * O servidor roda em janela própria; o PID fica em .servidor.pid e é encerrado na
    próxima execução (script idempotente: pode ser rodado várias vezes).
  * curl no PS 5.1 é apelido de Invoke-WebRequest; nas instruções usamos curl.exe.
=====================================================================================
#>
param(
  [string]$Destino = (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'atividade-oauth-api'),
  [switch]$SemServidor
)

$ErrorActionPreference = 'Continue'   # ver armadilhas: decisões por $LASTEXITCODE
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }   # acentos da saída do node
$Utf8SemBom = New-Object System.Text.UTF8Encoding($false)
$Resultados = New-Object System.Collections.ArrayList
$Estado = @{}           # Id do passo -> $true/$false (para dependências)
$script:ProcServidor = $null

# ----------------------------------------------------------------------------------
# Função reutilizável: executa a ação, valida, registra e imprime o passo.
#  - $Acao deve RETORNAR um texto de detalhe em caso de sucesso e LANÇAR (throw) em falha.
#  - $DependeDe: Ids que precisam ter dado OK; senão o passo é PULADO (evita erros em cascata).
# ----------------------------------------------------------------------------------
function Registrar-Passo {
  param(
    [string]$Id, [string]$Nome, [string]$Ambiente, [string]$Comando,
    [string]$ExemploSucesso, [string]$ExemploFalha,
    [scriptblock]$Acao, [string]$Correcao,
    [string[]]$DependeDe = @(), [switch]$Opcional
  )
  $status = 'OK'; $detalhe = ''
  $faltando = @($DependeDe | Where-Object { -not $Estado[$_] })
  if ($faltando.Count) {
    $status = 'PULADO'; $detalhe = 'depende do(s) passo(s) ' + ($faltando -join ', ')
  } else {
    try {
      $detalhe = [string](& $Acao | Select-Object -Last 1)
    } catch {
      $detalhe = $_.Exception.Message
      if ($Opcional) { $status = 'AVISO' } else { $status = 'FALHOU' }
    }
  }
  $Estado[$Id] = ($status -eq 'OK')
  [void]$Resultados.Add([pscustomobject]@{
    Id = $Id; Passo = $Nome; Ambiente = $Ambiente; Comando = $Comando; Status = $status
    Tipo = 'Automático'; Detalhe = $detalhe; Correcao = $(if ($status -eq 'OK') { '' } else { $Correcao })
  })
  $cor = @{ OK = 'Green'; AVISO = 'Yellow'; FALHOU = 'Red'; PULADO = 'DarkYellow' }[$status]
  Write-Host ("[{0,-6}] {1} {2} - {3}" -f $status, $Id, $Nome, $detalhe) -ForegroundColor $cor
  if ($status -ne 'OK') {
    Write-Host ("         esperado : {0}" -f $ExemploSucesso) -ForegroundColor DarkGray
    Write-Host ("         típico   : {0}" -f $ExemploFalha) -ForegroundColor DarkGray
    Write-Host ("         correção : {0}" -f $Correcao) -ForegroundColor DarkGray
  }
}

function Registrar-Manual {
  param([string]$Id, [string]$Nome, [string]$Ambiente, [string]$Comando, [string]$Instrucao)
  [void]$Resultados.Add([pscustomobject]@{
    Id = $Id; Passo = $Nome; Ambiente = $Ambiente; Comando = $Comando; Status = 'MANUAL'
    Tipo = 'Manual (aluno)'; Detalhe = 'não automatizado pelo script'; Correcao = $Instrucao
  })
}

# ---------------------------- auxiliares ------------------------------------------
function Invocar-Nativo {
  # Executa programa externo e devolve código de saída + saída completa (stdout+stderr)
  param([string]$Exe, [string[]]$Argumentos)
  $saida = (& $Exe @Argumentos 2>&1 | Out-String)
  [pscustomobject]@{ Codigo = $LASTEXITCODE; Saida = $saida }
}

function Exigir-Versao {
  param([string]$Exe, [string]$Argumento, [version]$Minimo)
  if (-not (Get-Command $Exe -ErrorAction SilentlyContinue)) { throw "$Exe não encontrado no PATH" }
  $r = Invocar-Nativo $Exe @($Argumento)
  if ($r.Saida -notmatch '(\d+)\.(\d+)(\.(\d+))?') { throw "não foi possível ler a versão: $($r.Saida.Trim())" }
  $patch = 0; if ($Matches[4]) { $patch = $Matches[4] }
  $v = [version]("{0}.{1}.{2}" -f $Matches[1], $Matches[2], $patch)
  if ($v -lt $Minimo) { throw "versão $v é anterior à mínima $Minimo" }
  "versão $v"
}

function Status-Http {
  # Devolve [codigo, conteudo] sem lançar exceção para 4xx/5xx (PS 5.1 lança).
  param([string]$Url)
  try {
    $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5 -MaximumRedirection 0 -ErrorAction Stop
    return @([int]$r.StatusCode, [string]$r.Content)
  } catch {
    $resp = $_.Exception.Response
    if ($resp) { return @([int]$resp.StatusCode, '') }
    throw
  }
}

function Esperar-Http {
  # Retry com backoff exponencial (0,25s, 0,5s, 1s, 2s, 2s...) até a URL responder 200
  param([string]$Url, [int]$Tentativas = 8)
  $espera = 250; $ultimo = ''
  for ($i = 1; $i -le $Tentativas; $i++) {
    try { $r = Status-Http $Url; if ($r[0] -eq 200) { return $i }; $ultimo = "HTTP $($r[0])" }
    catch { $ultimo = $_.Exception.Message }
    Start-Sleep -Milliseconds $espera
    $espera = [Math]::Min($espera * 2, 2000)
  }
  throw "$Url não respondeu após $Tentativas tentativas ($ultimo)"
}

function Porta-EmUso {
  param([int]$Porta)
  $cli = New-Object System.Net.Sockets.TcpClient
  try { $iar = $cli.BeginConnect('127.0.0.1', $Porta, $null, $null); return ($iar.AsyncWaitHandle.WaitOne(400) -and $cli.Connected) }
  catch { return $false } finally { $cli.Close() }
}

Write-Host ""
Write-Host "=== Laboratório OAuth — preparação e execução automática ===" -ForegroundColor Cyan
Write-Host "Destino: $Destino`n"

$reabrir = ' Depois FECHE e reabra o PowerShell e rode o script de novo.'

# ================================ 01–04 Ferramentas =================================
Registrar-Passo -Id '01' -Nome 'Node.js >= 20' -Ambiente 'PowerShell' -Comando 'node -v' `
  -ExemploSucesso 'v22.11.0' -ExemploFalha "node : O termo 'node' não é reconhecido" `
  -Acao { Exigir-Versao 'node' '-v' ([version]'20.0.0') } `
  -Correcao ("winget install OpenJS.NodeJS.LTS (ou https://nodejs.org/pt/download)." + $reabrir)

Registrar-Passo -Id '02' -Nome 'npm >= 10' -Ambiente 'PowerShell' -Comando 'npm.cmd -v' `
  -ExemploSucesso '10.9.0' -ExemploFalha 'npm.cmd não encontrado / versão 8.x' `
  -Acao { Exigir-Versao 'npm.cmd' '-v' ([version]'10.0.0') } `
  -Correcao ("O npm acompanha o Node 20+: reinstale o Node LTS ou rode npm.cmd install -g npm@10." + $reabrir)

Registrar-Passo -Id '03' -Nome 'Git >= 2.40' -Ambiente 'PowerShell' -Comando 'git --version' `
  -ExemploSucesso 'git version 2.47.1.windows.1' -ExemploFalha "git : O termo 'git' não é reconhecido" `
  -Acao { Exigir-Versao 'git' '--version' ([version]'2.40.0') } `
  -Correcao ("winget install Git.Git (ou https://git-scm.com/downloads)." + $reabrir)

Registrar-Passo -Id '04' -Nome 'VS Code >= 1.85 (opcional)' -Ambiente 'PowerShell' -Comando 'code --version' `
  -ExemploSucesso '1.95.3' -ExemploFalha "code : O termo 'code' não é reconhecido" `
  -Acao { Exigir-Versao 'code.cmd' '--version' ([version]'1.85.0') } -Opcional `
  -Correcao "winget install Microsoft.VisualStudioCode (marque 'Add to PATH') e reabra o PowerShell."

# ================================ 05–08 Projeto =====================================
Registrar-Passo -Id '05' -Nome 'Estrutura de pastas' -Ambiente 'PowerShell' -Comando 'New-Item -ItemType Directory ...' `
  -ExemploSucesso '3 subpastas criadas' -ExemploFalha "Acesso ao caminho '...' foi negado" `
  -Acao {
    foreach ($sub in @('', 'src', 'testes', 'docs')) { New-Item -ItemType Directory -Force -Path (Join-Path $Destino $sub) -ErrorAction Stop | Out-Null }
    foreach ($sub in @('src', 'testes', 'docs')) { if (-not (Test-Path (Join-Path $Destino $sub) -PathType Container)) { throw "pasta $sub não foi criada" } }
    "$Destino\{src,testes,docs}"
  } `
  -Correcao "Sem permissão de escrita: rode com outro destino, ex.: -Destino `"$HOME\Desktop\atividade-oauth-api`""

$Arquivos = [ordered]@{}
$Arquivos['package.json'] = @'
{
  "name": "atividade-oauth-api",
  "version": "1.0.0",
  "description": "Laboratório OAuth 2.0 — Authorization Code + PKCE, Refresh Token e Client Credentials (Programação Back-End)",
  "main": "src/iniciar.js",
  "private": true,
  "scripts": {
    "start": "node src/iniciar.js",
    "test": "node testes/teste-fluxo.js",
    "cc": "node src/client-credentials.js"
  },
  "engines": {
    "node": ">=20"
  },
  "license": "UNLICENSED"
}
'@

$Arquivos['.gitignore'] = @'
node_modules/
.env
*.log
.servidor.pid
relatorio-preparacao.csv
'@

$Arquivos['README.md'] = @'
# Laboratório OAuth 2.0 — API Financeira

Atividade de Programação Back-End (2ª série, 4º bimestre, semana 25, aula 1). Sem dependências externas: apenas Node.js 20+.

| Papel OAuth | Arquivo | Porta |
|---|---|---|
| Servidor de Autorização | `src/auth-server.js` | 4000 |
| Servidor de Recursos (API) | `src/api-financeira.js` | 5000 |
| Cliente (App Finanças) | `src/cliente-web.js` | 3000 |

```powershell
npm test      # testes automáticos de segurança
npm start     # sobe os três servidores -> abra http://localhost:3000 (aluno / senha123)
npm run cc    # (outro terminal) demonstração Client Credentials
$env:ACCESS_TTL=20; npm start   # tokens de 20 s para observar a expiração
```

Plano de implementação do grupo: `docs/plano-oauth.md`.
'@

$Arquivos['src\config.js'] = @'
// =============================================================
// config.js — "Registro da aplicação" no provedor OAuth
// Equivale ao que se cadastra no console de um provedor real
// (Google Cloud, Microsoft Entra, Auth0...): client_id, segredo,
// URLs de redirecionamento permitidas, fluxos e escopos.
// =============================================================
const PORTAS = {
  auth: Number(process.env.AUTH_PORT || 4000),      // Servidor de Autorização
  api: Number(process.env.API_PORT || 5000),        // Servidor de Recursos (API financeira)
  cliente: Number(process.env.CLIENT_PORT || 3000), // Aplicação cliente (App Finanças)
};

module.exports = {
  PORTAS,
  EMISSOR: `http://localhost:${PORTAS.auth}`,
  AUDIENCIA_API: 'api-financeira',
  // Em produção: segredo longo, guardado em variável de ambiente/cofre (NUNCA no Git)
  SEGREDO_ASSINATURA: process.env.OAUTH_SEGREDO || 'troque-este-segredo-em-producao',

  // Tempos de vida (segundos) — tokens de acesso curtos, refresh mais longo
  ACCESS_TOKEN_TTL: Number(process.env.ACCESS_TTL || 120), // 2 min (didático; real: 5 a 15 min)
  REFRESH_TOKEN_TTL: Number(process.env.REFRESH_TTL || 1800), // 30 min
  CODE_TTL: 60, // código de autorização: uso único, vale 60 s

  // Escopos = permissões granulares oferecidas pela API
  ESCOPOS: {
    'saldo:read': 'Consultar saldo da conta',
    'transacoes:read': 'Consultar extrato de transações',
    'transacoes:write': 'Criar transferências (operação sensível)',
    'relatorios:read': 'Gerar relatórios consolidados (servidor-servidor)',
  },

  // Aplicações registradas no provedor
  CLIENTES: [
    {
      client_id: 'app-financas-web',
      client_secret: 'segredo-app-web', // cliente confidencial: o segredo fica só no back-end
      nome: 'App Finanças (Web)',
      redirect_uris: [`http://localhost:${PORTAS.cliente}/callback`], // lista exata (sem curingas)
      grant_types: ['authorization_code', 'refresh_token'],
      escopos_permitidos: ['saldo:read', 'transacoes:read', 'transacoes:write'],
    },
    {
      client_id: 'servico-relatorios',
      client_secret: 'segredo-relatorios',
      nome: 'Serviço de Relatórios (back-end)',
      redirect_uris: [], // sem usuário, sem redirecionamento
      grant_types: ['client_credentials'],
      escopos_permitidos: ['relatorios:read'],
    },
  ],

  // Usuário de demonstração (no provedor, nunca no cliente)
  USUARIOS: [{ id: 'u1', login: 'aluno', senha: 'senha123', nome: 'Aluno(a) Demo' }],
};
'@

$Arquivos['src\util.js'] = @'
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
'@

$Arquivos['src\jwt.js'] = @'
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
'@

$Arquivos['src\auth-server.js'] = @'
// =============================================================
// auth-server.js — SERVIDOR DE AUTORIZAÇÃO (porta 4000)
// Implementa: Authorization Code + PKCE, Refresh Token (com
// rotação e detecção de reuso), Client Credentials e revogação.
// =============================================================
const http = require('node:http');
const cfg = require('./config');
const jwt = require('./jwt');
const { lerCorpo, json, html, redirecionar, aleatorio, sha256b64url, iguaisSeguro, esc, pagina } = require('./util');

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

function getAuthorize(res, url) {
  const p = Object.fromEntries(url.searchParams);
  const v = validarPedido(p);
  if (v.fatal) return html(res, 400, paginaErro(v.fatal));
  if (v.erro) return voltarComErro(res, p, v.erro);
  html(res, 200, telaConsentimento(p, v.cliente, v.escopos));
}

async function postAuthorize(req, res) {
  const p = await lerCorpo(req);
  const v = validarPedido(p);
  if (v.fatal) return html(res, 400, paginaErro(v.fatal));
  if (v.erro) return voltarComErro(res, p, v.erro);
  if (p.decisao === 'negar') return voltarComErro(res, p, { error: 'access_denied', error_description: 'O usuário negou o acesso.' });
  const usuario = cfg.USUARIOS.find((u) => u.login === p.login && iguaisSeguro(u.senha, p.senha));
  if (!usuario) return html(res, 401, telaConsentimento(p, v.cliente, v.escopos, 'Usuário ou senha inválidos.'));
  const code = aleatorio(24);
  codigos.set(code, { client_id: p.client_id, redirect_uri: p.redirect_uri, escopos: v.escopos, sub: usuario.id, code_challenge: p.code_challenge, exp: agora() + cfg.CODE_TTL });
  log(`código emitido para ${p.client_id} (usuário ${usuario.login}, escopos: ${v.escopos.join(' ')})`);
  const u = new URL(p.redirect_uri);
  u.searchParams.set('code', code);
  u.searchParams.set('state', p.state);
  redirecionar(res, u.toString());
}

// ---------- /token -----------------------------------------------------
async function postToken(req, res) {
  const corpo = await lerCorpo(req);
  const erroGrant = (d) => json(res, 400, { error: 'invalid_grant', error_description: d });
  const suportados = ['authorization_code', 'refresh_token', 'client_credentials'];
  if (!suportados.includes(corpo.grant_type)) return json(res, 400, { error: 'unsupported_grant_type', error_description: `Use: ${suportados.join(', ')}` });

  const cliente = autenticarCliente(req, corpo);
  if (!cliente) return json(res, 401, { error: 'invalid_client', error_description: 'Falha na autenticação do cliente (client_id/client_secret).' }, { 'WWW-Authenticate': 'Basic realm="oauth"' });
  if (!cliente.grant_types.includes(corpo.grant_type)) return json(res, 400, { error: 'unauthorized_client', error_description: `Cliente não habilitado para ${corpo.grant_type}.` });

  if (corpo.grant_type === 'authorization_code') {
    const d = codigos.get(corpo.code);
    codigos.delete(corpo.code); // uso único — descartado mesmo se a troca falhar
    if (!d || d.exp < agora()) return erroGrant('Código inválido, expirado ou já utilizado.');
    if (d.client_id !== cliente.client_id) return erroGrant('Código emitido para outro cliente.');
    if (d.redirect_uri !== corpo.redirect_uri) return erroGrant('redirect_uri diferente da usada na autorização.');
    if (!corpo.code_verifier || sha256b64url(corpo.code_verifier) !== d.code_challenge) return erroGrant('PKCE: code_verifier não confere com o code_challenge.');
    log(`tokens emitidos (authorization_code) para ${cliente.client_id}`);
    return json(res, 200, emitirTokens(d.sub, cliente.client_id, d.escopos, true));
  }

  if (corpo.grant_type === 'refresh_token') {
    const rt = corpo.refresh_token;
    if (refreshUsados.has(rt)) {
      revogarFamilia(refreshUsados.get(rt));
      log('ALERTA: reuso de refresh token — família revogada');
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
    return json(res, 200, emitirTokens(d.sub, cliente.client_id, d.escopos, true, d.familia));
  }

  // client_credentials: a aplicação age em nome PRÓPRIO (sem usuário, sem refresh)
  const escopos = validarEscopo(cliente, corpo.scope || cliente.escopos_permitidos.join(' '));
  if (!escopos) return json(res, 400, { error: 'invalid_scope', error_description: 'Escopo não permitido para este cliente.' });
  log(`token emitido (client_credentials) para ${cliente.client_id}`);
  return json(res, 200, emitirTokens(cliente.client_id, cliente.client_id, escopos, false));
}

// ---------- /revoke (RFC 7009) -----------------------------------------
async function postRevoke(req, res) {
  const corpo = await lerCorpo(req);
  if (!autenticarCliente(req, corpo)) return json(res, 401, { error: 'invalid_client' });
  const d = refreshTokens.get(corpo.token);
  if (d) revogarFamilia(d.familia);
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
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, cfg.EMISSOR);
    log(req.method, url.pathname);
    try {
      if (req.method === 'GET' && url.pathname === '/authorize') return getAuthorize(res, url);
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
      json(res, 500, { error: 'server_error', error_description: e.message });
    }
  });
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
'@

$Arquivos['src\api-financeira.js'] = @'
// =============================================================
// api-financeira.js — SERVIDOR DE RECURSOS (porta 5000)
// Valida o access token (assinatura, expiração, emissor,
// audiência) e exige o ESCOPO certo para cada rota.
// =============================================================
const http = require('node:http');
const cfg = require('./config');
const jwt = require('./jwt');
const { lerCorpo, json } = require('./util');

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
    json(res, 401, { error: 'invalid_token', error_description: 'Envie o cabeçalho Authorization: Bearer <access_token>.' }, { 'WWW-Authenticate': 'Bearer realm="api-financeira"' });
    return null;
  }
  let claims;
  try {
    claims = jwt.verificar(auth.slice(7), cfg.SEGREDO_ASSINATURA);
  } catch (e) {
    json(res, 401, { error: 'invalid_token', error_description: e.message }, { 'WWW-Authenticate': 'Bearer realm="api-financeira", error="invalid_token"' });
    return null;
  }
  if (claims.iss !== cfg.EMISSOR || claims.aud !== cfg.AUDIENCIA_API) {
    json(res, 401, { error: 'invalid_token', error_description: 'Emissor (iss) ou audiência (aud) inválidos.' }, { 'WWW-Authenticate': 'Bearer error="invalid_token"' });
    return null;
  }
  const escopos = String(claims.scope || '').split(' ');
  if (!escopos.includes(escopoExigido)) {
    json(res, 403, { error: 'insufficient_scope', error_description: `Este recurso exige o escopo "${escopoExigido}".`, escopos_do_token: escopos },
      { 'WWW-Authenticate': `Bearer error="insufficient_scope", scope="${escopoExigido}"` });
    return null;
  }
  return claims;
}

function criarServidor() {
  return http.createServer(async (req, res) => {
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
      json(res, 500, { error: 'server_error' });
    }
  });
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
'@

$Arquivos['src\cliente-web.js'] = @'
// =============================================================
// cliente-web.js — APLICAÇÃO CLIENTE "App Finanças" (porta 3000)
// Cliente confidencial: o back-end guarda client_secret, tokens e
// code_verifier; o navegador recebe apenas um cookie de sessão.
// =============================================================
const http = require('node:http');
const cfg = require('./config');
const jwt = require('./jwt');
const { lerCookies, html, redirecionar, aleatorio, sha256b64url, esc, pagina } = require('./util');

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

async function pedirToken(params) {
  const basic = Buffer.from(`${encodeURIComponent(CLIENTE.client_id)}:${encodeURIComponent(CLIENTE.client_secret)}`).toString('base64');
  const r = await fetch(`${AUTH}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` },
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
    return html(res, 400, pagina('Erro', '<h1>state inválido</h1><p class="erro">Possível ataque CSRF: esta resposta não corresponde a um pedido iniciado nesta sessão.</p><a class="btn" href="/">Voltar</a>'));
  }
  const code = q.get('code');
  s.log.push(`Callback recebeu code=${code.slice(0, 8)}… e o state conferiu.`);
  const r = await pedirToken({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, code_verifier: s.verifier });
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
    headers: { Authorization: `Bearer ${s.tokens.access_token}`, 'Content-Type': 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  s.ultimo = { titulo: `${metodo} ${caminho}`, status: r.status, corpo: await r.json() };
  s.log.push(`Chamou ${metodo} ${caminho} com Authorization: Bearer → HTTP ${r.status}.`);
}

async function renovar(s, refresh, titulo) {
  const r = await pedirToken({ grant_type: 'refresh_token', refresh_token: refresh });
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
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${cfg.PORTAS.cliente}`);
    const s = obterSessao(req, res);
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
        await fetch(`${AUTH}/revoke`, { method: 'POST', headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: s.tokens.refresh_token }) });
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
  });
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
'@

$Arquivos['src\iniciar.js'] = @'
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
'@

$Arquivos['src\client-credentials.js'] = @'
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
'@

$Arquivos['testes\teste-fluxo.js'] = @'
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
'@

$Arquivos['testes\requisicoes.http'] = @'
# Requisições para a extensão REST Client (VS Code) — clique em "Send Request"
# Pré-requisito: "npm start" rodando.

### 1) Metadados do provedor (descoberta)
GET http://localhost:4000/.well-known/oauth-authorization-server

### 2) Client Credentials — token do Serviço de Relatórios
# @name tokenServico
POST http://localhost:4000/token
Authorization: Basic servico-relatorios:segredo-relatorios
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&scope=relatorios:read

### 3) Relatório com o token do serviço (esperado 200)
GET http://localhost:5000/relatorios/resumo
Authorization: Bearer {{tokenServico.response.body.access_token}}

### 4) Recurso de usuário com token do serviço (esperado 403 insufficient_scope)
GET http://localhost:5000/transacoes
Authorization: Bearer {{tokenServico.response.body.access_token}}

### 5) Sem token (esperado 401 invalid_token)
GET http://localhost:5000/saldo

### 6) Segredo errado (esperado 401 invalid_client)
POST http://localhost:4000/token
Authorization: Basic servico-relatorios:segredo-errado
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&scope=relatorios:read
'@

$Arquivos['docs\plano-oauth.md'] = @'
# Plano de implementação de OAuth 2.0 — API Financeira

**Grupo:** _(nomes dos integrantes)_  **Turma:** _____  **Data:** ___/___/______

## 1. Contexto
A API financeira expõe saldo, extrato e transferências. Ela é consumida por (a) um aplicativo web usado por pessoas e (b) um serviço interno de relatórios que roda sem usuário. Objetivo: permitir esse acesso **sem que nenhuma aplicação conheça a senha do usuário**, com permissões mínimas e tokens de vida curta.

## 2. Escolha do fluxo (justificativa)
| Cliente | Fluxo escolhido | Por quê |
|---|---|---|
| App Finanças (web, com back-end) | **Authorization Code + PKCE** | O usuário se autentica só no provedor; o código trafega pelo navegador mas só vale junto com o `code_verifier` (PKCE) e o `client_secret`, que ficam no back-end. É o fluxo recomendado pelas boas práticas atuais (RFC 9700 / OAuth 2.1). |
| SPA ou app mobile (futuro) | **Authorization Code + PKCE** (cliente público, sem segredo) | O **Implicit Flow** foi descontinuado: entrega o token na URL, expondo-o a histórico, logs e scripts. |
| Serviço de Relatórios | **Client Credentials** | Comunicação servidor-servidor: não existe usuário, a aplicação age em nome próprio. Não recebe refresh token. |

## 3. Configuração
1. **Registro da aplicação** no provedor (no laboratório: `src/config.js`): `client_id`, `client_secret` (guardado em variável de ambiente/cofre, nunca no Git), tipo de cliente e fluxos permitidos (`grant_types`).
2. **URLs de redirecionamento**: lista exata, sempre HTTPS em produção (`https://app.exemplo.com.br/callback`), sem curingas. O provedor recusa qualquer outra — no lab, `http://site-malicioso.exemplo/callback` é bloqueada.
3. **Escopos** (menor privilégio):

| Escopo | Permite | Quem recebe |
|---|---|---|
| `saldo:read` | Consultar saldo | App Finanças |
| `transacoes:read` | Consultar extrato | App Finanças |
| `transacoes:write` | Transferências | Somente com consentimento explícito e, idealmente, autenticação forte (MFA) |
| `relatorios:read` | Relatório consolidado | Serviço de Relatórios |

4. **Proteções do pedido**: `state` aleatório por pedido (anti-CSRF), PKCE `S256` obrigatório, código de autorização de **uso único** com validade de 60 s.
5. **Validação na API**: assinatura do JWT, `exp`, `iss`, `aud` e escopo por rota — 401 para token inválido/expirado, 403 para escopo insuficiente.

## 4. Gestão de tokens
| Token | Formato | Validade | Onde fica |
|---|---|---|---|
| Access token | JWT assinado | 5–15 min (lab: 2 min) | Memória do back-end do cliente |
| Refresh token | Opaco (aleatório) | 30 min a alguns dias, conforme risco | Back-end do cliente (nunca em localStorage) |
| Código de autorização | Opaco | 60 s, uso único | Trafega uma vez pelo navegador |

**Exemplo prático:** às 10h00 o usuário autoriza o app e recebe access (expira 10h05) + refresh. Às 10h06 a API responde 401 → o back-end usa o refresh e recebe um **novo par** (rotação); o refresh antigo é invalidado. Se alguém reutilizar o refresh antigo, o provedor detecta o **reuso** e revoga toda a família de tokens, forçando novo login. No logout, o app chama `/revoke`.

## 5. Comunicação com a equipe
- Resumo de uma página + diagrama de sequência do fluxo; decisão registrada (ADR) no repositório.
- Checklist obrigatório em code review (PKCE, `state`, redirect exato, escopos mínimos, segredos fora do código, validação `iss/aud/exp`).
- Testes automatizados de segurança no CI (`npm test`) — o pipeline falha se uma regra for quebrada.
- Demonstração ao vivo no laboratório e canal único de dúvidas; revisão do plano a cada mudança de escopo.

## 6. Evidências do laboratório
- [ ] Print do `npm test` com 25 OK
- [ ] Print do consentimento no provedor e das claims do token
- [ ] Print do 403 (escopo) e do erro de redirect_uri
- [ ] Print da renovação e da detecção de reuso
- [ ] Saída do `npm run cc`

## Referências
- SEDUC-SP. *Descomplicando o OAuth: autorização segura para APIs* — Programação Back-End, 2ª série, 4º bimestre, semana 25, aula 1.
- [RFC 6749 — The OAuth 2.0 Authorization Framework](https://www.rfc-editor.org/rfc/rfc6749)
- [RFC 7636 — PKCE](https://www.rfc-editor.org/rfc/rfc7636)
- [RFC 9700 — Best Current Practice for OAuth 2.0 Security](https://www.rfc-editor.org/rfc/rfc9700)
'@


Registrar-Passo -Id '06' -Nome 'Gravar arquivos do exercício' -Ambiente 'PowerShell' -Comando '[IO.File]::WriteAllText (UTF-8 sem BOM)' `
  -ExemploSucesso "$($Arquivos.Count) de $($Arquivos.Count) arquivos" -ExemploFalha 'O processo não pode acessar o arquivo ... sendo usado por outro processo' `
  -DependeDe @('05') `
  -Acao {
    $bytes = 0
    foreach ($rel in $Arquivos.Keys) {
      $alvo = Join-Path $Destino $rel
      [System.IO.File]::WriteAllText($alvo, ($Arquivos[$rel] + "`r`n"), $Utf8SemBom)
      $info = Get-Item -LiteralPath $alvo -Force -ErrorAction Stop          # valida: existe e não está vazio
      if ($info.Length -lt 10) { throw "$rel ficou vazio" }
      $bytes += $info.Length
    }
    "$($Arquivos.Count) de $($Arquivos.Count) arquivos ($([Math]::Round($bytes/1KB)) KB)"
  } `
  -Correcao 'Feche o arquivo em outros programas, pause a sincronização do OneDrive ou use -Destino em outra pasta.'

Push-Location $Destino -ErrorAction SilentlyContinue

Registrar-Passo -Id '07' -Nome 'Sintaxe JavaScript' -Ambiente 'Node.js' -Comando 'node --check src\*.js testes\*.js' `
  -ExemploSucesso '9 arquivos sem erro' -ExemploFalha 'SyntaxError: Unexpected end of input' `
  -DependeDe @('01', '06') `
  -Acao {
    $js = @(Get-ChildItem -Path 'src', 'testes' -Filter '*.js' -File)
    foreach ($f in $js) {
      $r = Invocar-Nativo 'node' @('--check', $f.FullName)
      if ($r.Codigo -ne 0) { throw "$($f.Name): $(($r.Saida -split "`r?`n" | Where-Object { $_ -match 'Error' } | Select-Object -First 1))" }
    }
    "$($js.Count) arquivos sem erro"
  } `
  -Correcao 'O arquivo indicado foi alterado; rode o script de novo para regravá-lo ou compare com o código da página.'

Registrar-Passo -Id '08' -Nome 'package.json válido' -Ambiente 'PowerShell' -Comando 'Get-Content package.json | ConvertFrom-Json' `
  -ExemploSucesso 'scripts: start, test, cc' -ExemploFalha 'ConvertFrom-Json : Primitivo JSON inválido' `
  -DependeDe @('06') `
  -Acao {
    $pkg = Get-Content 'package.json' -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($s in 'start', 'test', 'cc') { if (-not $pkg.scripts.$s) { throw "script '$s' ausente" } }
    'scripts: start, test, cc'
  } `
  -Correcao 'Regrave o package.json (rode o script novamente) — uma vírgula ou chave a mais invalida o JSON.'

# ================================ 09 Git ============================================
Registrar-Passo -Id '09' -Nome 'Repositório Git e commit' -Ambiente 'Git' -Comando 'git init; git add -A; git commit -m "feat: laboratorio OAuth"' `
  -ExemploSucesso 'commit 3f9c2ab na branch main' -ExemploFalha 'Author identity unknown *** Please tell me who you are.' `
  -DependeDe @('03', '06') `
  -Acao {
    if (-not (Test-Path '.git')) {
      $r = Invocar-Nativo 'git' @('init', '-q'); if ($r.Codigo) { throw $r.Saida }
      [void](Invocar-Nativo 'git' @('symbolic-ref', 'HEAD', 'refs/heads/main'))   # main mesmo em Git com padrão "master"
    }
    $aviso = ''
    if (-not (Invocar-Nativo 'git' @('config', 'user.name')).Saida.Trim()) {
      # Sem identidade o commit falha; usamos identidade LOCAL provisória (não altera a global)
      [void](Invocar-Nativo 'git' @('config', 'user.name', 'Grupo Lab OAuth'))
      [void](Invocar-Nativo 'git' @('config', 'user.email', 'grupo.lab@exemplo.local'))
      $aviso = ' (identidade provisória: ajuste com git config user.name/user.email)'
    }
    [void](Invocar-Nativo 'git' @('add', '-A'))
    if ((Invocar-Nativo 'git' @('status', '--porcelain')).Saida.Trim()) {
      $r = Invocar-Nativo 'git' @('commit', '-q', '-m', 'feat: laboratorio OAuth (auth code + PKCE, refresh e client credentials)')
      if ($r.Codigo) { throw $r.Saida.Trim() }
    }
    $h = (Invocar-Nativo 'git' @('log', '-1', '--format=%h')).Saida.Trim()   # valida: existe commit
    if (-not $h) { throw 'nenhum commit encontrado após git commit' }
    "commit $h na branch main$aviso"
  } `
  -Correcao 'git config --global user.name "Seu Nome"; git config --global user.email "seu@email"; depois git add . ; git commit -m "feat: laboratorio OAuth"'

# ================================ 10 Testes =========================================
Registrar-Passo -Id '10' -Nome 'Testes automáticos (25 regras)' -Ambiente 'Node.js' -Comando 'npm test' `
  -ExemploSucesso 'Resultado: 25 OK, 0 FALHA(S)' -ExemploFalha '[FALHA] ... -> Resultado: 24 OK, 1 FALHA(S)' `
  -DependeDe @('01', '07') `
  -Acao {
    $r = Invocar-Nativo 'node' @('testes\teste-fluxo.js')   # = npm test, sem depender do npm.ps1
    $linhaRes = ($r.Saida -split "`r?`n" | Where-Object { $_ -match 'Resultado:' } | Select-Object -Last 1)
    if ($r.Codigo -ne 0 -or $linhaRes -notmatch ', 0 FALHA') {
      $f = ($r.Saida -split "`r?`n" | Where-Object { $_ -match 'FALHA\]|Erro|EADDRINUSE' }) -join ' | '
      throw "código $($r.Codigo): $f"
    }
    $linhaRes.Trim()
  } `
  -Correcao 'Leia a linha [FALHA] (regra quebrada). Se for EADDRINUSE, libere as portas 13000/14000/15000. Depois: npm test'

# ================================ 11–17 Servidor e validação HTTP ===================
$pidArq = Join-Path $Destino '.servidor.pid'
if ($SemServidor) {
  foreach ($id in '11', '12', '13', '14', '15', '16', '17') { $Estado[$id] = $false }
  [void]$Resultados.Add([pscustomobject]@{ Id = '11-17'; Passo = 'Servidor e validações HTTP'; Ambiente = 'Node.js/HTTP'; Comando = 'npm start'
    Status = 'PULADO'; Tipo = 'Automático'; Detalhe = 'pulado a pedido (-SemServidor)'; Correcao = 'Para executar: npm start  e, em outro terminal, npm run cc' })
  Write-Host '[PULADO] 11-17 Servidor e validações HTTP - opção -SemServidor' -ForegroundColor DarkYellow
} else {
  Registrar-Passo -Id '11' -Nome 'Portas 3000/4000/5000 livres' -Ambiente 'PowerShell' -Comando 'Get-NetTCPConnection -LocalPort 3000,4000,5000' `
    -ExemploSucesso 'todas livres' -ExemploFalha 'em uso: 4000' -DependeDe @('01') `
    -Acao {
      if (Test-Path $pidArq) {   # encerra o servidor deixado por uma execução anterior deste script
        $antigo = Get-Content $pidArq -ErrorAction SilentlyContinue
        if ($antigo) { Stop-Process -Id $antigo -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 800 }
        Remove-Item $pidArq -ErrorAction SilentlyContinue
      }
      $ocupadas = @(3000, 4000, 5000 | Where-Object { Porta-EmUso $_ })
      if ($ocupadas.Count) { throw ('em uso: ' + ($ocupadas -join ', ')) }
      'todas livres'
    } `
    -Correcao 'Get-NetTCPConnection -LocalPort 3000,4000,5000 | Select LocalPort,OwningProcess ; Stop-Process -Id <PID> ; rode o script de novo.'

  Registrar-Passo -Id '12' -Nome 'Iniciar servidores (preview local)' -Ambiente 'Node.js' -Comando 'npm start' `
    -ExemploSucesso 'PID 1234; 3 portas responderam' -ExemploFalha 'não respondeu após 8 tentativas' -DependeDe @('01', '07', '11') `
    -Acao {
      # Janela própria: o aluno vê os logs [auth]/[api]/[cliente]; o script continua sem esperar
      $script:ProcServidor = Start-Process -FilePath 'node' -ArgumentList 'src\iniciar.js' -WorkingDirectory $Destino -PassThru -ErrorAction Stop
      Set-Content -Path $pidArq -Value $script:ProcServidor.Id
      $t = 0
      foreach ($u in 'http://127.0.0.1:4000/', 'http://127.0.0.1:5000/', 'http://127.0.0.1:3000/') { $t += Esperar-Http $u }
      if ($script:ProcServidor.HasExited) { throw "o processo node encerrou (código $($script:ProcServidor.ExitCode))" }
      "PID $($script:ProcServidor.Id); 3 portas responderam ($t tentativas)"
    } `
    -Correcao 'Veja a mensagem na janela do Node ou rode manualmente na pasta: npm start'

  Registrar-Passo -Id '13' -Nome 'Metadados do provedor' -Ambiente 'HTTP' -Comando 'GET :4000/.well-known/oauth-authorization-server' `
    -ExemploSucesso 'issuer=http://localhost:4000, PKCE S256' -ExemploFalha 'Não é possível conectar-se ao servidor remoto' -DependeDe @('12') `
    -Acao {
      $m = Invoke-RestMethod -Uri 'http://127.0.0.1:4000/.well-known/oauth-authorization-server' -TimeoutSec 5 -ErrorAction Stop
      if ($m.issuer -ne 'http://localhost:4000') { throw "issuer inesperado: $($m.issuer)" }
      if ($m.code_challenge_methods_supported -notcontains 'S256') { throw 'PKCE S256 não anunciado' }
      "issuer=$($m.issuer), PKCE S256, grants: $($m.grant_types_supported -join ',')"
    } -Correcao 'Confira src\auth-server.js (função metadados) e se o servidor está rodando.'

  Registrar-Passo -Id '14' -Nome 'Tela de login/consentimento' -Ambiente 'HTTP' -Comando 'GET :4000/authorize?response_type=code&...' `
    -ExemploSucesso 'HTTP 200 "Entrar no Provedor OAuth"' -ExemploFalha 'HTTP 302 com error=invalid_request' -DependeDe @('12') `
    -Acao {
      $q = 'response_type=code&client_id=app-financas-web&redirect_uri=' + [uri]::EscapeDataString('http://localhost:3000/callback') +
           '&scope=' + [uri]::EscapeDataString('saldo:read transacoes:read') + '&state=teste&code_challenge=desafio&code_challenge_method=S256'
      $r = Status-Http "http://127.0.0.1:4000/authorize?$q"
      if ($r[0] -ne 200 -or $r[1] -notmatch 'Entrar no Provedor OAuth') { throw "HTTP $($r[0]) sem a tela de consentimento" }
      'HTTP 200 com formulário de login e escopos'
    } -Correcao 'Confira redirect_uris e escopos do cliente em src\config.js.'

  Registrar-Passo -Id '15' -Nome 'Bloqueio de redirect_uri' -Ambiente 'HTTP' -Comando 'GET :4000/authorize?redirect_uri=http://site-malicioso.exemplo/callback' `
    -ExemploSucesso 'HTTP 400 sem redirecionar' -ExemploFalha 'HTTP 302 (aceitou URL não registrada!)' -DependeDe @('12') `
    -Acao {
      $q = 'response_type=code&client_id=app-financas-web&redirect_uri=' + [uri]::EscapeDataString('http://site-malicioso.exemplo/callback') + '&scope=saldo:read&state=x&code_challenge=d&code_challenge_method=S256'
      $r = Status-Http "http://127.0.0.1:4000/authorize?$q"
      if ($r[0] -ne 400) { throw "esperado 400, recebido HTTP $($r[0])" }
      'HTTP 400 — provedor recusou a URL não registrada'
    } -Correcao 'A validação de redirect_uri em src\auth-server.js (validarPedido) foi alterada.'

  Registrar-Passo -Id '16' -Nome 'API exige token' -Ambiente 'HTTP' -Comando 'curl.exe -i http://localhost:5000/transacoes' `
    -ExemploSucesso 'HTTP 401' -ExemploFalha 'HTTP 200 (API não validou o token!)' -DependeDe @('12') `
    -Acao {
      $r = Status-Http 'http://127.0.0.1:5000/transacoes'
      if ($r[0] -ne 401) { throw "esperado 401, recebido HTTP $($r[0])" }
      'HTTP 401 sem Authorization: Bearer'
    } -Correcao 'A função autorizar() de src\api-financeira.js foi alterada.'

  Registrar-Passo -Id '17' -Nome 'Client Credentials Flow' -Ambiente 'Node.js' -Comando 'npm run cc' `
    -ExemploSucesso 'resumo HTTP 200; transacoes HTTP 403' -ExemploFalha 'Erro: fetch failed. O laboratório está rodando?' -DependeDe @('12') `
    -Acao {
      $r = Invocar-Nativo 'node' @('src\client-credentials.js')
      if ($r.Codigo -ne 0) { throw $r.Saida.Trim() }
      if ($r.Saida -notmatch 'relatorios/resumo -> HTTP 200' -or $r.Saida -notmatch 'transacoes -> HTTP 403') { throw 'respostas diferentes de 200/403' }
      'token sem usuário; resumo HTTP 200; /transacoes HTTP 403'
    } -Correcao 'Com npm start rodando, execute npm run cc e compare a saída com o passo 16 do roteiro.'

  Registrar-Passo -Id '18' -Nome 'Abrir navegador (opcional)' -Ambiente 'Windows' -Comando 'Start-Process http://localhost:3000' `
    -ExemploSucesso 'navegador aberto' -ExemploFalha 'nenhum navegador padrão definido' -DependeDe @('12') -Opcional `
    -Acao { Start-Process 'http://localhost:3000' -ErrorAction Stop; 'http://localhost:3000 (login: aluno / senha123)' } `
    -Correcao 'Abra manualmente http://localhost:3000'
}

Registrar-Passo -Id '19' -Nome 'Abrir projeto no VS Code (opcional)' -Ambiente 'Windows' -Comando "code `"$Destino`"" `
  -ExemploSucesso 'VS Code aberto' -ExemploFalha 'code.cmd não encontrado' -DependeDe @('04', '06') -Opcional `
  -Acao { Start-Process -FilePath 'code.cmd' -ArgumentList "`"$Destino`"" -WindowStyle Hidden -ErrorAction Stop; $Destino } `
  -Correcao "Abra o VS Code e use Arquivo > Abrir Pasta > $Destino"

Pop-Location -ErrorAction SilentlyContinue

# ================================ Passos MANUAIS (fora do script) ====================
Registrar-Manual 'M1' 'Authorization Code + PKCE no navegador (roteiro passo 13)' 'Navegador' 'http://localhost:3000 -> Entrar -> aluno/senha123 -> Permitir' 'Executar o fluxo, consultar /saldo e /transacoes e salvar print das claims.'
Registrar-Manual 'M2' 'Regras de segurança com evidências (passo 14)' 'Navegador + PowerShell' 'POST /transferencias; redirect inválida; Negar; curl.exe -i :5000/transacoes' 'Salvar prints do 403, da redirect_uri recusada e do 401.'
Registrar-Manual 'M3' 'Expiração, renovação e reuso (passo 15)' 'PowerShell + Navegador' '$env:ACCESS_TTL=20; npm start' 'Encerrar o servidor atual (Stop-Process -Id <PID do .servidor.pid>) antes de reiniciar com TTL de 20 s.'
Registrar-Manual 'M4' 'Redigir o plano de implementação (passo 17)' 'VS Code' 'docs\plano-oauth.md' 'Preencher as 6 seções com as palavras do grupo e anexar as evidências.'
Registrar-Manual 'M5' 'Commit do plano e entrega (passo 18)' 'Git' 'git add docs; git commit -m "docs: plano..."' 'Responder às 4 perguntas e entregar conforme orientação do professor.'
Registrar-Manual 'M6' 'Publicar em repositório remoto (se a turma usar)' 'Git + GitHub' 'git remote add origin <URL>; git push -u origin main' 'Criar o repositório e fazer login no GitHub manualmente — o script não faz login nem push.'

# ================================ Relatório final ===================================
$cont = @{}; foreach ($s in 'OK', 'FALHOU', 'AVISO', 'PULADO', 'MANUAL') { $cont[$s] = @($Resultados | Where-Object { $_.Status -eq $s }).Count }
Write-Host ""
Write-Host "================================ RELATÓRIO FINAL ================================" -ForegroundColor Cyan
$Resultados | Format-Table -AutoSize -Wrap Id, Passo, Ambiente, Comando, Status | Out-String -Width 200 | Write-Host
Write-Host ("Sucesso: {0}   Falhas: {1}   Avisos (opcionais): {2}   Pulados: {3}   Manuais: {4}" -f $cont.OK, $cont.FALHOU, $cont.AVISO, $cont.PULADO, $cont.MANUAL)

$pendentes = @($Resultados | Where-Object { $_.Status -in 'FALHOU', 'AVISO', 'PULADO' })
if ($pendentes.Count) {
  Write-Host "`nO QUE FALTA CONFIGURAR / COMO CORRIGIR:" -ForegroundColor Yellow
  foreach ($p in $pendentes) { Write-Host (" - [{0}] {1} {2}: {3}" -f $p.Status, $p.Id, $p.Passo, $p.Correcao) -ForegroundColor Yellow }
}
Write-Host "`nPRÓXIMOS PASSOS MANUAIS (aluno):" -ForegroundColor Cyan
foreach ($m in @($Resultados | Where-Object { $_.Status -eq 'MANUAL' })) { Write-Host (" - {0} {1}: {2}" -f $m.Id, $m.Passo, $m.Correcao) }

# CSV: ';' abre em colunas no Excel pt-BR; -Encoding UTF8 no PS 5.1 grava com BOM (acentos OK no Excel)
$pastaCsv = $Destino; if (-not (Test-Path $pastaCsv)) { $pastaCsv = (Get-Location).Path }
$csv = Join-Path $pastaCsv 'relatorio-preparacao.csv'
try {
  $Resultados | Select-Object Id, Passo, Tipo, Ambiente, Comando, Status, Detalhe, Correcao |
    Export-Csv -Path $csv -NoTypeInformation -Delimiter ';' -Encoding UTF8 -ErrorAction Stop
  Write-Host "`nRelatório salvo em $csv" -ForegroundColor Cyan
} catch { Write-Host "Não foi possível salvar o CSV: $($_.Exception.Message)" -ForegroundColor Yellow }

if ($script:ProcServidor -and -not $script:ProcServidor.HasExited) {
  Write-Host ("Servidores rodando (PID {0}). Para encerrar: Stop-Process -Id {0}  (ou feche a janela do Node)" -f $script:ProcServidor.Id)
}
exit $cont.FALHOU
