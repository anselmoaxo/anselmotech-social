// Integração com o Instagram via Composio.
// Só as ferramentas listadas em ALLOWED_TOOLS podem ser chamadas — todas foram
// encontradas e verificadas no catálogo do Composio para a conta conectada.
// Nenhum token/chave sai deste módulo: respostas e logs são sanitizados.
import { Composio } from '@composio/core';

const API_KEY = process.env.COMPOSIO_API_KEY || '';
const USER_ID = process.env.COMPOSIO_USER_ID || '';
const FIXED_ACCOUNT_ID = process.env.COMPOSIO_INSTAGRAM_ACCOUNT_ID || '';
const TOOLKIT_VERSION = process.env.COMPOSIO_INSTAGRAM_VERSION || '';

// Leitura: podem ser chamadas livremente pelo app.
export const READ_TOOLS = new Set([
  'INSTAGRAM_GET_USER_INFO',
  'INSTAGRAM_GET_USER_INSIGHTS',
  'INSTAGRAM_GET_IG_USER_MEDIA',
  'INSTAGRAM_GET_IG_MEDIA',
  'INSTAGRAM_GET_IG_MEDIA_INSIGHTS',
  'INSTAGRAM_GET_IG_MEDIA_COMMENTS',
  'INSTAGRAM_GET_IG_USER_CONTENT_PUBLISHING_LIMIT',
  'INSTAGRAM_GET_POST_STATUS', // marcada como "deprecated" no Composio, mas é a única que lê contêiner não publicado
]);

// Escrita: só podem ser chamadas pelo fluxo de confirmação explícita (server/publish.js).
export const WRITE_TOOLS = new Set([
  'INSTAGRAM_POST_IG_USER_MEDIA',
  'INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH',
  'INSTAGRAM_CREATE_CAROUSEL_CONTAINER',
]);

// Catálogo exibido na tela "Integração" (o que existe x o que o app usa).
export const CAPABILITIES = [
  { slug: 'INSTAGRAM_GET_USER_INFO', kind: 'leitura', used: true, label: 'Perfil da conta (nome, foto, seguidores, nº de posts)' },
  { slug: 'INSTAGRAM_GET_USER_INSIGHTS', kind: 'leitura', used: true, label: 'Métricas da conta (alcance, visualizações, engajamento, visitas ao perfil)' },
  { slug: 'INSTAGRAM_GET_IG_USER_MEDIA', kind: 'leitura', used: true, label: 'Lista de publicações (também usada para conferir se um post já saiu)' },
  { slug: 'INSTAGRAM_GET_IG_MEDIA', kind: 'leitura', used: true, label: 'Detalhes de uma publicação (link permanente)' },
  { slug: 'INSTAGRAM_GET_IG_MEDIA_INSIGHTS', kind: 'leitura', used: true, label: 'Métricas por publicação (views, alcance, salvos, compartilhamentos…)' },
  { slug: 'INSTAGRAM_GET_IG_MEDIA_COMMENTS', kind: 'leitura', used: true, label: 'Comentários de uma publicação' },
  { slug: 'INSTAGRAM_GET_IG_USER_CONTENT_PUBLISHING_LIMIT', kind: 'leitura', used: true, label: 'Cota de publicação (24h)' },
  { slug: 'INSTAGRAM_GET_POST_STATUS', kind: 'leitura', used: true, label: 'Status do contêiner (IN_PROGRESS, FINISHED, ERROR, EXPIRED, PUBLISHED) — marcada como obsoleta pelo Composio' },
  { slug: 'INSTAGRAM_POST_IG_USER_MEDIA', kind: 'escrita', used: true, confirm: true, label: 'Criar contêiner: imagem (feed), REELS (vídeo) ou STORIES' },
  { slug: 'INSTAGRAM_CREATE_CAROUSEL_CONTAINER', kind: 'escrita', used: true, confirm: true, label: 'Criar contêiner de carrossel (2 a 10 imagens/vídeos)' },
  { slug: 'INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH', kind: 'escrita', used: true, confirm: true, label: 'Publicar um contêiner pronto' },
  { slug: 'INSTAGRAM_POST_IG_COMMENT_REPLIES', kind: 'escrita', used: false, label: 'Responder comentário (existe, não usado pelo app)' },
  { slug: 'INSTAGRAM_DELETE_COMMENT', kind: 'escrita', used: false, label: 'Excluir comentário (existe, não usado pelo app)' },
  { slug: 'INSTAGRAM_SEND_TEXT_MESSAGE', kind: 'escrita', used: false, label: 'Enviar DM em conversa existente (existe, não usado pelo app)' },
];

export const NOT_AVAILABLE = [
  'Agendamento nativo do Instagram: não existe ferramenta para isso. O agendamento é feito pelo servidor deste app (fila persistente), que precisa estar ligado no horário.',
  'Editar legenda ou excluir uma publicação já feita (não existe ferramenta para isso).',
  'Enviar arquivo direto do computador: a publicação exige URL pública (JPEG para imagem, MP4/MOV para vídeo). O app pode subir o arquivo no seu Supabase Storage, se configurado.',
  'Seguidores por dia (follower_count): a Meta só fornece com 100+ seguidores.',
  'Formatos aceitos pelas ferramentas: imagem no feed, Reels, Stories e carrossel. A aceitação na SUA conta só é confirmada criando um contêiner ("Testar formato") ou na primeira publicação.',
];

let client = null;
let cachedAccount = null; // { id, at }

export function isConfigured() {
  return Boolean(API_KEY && USER_ID);
}

function getClient() {
  if (!client) {
    client = new Composio({
      apiKey: API_KEY,
      allowTracking: false,
      ...(TOOLKIT_VERSION ? { toolkitVersions: { instagram: TOOLKIT_VERSION } } : {}),
    });
  }
  return client;
}

export class IntegrationError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// Remove qualquer coisa parecida com credencial antes de mostrar/logar.
export function sanitize(text) {
  return String(text || '')
    .replace(/(access_token|token|api[_-]?key|authorization|secret)(["'=:\s]+)[^\s"'&,}]+/gi, '$1$2[oculto]')
    .replace(/\b(EAA|IGQ|IGAA)[A-Za-z0-9_-]{10,}/g, '[oculto]')
    .replace(/\bak_[A-Za-z0-9_-]{8,}/g, '[oculto]')
    .slice(0, 600);
}

function friendlyError(raw) {
  const msg = sanitize(raw);
  const low = msg.toLowerCase();
  if (/2207\d{3}|media could not be fetched|aspect ratio|unsupported|invalid (image|video)|only photo or video|media type|file format|duration|resolution/i.test(msg))
    return new IntegrationError('formato_arquivo', `O Instagram recusou a mídia ou o formato. Verifique tipo de arquivo, proporção, tamanho e se a URL é pública. Detalhe: ${msg}`, 422);
  if (low.includes('permission') || low.includes('(#10)') || low.includes('(#200)') || low.includes('not authorized'))
    return new IntegrationError('sem_permissao', `A conexão do Instagram não tem permissão para esta ação. Detalhe: ${msg}`, 403);
  if (low.includes('expired') || low.includes('session has been invalidated') || low.includes('oauth'))
    return new IntegrationError('conexao_expirada', `A conexão do Instagram parece expirada. Reconecte no painel do Composio. Detalhe: ${msg}`, 401);
  if (low.includes('rate') || low.includes('(#4)') || low.includes('(#613)') || low.includes('limit'))
    return new IntegrationError('limite', `Limite de uso da API atingido. Tente de novo em alguns minutos. Detalhe: ${msg}`, 429);
  return new IntegrationError('falha_integracao', `O Composio/Instagram retornou um erro: ${msg}`);
}

async function resolveAccountId() {
  if (FIXED_ACCOUNT_ID) return FIXED_ACCOUNT_ID;
  if (cachedAccount && Date.now() - cachedAccount.at < 10 * 60 * 1000) return cachedAccount.id;
  const list = await getClient().connectedAccounts.list({
    userIds: [USER_ID],
    toolkitSlugs: ['instagram'],
    statuses: ['ACTIVE'],
  });
  const acc = list?.items?.[0];
  if (!acc) {
    throw new IntegrationError(
      'sem_conexao',
      'Nenhuma conta do Instagram ATIVA foi encontrada para esse COMPOSIO_USER_ID. Conecte o Instagram no painel do Composio (mesmo projeto da chave) e tente de novo.',
      404,
    );
  }
  cachedAccount = { id: acc.id, at: Date.now() };
  return acc.id;
}

let cachedIgUserId = null;
/** ID numérico da conta Business (necessário para criar contêineres). */
export async function igUserId() {
  if (cachedIgUserId) return cachedIgUserId;
  const info = await read('INSTAGRAM_GET_USER_INFO', { ig_user_id: 'me', fields: 'id,user_id,username' });
  cachedIgUserId = info?.user_id || info?.id;
  if (!cachedIgUserId) throw new IntegrationError('sem_conta', 'Não foi possível obter o ID da conta do Instagram.');
  return cachedIgUserId;
}

/** Marca erros cujo resultado é incerto (timeout/rede): a ação pode ter acontecido. */
function isUncertain(err) {
  const n = `${err?.name || ''} ${err?.message || ''}`.toLowerCase();
  return n.includes('abort') || n.includes('timeout') || n.includes('fetch failed') || n.includes('econnreset') || n.includes('socket');
}

async function execute(slug, args) {
  if (!isConfigured()) {
    throw new IntegrationError('nao_configurado', 'Composio não configurado: defina COMPOSIO_API_KEY e COMPOSIO_USER_ID no arquivo .env.', 503);
  }
  let res;
  try {
    const connectedAccountId = await resolveAccountId();
    res = await getClient().tools.execute(
      slug,
      {
        userId: USER_ID,
        connectedAccountId,
        arguments: args,
        ...(TOOLKIT_VERSION ? {} : { dangerouslySkipVersionCheck: true }),
      },
      { signal: AbortSignal.timeout(slug === 'INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH' ? 330_000 : 45_000) },
    );
  } catch (err) {
    if (err instanceof IntegrationError) throw err;
    console.warn(`[composio] ${slug} -> exceção (${err?.name || 'Error'})`);
    const e = friendlyError(err?.message || err);
    if (isUncertain(err)) { e.uncertain = true; e.code = 'resultado_incerto'; }
    throw e;
  }
  if (!res?.successful) {
    console.warn(`[composio] ${slug} -> falhou`);
    throw friendlyError(res?.error || 'erro desconhecido');
  }
  console.log(`[composio] ${slug} -> ok`);
  return res.data;
}

/** Leitura — apenas ferramentas da lista READ_TOOLS. */
export function read(slug, args = {}) {
  if (!READ_TOOLS.has(slug)) throw new IntegrationError('nao_permitido', `Ferramenta não permitida: ${slug}`, 400);
  return execute(slug, args);
}

/** Escrita — chamada apenas por publish.js depois da confirmação. */
export function writeConfirmed(slug, args, confirmation) {
  if (!WRITE_TOOLS.has(slug)) throw new IntegrationError('nao_permitido', `Ferramenta não permitida: ${slug}`, 400);
  if (!confirmation || confirmation.confirmed !== true) {
    throw new IntegrationError('sem_confirmacao', 'Ação de escrita bloqueada: falta a confirmação explícita.', 403);
  }
  return execute(slug, args);
}

export async function status() {
  if (!isConfigured()) {
    return { configured: false, connected: false, message: 'Defina COMPOSIO_API_KEY e COMPOSIO_USER_ID no .env para ligar a integração.' };
  }
  try {
    await resolveAccountId();
    const info = await read('INSTAGRAM_GET_USER_INFO', { ig_user_id: 'me', fields: 'id,username,account_type' });
    return { configured: true, connected: true, username: info?.username || null, accountType: info?.account_type || null };
  } catch (err) {
    return { configured: true, connected: false, code: err.code || 'erro', message: err.message };
  }
}
