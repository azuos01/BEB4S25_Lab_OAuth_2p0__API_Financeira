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

  // ===========================================================
  // AUDITORIA E LOGS (Laboratório 2 — aula 3)
  // ===========================================================
  AUDITORIA: {
    LOG_DIR: process.env.LOG_DIR || require('node:path').join(__dirname, '..', 'logs'),
    // Rotação: ao passar deste tamanho o arquivo é renomeado (auditoria-<data>-NNN.log)
    LOG_MAX_BYTES: Number(process.env.LOG_MAX_BYTES || 256 * 1024), // 256 KB (didático)
    // Retenção: mantém no máximo N arquivos rotacionados e apaga os mais antigos que X dias
    LOG_RETENCAO_ARQUIVOS: Number(process.env.LOG_RETENCAO_ARQUIVOS || 5),
    LOG_RETENCAO_DIAS: Number(process.env.LOG_RETENCAO_DIAS || 30),
    // Integridade: cada linha leva um HMAC encadeado com a anterior (detecta edição/remoção)
    CHAVE_INTEGRIDADE: process.env.LOG_CHAVE_INTEGRIDADE || 'chave-integridade-de-laboratorio',
    // Confidencialidade: dados sensíveis (ex.: login digitado errado) vão cifrados com AES-256-GCM
    CHAVE_CIFRA: process.env.LOG_CHAVE_CIFRA || 'chave-cifra-de-laboratorio',
    // Detecção de força bruta: N falhas de autenticação do mesmo IP em J segundos => alerta + bloqueio
    EVENTOS_FALHA_AUTH: ['LOGIN_FALHA', 'CLIENTE_AUTH_FALHA'],
    LIMITE_FALHAS: Number(process.env.LIMITE_FALHAS || 5),
    JANELA_S: Number(process.env.JANELA_S || 60),
    BLOQUEIO_S: Number(process.env.BLOQUEIO_S || 300),
    // X-Forwarded-For só é confiável atrás de um proxy reverso SEU. No laboratório fica ligado
    // para simular IPs diferentes; em produção, desligue se a API estiver exposta diretamente.
    CONFIAR_PROXY: process.env.CONFIAR_PROXY !== '0',
    // Opcional: URL de webhook (ex.: Slack/Teams) que recebe os alertas críticos
    ALERTA_WEBHOOK: process.env.ALERTA_WEBHOOK || '',
  },

  // Usuário de demonstração (no provedor, nunca no cliente)
  USUARIOS: [{ id: 'u1', login: 'aluno', senha: 'senha123', nome: 'Aluno(a) Demo' }],
};
