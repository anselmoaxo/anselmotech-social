// Publicação e agendamento no Instagram via Composio.
//
// Garantias:
// - Nada é publicado/agendado sem confirmação explícita (prepare -> token -> confirm com palavra digitada).
// - A confirmação vale para um conteúdo exato (hash). Mudou a legenda/mídia/horário? Agendamento cai.
// - A fila vive em data/db.json e é processada pelo servidor a cada 30 s — fechar o navegador não afeta.
// - Cada etapa é gravada ANTES da chamada externa. Depois de falha/timeout na publicação, o app
//   sempre VERIFICA (status do contêiner + lista de posts) e nunca re-publica automaticamente.
// - Um contêiner (creation_id) é publicado no máximo uma vez; não se cria contêiner novo enquanto
//   houver um válido.
import crypto from 'node:crypto';
import * as store from './store.js';
import * as composio from './composio.js';
import { validateMedia, FORMAT_RULES } from './media.js';
import { zonedToUtc, formatLocal, TZ } from './tz.js';

const TICK_MS = 30_000;
const GRACE_MIN = Number(process.env.PUBLISH_GRACE_MINUTES || 360); // atraso máximo tolerado (servidor desligado)
const MAX_POLLS = 40; // ~20 min aguardando processamento/verificação
const MAX_CREATE_RETRIES = 4;
const ENCODE_HASH = String(process.env.CAPTION_ENCODE_HASHTAGS ?? 'true') !== 'false';
const CONFIRM_WORDS = { agora: 'PUBLICAR', agendar: 'AGENDAR', teste: 'TESTAR' };

const tokens = new Map();
let running = false;
let timer = null;

const STEP_LABEL = {
  criando_container: 'Criando contêiner de mídia',
  aguardando_processamento: 'Instagram processando a mídia',
  publicando_container: 'Publicando',
  verificando: 'Verificando o resultado',
};
export const stepLabel = (s) => STEP_LABEL[s] || s || '';

// ------------------------------------------------------------------ preparo (prévia)
export async function prepare(postId, { mode, scheduledLocal } = {}) {
  let post = store.get(postId);
  if (!post) return { ok: false, errors: ['Post não encontrado.'] };
  if (!CONFIRM_WORDS[mode]) return { ok: false, errors: ['Modo inválido.'] };
  const errors = [];
  const warnings = [];
  const pub = post.publish;

  if (pub.state === 'publicando') return { ok: false, errors: ['Este post está sendo publicado agora. Aguarde o resultado.'] };
  if (pub.state === 'publicado' && mode !== 'teste')
    return { ok: false, errors: ['Este post já foi publicado. Para evitar duplicidade, duplique o rascunho se quiser publicar de novo.'] };

  // Houve erro em tentativa anterior? Verifica antes de permitir nova tentativa.
  if (pub.state === 'erro' && mode !== 'teste' && (pub.containerId || pub.publishAttemptAt)) {
    const r = await reconcile(post);
    if (r.published) {
      await finalize(post.id, r.mediaId, { origem: 'verificação antes de nova tentativa' });
      return { ok: false, alreadyPublished: true, errors: ['A verificação mostrou que este post JÁ FOI publicado. Nenhuma nova tentativa foi feita.'], post: store.get(post.id) };
    }
    if (r.unknown) return { ok: false, errors: [`Não foi possível confirmar se a tentativa anterior foi publicada (${r.message}). Confira no Instagram e tente de novo mais tarde.`] };
    if (r.containerStatus && r.containerStatus !== 'FINISHED') store.patchPublish(post.id, { containerId: null, containerCreatedAt: null });
    warnings.push('Tentativa anterior verificada: nada foi publicado. É seguro tentar de novo.');
    post = store.get(post.id);
  }

  // Horário
  let scheduledAt = new Date();
  if (mode === 'agendar') {
    scheduledAt = zonedToUtc(scheduledLocal, TZ);
    if (!scheduledAt) errors.push('Informe data e horário válidos.');
    else if (scheduledAt.getTime() < Date.now() + 60_000) errors.push('O horário precisa ser pelo menos 1 minuto no futuro (fuso America/Sao_Paulo).');
    else if (scheduledAt.getTime() > Date.now() + 365 * 86400_000) errors.push('Agende no máximo 1 ano à frente.');
  }

  // Formato e legenda
  const rule = FORMAT_RULES[post.format];
  if (!rule) errors.push(`O formato "${post.format}" não é suportado pela integração. Mantenha como rascunho e publique manualmente.`);
  const caption = store.buildCaption(post);
  const tagCount = (caption.match(/#[\p{L}\p{N}_]+/gu) || []).length;
  if (tagCount > 30) errors.push(`A legenda tem ${tagCount} hashtags; o limite do Instagram é 30.`);
  if ((post.caption || '').length + (post.cta || '').length > 2200) errors.push('A legenda passa de 2.200 caracteres.');
  if (post.format === 'stories') warnings.push('Stories não exibem legenda; só a mídia será publicada.');
  else if (!post.caption) warnings.push('A legenda está vazia.');
  if (post.format === 'carrossel') warnings.push('Carrossel misto: o Composio recebe imagens e vídeos em listas separadas; a ordem pode ficar "imagens primeiro".');

  // Mídia
  const mediaCheck = rule ? await validateMedia(post.format, post.mediaUrls || []) : { items: [], errors: [], warnings: [] };
  errors.push(...mediaCheck.errors);
  warnings.push(...mediaCheck.warnings);

  // Conexão e cota
  const st = await composio.status();
  if (!st.connected) errors.push(`Integração indisponível: ${st.message || 'sem conexão com o Instagram.'}`);
  else {
    try {
      const lim = await composio.read('INSTAGRAM_GET_IG_USER_CONTENT_PUBLISHING_LIMIT', { ig_user_id: 'me' });
      const q = lim?.data?.[0];
      if (q && q.quota_usage >= (q.config?.quota_total ?? 100)) {
        (mode === 'agendar' ? warnings : errors).push(`Cota de publicação das últimas 24h esgotada (${q.quota_usage}/${q.config?.quota_total}).`);
      }
    } catch (e) {
      warnings.push(`Não consegui ler a cota de publicação: ${e.message}`);
    }
  }

  // Formato confirmado na conta?
  const fmt = store.formats()[post.format];
  if (mode !== 'teste' && !['aceito', 'publicado'].includes(fmt?.status)) {
    warnings.push(
      fmt?.status === 'recusado'
        ? `Atenção: o formato "${post.format}" foi RECUSADO em teste anterior (${fmt.message || ''}). Provavelmente vai falhar.`
        : `O formato "${post.format}" ainda não foi confirmado na sua conta. Recomendo usar "Testar formato" antes (cria contêiner, não publica).`,
    );
  }

  const preview = {
    mode,
    format: post.format,
    formatLabel: rule?.label || post.format,
    caption,
    captionSent: ENCODE_HASH && post.format !== 'carrossel' ? caption.replace(/#/g, '%23') : caption,
    mediaUrls: post.mediaUrls,
    media: mediaCheck.items.map(({ url, kind, contentType, size }) => ({ url, kind, contentType, size })),
    scheduledAt: scheduledAt?.toISOString?.() || null,
    scheduledHuman: scheduledAt ? `${formatLocal(scheduledAt)} (America/Sao_Paulo)` : null,
    account: st.username ? `@${st.username}` : null,
  };
  if (errors.length) return { ok: false, errors, warnings, preview };

  const token = crypto.randomBytes(18).toString('base64url');
  tokens.set(token, {
    postId: post.id, mode, scheduledAt: preview.scheduledAt, scheduledLocal: mode === 'agendar' ? scheduledLocal : null,
    hash: store.contentHash(post, mode === 'agendar' ? preview.scheduledAt : null), exp: Date.now() + 10 * 60_000,
  });
  return { ok: true, token, confirmWord: CONFIRM_WORDS[mode], warnings, preview };
}

// ------------------------------------------------------------------ confirmação
export async function confirm(postId, token, typed) {
  const t = tokens.get(token);
  if (!t || t.postId !== postId) return { ok: false, error: 'Confirmação inválida ou já usada. Gere a prévia de novo.' };
  if (Date.now() > t.exp) { tokens.delete(token); return { ok: false, error: 'A prévia expirou (10 min). Gere de novo.' }; }
  if (String(typed || '').trim().toUpperCase() !== CONFIRM_WORDS[t.mode]) return { ok: false, error: `Digite ${CONFIRM_WORDS[t.mode]} para confirmar.` };
  const post = store.get(postId);
  if (!post) return { ok: false, error: 'Post não encontrado.' };
  if (store.contentHash(post, t.mode === 'agendar' ? t.scheduledAt : null) !== t.hash) {
    tokens.delete(token);
    return { ok: false, error: 'O conteúdo mudou depois da prévia. Gere a prévia de novo.' };
  }
  if (post.publish.state === 'publicando' || (post.publish.state === 'publicado' && t.mode !== 'teste'))
    return { ok: false, error: 'Estado do post mudou; nada foi feito.' };
  tokens.delete(token); // uso único

  if (t.mode === 'teste') return testFormat(post);

  const scheduledAt = t.mode === 'agora' ? new Date().toISOString() : t.scheduledAt;
  const updated = store.patchPublish(
    postId,
    {
      state: 'agendado', mode: t.mode, scheduledAt, scheduledLocal: t.scheduledLocal, timezone: TZ,
      confirmedAt: new Date().toISOString(), confirmedHash: store.contentHash(post, scheduledAt),
      error: null, errorCode: null, step: null, pollCount: 0, createRetries: 0, publishAttemptAt: null, lastError: null,
    },
    {
      step: 'confirmacao', ok: true,
      message: t.mode === 'agora'
        ? 'Você confirmou a publicação imediata. Entrou na fila.'
        : `Você confirmou o agendamento para ${formatLocal(scheduledAt)} (America/Sao_Paulo).`,
    },
  );
  if (t.mode === 'agora') kick();
  return { ok: true, post: updated };
}

export function cancel(postId) {
  const p = store.get(postId);
  if (!p) return { ok: false, error: 'Post não encontrado.' };
  if (p.publish.state !== 'agendado') return { ok: false, error: p.publish.state === 'publicando' ? 'Já está publicando; não é possível cancelar.' : 'Este post não está agendado.' };
  const post = store.patchPublish(postId, { state: 'rascunho', confirmedHash: null, confirmedAt: null, mode: null }, { step: 'agendamento', ok: true, message: 'Agendamento cancelado por você.' });
  return { ok: true, post };
}

/** Verificação manual (botão "Verificar resultado"). Só leitura. */
export async function verify(postId) {
  const p = store.get(postId);
  if (!p) return { ok: false, error: 'Post não encontrado.' };
  if (!p.publish.containerId && !p.publish.publishAttemptAt) return { ok: true, post: p, message: 'Não houve tentativa de publicação para verificar.' };
  const r = await reconcile(p);
  if (r.published) {
    await finalize(p.id, r.mediaId, { origem: 'verificação manual' });
    return { ok: true, post: store.get(p.id), message: 'Confirmado: o post está publicado no Instagram.' };
  }
  if (r.unknown) return { ok: false, post: p, error: `Não foi possível verificar agora: ${r.message}` };
  return { ok: true, post: p, message: `Verificado: não foi publicado (status do contêiner: ${r.containerStatus || 'sem contêiner'}).` };
}

// ------------------------------------------------------------------ fila (backend)
export function start() {
  // Recuperação após reinício: publicação interrompida no meio vira verificação, nunca re-publicação.
  for (const p of store.queue()) {
    if (p.publish.state === 'publicando' && p.publish.step === 'publicando_container') {
      store.patchPublish(p.id, { step: 'verificando', pollCount: 0 }, { step: 'reinicio', ok: true, message: 'Servidor reiniciou durante a publicação; verificando o resultado antes de qualquer ação.' });
    }
  }
  timer = setInterval(tick, TICK_MS);
  setTimeout(tick, 3000);
  console.log(`[fila] agendador ativo (a cada ${TICK_MS / 1000}s, tolerância de atraso ${GRACE_MIN} min)`);
}
export function stop() { clearInterval(timer); }
export function kick() { setTimeout(tick, 300); }
/** Processa a fila uma vez (usado nos testes). */
export const processQueueNow = () => tick();

async function tick() {
  if (running) return;
  running = true;
  try {
    for (const p of store.queue()) {
      try { await processPost(p.id); } catch (e) { console.error('[fila] erro inesperado:', composio.sanitize(e?.message)); }
    }
  } finally {
    running = false;
  }
}

async function processPost(id) {
  let p = store.get(id);
  if (!p) return;
  const pub = p.publish;
  if (pub.state === 'agendado') {
    const due = new Date(pub.scheduledAt).getTime();
    if (Date.now() < due) return;
    if (store.contentHash(p) !== pub.confirmedHash) {
      store.patchPublish(id, { state: 'rascunho', confirmedHash: null }, { step: 'agendamento', ok: false, message: 'Conteúdo diferente do confirmado; publicação não feita. Confirme de novo.' });
      return;
    }
    if (Date.now() - due > GRACE_MIN * 60_000) {
      fail(id, 'horario_perdido', `Horário perdido: o servidor estava desligado e passaram mais de ${GRACE_MIN} min. Nada foi publicado; reagende.`);
      return;
    }
    p = store.patchPublish(id, { state: 'publicando', step: pub.containerId ? 'aguardando_processamento' : 'criando_container', pollCount: 0 },
      { step: 'inicio', ok: true, message: 'Horário atingido: iniciando publicação.' });
  }
  if (p.publish.state === 'publicando') await advance(id);
}

async function advance(id) {
  let p = store.get(id);

  if (p.publish.step === 'criando_container') {
    // cota
    try {
      const lim = await composio.read('INSTAGRAM_GET_IG_USER_CONTENT_PUBLISHING_LIMIT', { ig_user_id: 'me' });
      const q = lim?.data?.[0];
      if (q && q.quota_usage >= (q.config?.quota_total ?? 100)) return fail(id, 'cota', `Cota de publicação de 24h esgotada (${q.quota_usage}/${q.config?.quota_total}). Nada foi publicado.`);
    } catch { /* segue: a criação do contêiner vai acusar o problema real */ }

    let containerId;
    try {
      containerId = await createContainer(p);
    } catch (e) {
      const retries = (p.publish.createRetries || 0) + 1;
      const transient = e.uncertain || e.code === 'limite';
      if (transient && retries <= MAX_CREATE_RETRIES) {
        // Seguro repetir: contêiner sem publicar não aparece no perfil e expira sozinho.
        store.patchPublish(id, { createRetries: retries }, { step: 'container', ok: false, message: `${e.message} — nova tentativa no próximo ciclo (${retries}/${MAX_CREATE_RETRIES}).` });
        return;
      }
      if (e.code === 'formato_arquivo') recordFormat(p.format, 'recusado', e.message);
      return fail(id, e.code || 'erro', `${e.message} Nada foi publicado; o conteúdo continua como rascunho para publicação manual.`);
    }
    p = store.patchPublish(id, { containerId, containerCreatedAt: new Date().toISOString(), step: 'aguardando_processamento', pollCount: 0 },
      { step: 'container', ok: true, message: 'Contêiner criado.', response: { id: containerId } });
  }

  if (p.publish.step === 'aguardando_processamento') {
    let code;
    try {
      const st = await composio.read('INSTAGRAM_GET_POST_STATUS', { creation_id: p.publish.containerId });
      code = st?.status_code;
    } catch (e) {
      return bumpPoll(id, `Falha ao consultar status: ${e.message}`);
    }
    if (code === 'IN_PROGRESS' || !code) return bumpPoll(id, null);
    if (code === 'PUBLISHED') { p = store.patchPublish(id, { step: 'verificando', pollCount: 0 }); return advance(id); }
    if (code === 'ERROR' || code === 'EXPIRED') {
      if (code === 'ERROR') recordFormat(p.format, 'recusado', 'O Instagram não conseguiu processar a mídia (status ERROR).');
      store.patchPublish(id, { containerId: null, containerCreatedAt: null });
      return fail(id, code === 'ERROR' ? 'formato_arquivo' : 'container_expirado',
        code === 'ERROR'
          ? 'O Instagram recusou a mídia ao processar (status ERROR). Confira formato, proporção, duração e tamanho. Nada foi publicado.'
          : 'O contêiner expirou (24h). Nada foi publicado; confirme de novo para criar outro.');
    }
    if (code === 'FINISHED') {
      p = store.patchPublish(id, { step: 'publicando_container', publishAttemptAt: new Date().toISOString() },
        { step: 'publicacao', ok: true, message: 'Mídia pronta. Enviando publicação.' });
      try {
        const igId = await composio.igUserId();
        const out = await composio.writeConfirmed('INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH',
          { ig_user_id: igId, creation_id: p.publish.containerId, max_wait_seconds: 15 }, { confirmed: true });
        if (out?.id) return finalize(id, out.id, { id: out.id });
        store.patchPublish(id, { step: 'verificando', pollCount: 0 }, { step: 'publicacao', ok: false, message: 'Resposta sem ID; verificando o resultado.' });
      } catch (e) {
        store.patchPublish(id, { step: 'verificando', pollCount: 0, lastError: { code: e.code, message: e.message } }, {
          step: 'publicacao', ok: false,
          message: `${e.uncertain ? 'Sem resposta (timeout/rede).' : e.message} Verificando antes de qualquer nova tentativa.`,
        });
      }
      return advance(id);
    }
  }

  if (p.publish.step === 'verificando') {
    const r = await reconcile(p);
    if (r.published) return finalize(id, r.mediaId, { origem: 'verificação' });
    if (r.unknown) return bumpPoll(id, `Verificação pendente: ${r.message}`, 'verificacao_pendente',
      'Não foi possível confirmar o resultado. Confira no Instagram antes de tentar de novo; o app não vai repetir sozinho.');
    const last = p.publish.lastError;
    if (last?.code === 'formato_arquivo') recordFormat(p.format, 'recusado', last.message);
    return fail(id, last?.code || 'nao_publicado',
      `Verificado: a publicação NÃO foi concluída (contêiner ${r.containerStatus || '—'}). ${last?.message || ''} Você pode tentar de novo com segurança.`);
  }
}

function bumpPoll(id, message, failCode = 'processamento_lento', failMsg = 'O Instagram não terminou de processar a mídia em ~20 min. Nada foi publicado.') {
  const p = store.get(id);
  const n = (p.publish.pollCount || 0) + 1;
  if (n > MAX_POLLS) return fail(id, failCode, failMsg);
  store.patchPublish(id, { pollCount: n }, message ? { step: p.publish.step, ok: false, message } : undefined);
}

function fail(id, code, message) {
  store.patchPublish(id, { state: 'erro', errorCode: code, error: message, step: null }, { step: 'erro', ok: false, message });
  console.warn(`[fila] post ${id.slice(0, 8)} -> erro (${code})`);
}

async function finalize(id, mediaId, response) {
  let permalink = null;
  if (mediaId) {
    try {
      const m = await composio.read('INSTAGRAM_GET_IG_MEDIA', { ig_media_id: String(mediaId), fields: 'id,permalink,timestamp' });
      permalink = m?.permalink || null;
    } catch { /* link opcional */ }
  }
  const p = store.patchPublish(id, {
    state: 'publicado', step: null, igMediaId: mediaId || null, permalink, publishedAt: new Date().toISOString(), error: null, errorCode: null,
  }, {
    step: 'publicado', ok: true,
    message: mediaId ? `Publicado e confirmado pelo Instagram (ID ${mediaId}).` : 'Publicação confirmada pelo status do contêiner (PUBLISHED); ID do post não identificado.',
    response,
  });
  recordFormat(p.format, 'publicado', 'Publicação confirmada.');
  console.log(`[fila] post ${id.slice(0, 8)} -> publicado`);
  return p;
}

function recordFormat(format, status, message) {
  const cur = store.formats()[format];
  if (status === 'recusado' && cur?.status === 'publicado') return; // já provado que funciona
  store.setFormat(format, { status, message });
}

// ------------------------------------------------------------------ chamadas de escrita
async function createContainer(p) {
  const check = await validateMedia(p.format, p.mediaUrls || []);
  if (!check.ok) {
    const e = new composio.IntegrationError('formato_arquivo', `Mídia inválida no momento da publicação: ${check.errors.join(' ')}`, 422);
    throw e;
  }
  const igId = await composio.igUserId();
  const caption = store.buildCaption(p);
  const capApi = ENCODE_HASH ? caption.replace(/#/g, '%23') : caption;
  const ok = { confirmed: true };
  const [first] = check.items;
  let out;
  if (p.format === 'imagem') {
    out = await composio.writeConfirmed('INSTAGRAM_POST_IG_USER_MEDIA', {
      ig_user_id: igId, image_url: first.url, caption: capApi, ...(p.altText ? { alt_text: p.altText } : {}),
    }, ok);
  } else if (p.format === 'reels') {
    out = await composio.writeConfirmed('INSTAGRAM_POST_IG_USER_MEDIA', {
      ig_user_id: igId, video_url: first.url, media_type: 'REELS', caption: capApi, share_to_feed: true,
    }, ok);
  } else if (p.format === 'stories') {
    out = await composio.writeConfirmed('INSTAGRAM_POST_IG_USER_MEDIA', {
      ig_user_id: igId, media_type: 'STORIES', ...(first.kind === 'video' ? { video_url: first.url } : { image_url: first.url }),
    }, ok);
  } else if (p.format === 'carrossel') {
    const imgs = check.items.filter((i) => i.kind === 'image').map((i) => i.url);
    const vids = check.items.filter((i) => i.kind === 'video').map((i) => i.url);
    out = await composio.writeConfirmed('INSTAGRAM_CREATE_CAROUSEL_CONTAINER', {
      ig_user_id: igId, caption,
      ...(imgs.length ? { child_image_urls: imgs } : {}),
      ...(vids.length ? { child_video_urls: vids } : {}),
    }, ok);
  } else {
    throw new composio.IntegrationError('formato_arquivo', `Formato "${p.format}" não suportado pela integração.`, 422);
  }
  if (!out?.id) throw new composio.IntegrationError('falha_integracao', 'O Composio não retornou o ID do contêiner.');
  return String(out.id);
}

// ------------------------------------------------------------------ verificação (somente leitura)
const norm = (s) => String(s || '').replace(/%23/g, '#').replace(/#[\p{L}\p{N}_]+/gu, '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 80);

async function reconcile(p) {
  const pub = p.publish;
  let containerStatus = null;
  try {
    if (pub.containerId) {
      const st = await composio.read('INSTAGRAM_GET_POST_STATUS', { creation_id: pub.containerId });
      containerStatus = st?.status_code || null;
    }
    // Procura o post na conta (feed/Reels/carrossel) pela legenda, a partir da tentativa.
    const sinceMs = new Date(pub.publishAttemptAt || pub.containerCreatedAt || Date.now()).getTime() - 10 * 60_000;
    let match = null;
    if (p.format !== 'stories' && (containerStatus === 'PUBLISHED' || pub.publishAttemptAt)) {
      const list = await composio.read('INSTAGRAM_GET_IG_USER_MEDIA', { ig_user_id: 'me', limit: 15, since: Math.floor(sinceMs / 1000), fields: 'id,caption,permalink,timestamp' });
      const want = norm(p.caption || store.buildCaption(p));
      match = (list?.data || []).find((m) => want && norm(m.caption) === want) || null;
    }
    if (match) return { published: true, mediaId: match.id, containerStatus };
    if (containerStatus === 'PUBLISHED') return { published: true, mediaId: pub.igMediaId || null, containerStatus };
    return { published: false, containerStatus };
  } catch (e) {
    return { unknown: true, message: e.message };
  }
}

// ------------------------------------------------------------------ teste de formato (nunca publica)
async function testFormat(post) {
  try {
    const containerId = await createContainer(post);
    let code = 'IN_PROGRESS';
    for (let i = 0; i < 18 && code === 'IN_PROGRESS'; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      try {
        const st = await composio.read('INSTAGRAM_GET_POST_STATUS', { creation_id: containerId });
        code = st?.status_code || 'IN_PROGRESS';
      } catch { /* tenta de novo */ }
    }
    if (code === 'FINISHED') {
      recordFormat(post.format, 'aceito', 'Contêiner criado e processado (não publicado).');
      return { ok: true, test: { format: post.format, result: 'aceito', message: `Formato "${post.format}" aceito: o Instagram criou e processou o contêiner. NADA foi publicado; o contêiner expira sozinho em até 24h.` } };
    }
    if (code === 'ERROR') {
      recordFormat(post.format, 'recusado', 'Status ERROR ao processar.');
      return { ok: true, test: { format: post.format, result: 'recusado', message: 'O Instagram recusou a mídia ao processar (status ERROR). Nada foi publicado.' } };
    }
    return { ok: true, test: { format: post.format, result: 'pendente', message: `Contêiner criado, mas ainda em ${code} após 90 s. Nada foi publicado. Tente o teste de novo mais tarde.` } };
  } catch (e) {
    if (e.code === 'formato_arquivo') recordFormat(post.format, 'recusado', e.message);
    return { ok: false, error: `Teste não concluído: ${e.message}` };
  }
}
