import 'dotenv/config';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import * as store from './store.js';
import * as composio from './composio.js';
import * as publisher from './publisher.js';
import * as ai from './ai.js';
import { uploadEnabled, uploadToSupabase, FORMAT_RULES } from './media.js';
import { TZ } from './tz.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const APP_PASSWORD = process.env.APP_PASSWORD || '';

if (!['127.0.0.1', 'localhost', '::1'].includes(HOST) && !APP_PASSWORD) {
  console.error('Recusando iniciar: HOST aberto para a rede sem APP_PASSWORD. Defina APP_PASSWORD no .env.');
  process.exit(1);
}

store.load();
const app = express();
app.disable('x-powered-by');

// Cabeçalhos de segurança
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' https: data: blob:; media-src 'self' https: blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'self'; connect-src 'self'",
  );
  next();
});

// Autenticação básica opcional (usuário: anselmo)
if (APP_PASSWORD) {
  const expected = Buffer.from(`anselmo:${APP_PASSWORD}`);
  app.use((req, res, next) => {
    const h = req.headers.authorization || '';
    const got = Buffer.from(h.startsWith('Basic ') ? Buffer.from(h.slice(6), 'base64').toString() : '');
    if (got.length === expected.length && crypto.timingSafeEqual(got, expected)) return next();
    res.setHeader('WWW-Authenticate', 'Basic realm="AnselmoTech Social"');
    res.status(401).send('Autenticação necessária');
  });
}

app.use('/api', express.json({ limit: '200kb' }));
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const isNumericId = (s) => /^\d{5,30}$/.test(String(s || ''));

// ---------------- configuração / integração
app.get('/api/config', (req, res) => {
  res.json({
    composio: { configured: composio.isConfigured() },
    ai: { enabled: ai.aiEnabled(), model: ai.aiEnabled() ? process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5' : null },
    upload: { enabled: uploadEnabled() },
    timezone: TZ,
    capabilities: composio.CAPABILITIES,
    notAvailable: composio.NOT_AVAILABLE,
    formatRules: FORMAT_RULES,
    formats: store.formats(),
  });
});

app.get('/api/ig/status', wrap(async (req, res) => res.json(await composio.status())));

app.get('/api/ig/overview', wrap(async (req, res) => {
  const days = [7, 14, 28].includes(Number(req.query.days)) ? Number(req.query.days) : 28;
  const until = Math.floor(Date.now() / 1000);
  const since = until - days * 86400;
  const [profile, insights, limit] = await Promise.allSettled([
    composio.read('INSTAGRAM_GET_USER_INFO', { ig_user_id: 'me', fields: 'id,username,name,account_type,profile_picture_url,followers_count,follows_count,media_count' }),
    composio.read('INSTAGRAM_GET_USER_INSIGHTS', {
      metric: ['reach', 'views', 'accounts_engaged', 'total_interactions', 'profile_views'],
      period: 'day', metric_type: 'total_value', since, until,
    }),
    composio.read('INSTAGRAM_GET_IG_USER_CONTENT_PUBLISHING_LIMIT', { ig_user_id: 'me' }),
  ]);
  if (profile.status === 'rejected') throw profile.reason;
  const metrics = insights.status === 'fulfilled'
    ? (insights.value?.data || []).map((m) => ({ name: m.name, title: m.title, value: m.total_value?.value ?? null }))
    : null;
  res.json({
    days,
    profile: profile.value,
    metrics,
    metricsError: insights.status === 'rejected' ? insights.reason.message : null,
    publishingLimit: limit.status === 'fulfilled' ? limit.value?.data?.[0] || null : null,
  });
}));

app.get('/api/ig/media', wrap(async (req, res) => {
  const args = {
    ig_user_id: 'me',
    limit: Math.min(Math.max(Number(req.query.limit) || 25, 1), 50),
    fields: 'id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count',
  };
  if (req.query.after) args.after = String(req.query.after).slice(0, 500);
  const data = await composio.read('INSTAGRAM_GET_IG_USER_MEDIA', args);
  res.json({ items: data?.data || [], after: data?.paging?.cursors?.after || null, hasNext: Boolean(data?.paging?.next) });
}));

app.get('/api/ig/media/:id/insights', wrap(async (req, res) => {
  if (!isNumericId(req.params.id)) return res.status(400).json({ error: 'ID inválido.' });
  const isReel = req.query.type === 'REELS';
  const base = ['views', 'reach', 'likes', 'comments', 'saved', 'shares'];
  const full = isReel ? [...base, 'total_interactions', 'ig_reels_avg_watch_time'] : [...base, 'total_interactions'];
  let data;
  try {
    data = await composio.read('INSTAGRAM_GET_IG_MEDIA_INSIGHTS', { ig_media_id: req.params.id, metric: full });
  } catch {
    data = await composio.read('INSTAGRAM_GET_IG_MEDIA_INSIGHTS', { ig_media_id: req.params.id, metric: base });
  }
  res.json({ metrics: (data?.data || []).map((m) => ({ name: m.name, title: m.title, value: m.values?.[0]?.value ?? null })) });
}));

app.get('/api/ig/media/:id/comments', wrap(async (req, res) => {
  if (!isNumericId(req.params.id)) return res.status(400).json({ error: 'ID inválido.' });
  const data = await composio.read('INSTAGRAM_GET_IG_MEDIA_COMMENTS', { ig_media_id: req.params.id, limit: 50, fields: 'id,text,username,timestamp,like_count' });
  res.json({ items: data?.data || [] });
}));

// ---------------- conteúdo (rascunhos, ideias, calendário)
app.get('/api/posts', (req, res) => res.json({ items: store.list() }));
app.post('/api/posts', (req, res) => res.status(201).json(store.create(req.body || {})));
app.put('/api/posts/:id', (req, res) => {
  const r = store.update(req.params.id, req.body || {});
  if (r.error === 'nao_encontrado') return res.status(404).json({ error: 'Post não encontrado.' });
  if (r.error === 'publicando') return res.status(409).json({ error: 'O post está sendo publicado; aguarde para editar.' });
  res.json({ ...r.post, _unscheduled: r.unscheduled });
});
app.delete('/api/posts/:id', (req, res) => {
  const r = store.remove(req.params.id);
  if (r.error) return res.status(409).json({ error: 'O post está sendo publicado; não pode ser excluído agora.' });
  res.json({ ok: r.removed });
});
app.post('/api/posts/:id/duplicate', (req, res) => {
  const p = store.get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Post não encontrado.' });
  const { id, createdAt, updatedAt, publish, ...rest } = p;
  res.status(201).json(store.create({ ...rest, title: `${p.title} (cópia)`, status: p.status === 'publicado' ? 'pronto' : p.status }));
});

// ---------------- publicação (sempre com confirmação)
app.post('/api/posts/:id/publish/prepare', wrap(async (req, res) => {
  const { mode, scheduledLocal } = req.body || {};
  res.json(await publisher.prepare(req.params.id, { mode, scheduledLocal }));
}));
app.post('/api/posts/:id/publish/confirm', wrap(async (req, res) => {
  const { token, confirmText } = req.body || {};
  const r = await publisher.confirm(req.params.id, token, confirmText);
  res.status(r.ok ? 200 : 400).json(r);
}));
app.post('/api/posts/:id/publish/cancel', (req, res) => {
  const r = publisher.cancel(req.params.id);
  res.status(r.ok ? 200 : 400).json(r);
});
app.post('/api/posts/:id/publish/verify', wrap(async (req, res) => {
  const r = await publisher.verify(req.params.id);
  res.status(r.ok ? 200 : 502).json(r);
}));

// ---------------- upload opcional (Supabase Storage)
app.post('/api/upload', express.raw({ type: ['image/jpeg', 'video/mp4', 'video/quicktime'], limit: '300mb' }), wrap(async (req, res) => {
  if (!uploadEnabled()) return res.status(501).json({ error: 'Upload não configurado. Cole uma URL pública ou configure o Supabase Storage no .env.' });
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Envie um arquivo JPEG, MP4 ou MOV.' });
  const url = await uploadToSupabase(req.body, req.headers['content-type'], String(req.headers['x-filename'] || 'midia'));
  res.json({ url });
}));

// ---------------- IA
app.post('/api/ai/suggest', wrap(async (req, res) => {
  const b = req.body || {};
  const clip = (v, n) => String(v || '').slice(0, n);
  res.json(await ai.suggest({
    topic: clip(b.topic, 200), format: clip(b.format, 20), audience: clip(b.audience, 200),
    goal: clip(b.goal, 200), details: clip(b.details, 1500), caption: clip(b.caption, 2200),
  }));
}));

// ---------------- estático + erros
const nm = (p) => path.join(__dirname, '..', 'node_modules', p);
app.use('/fonts/bricolage', express.static(nm('@fontsource-variable/bricolage-grotesque'), { maxAge: '30d' }));
app.use('/fonts/plex-sans', express.static(nm('@fontsource/ibm-plex-sans'), { maxAge: '30d' }));
app.use('/fonts/plex-mono', express.static(nm('@fontsource/ibm-plex-mono'), { maxAge: '30d' }));
app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));
app.use('/api', (req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error('[erro]', composio.sanitize(err.message));
  res.status(status).json({ error: err instanceof composio.IntegrationError ? err.message : composio.sanitize(err.message || 'Erro interno.'), code: err.code || 'erro' });
});

app.listen(PORT, HOST, () => {
  console.log(`AnselmoTech Social em http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`Composio: ${composio.isConfigured() ? 'configurado' : 'NÃO configurado'} | IA: ${ai.aiEnabled() ? 'Claude' : 'gerador local'} | Upload: ${uploadEnabled() ? 'Supabase' : 'desligado'}`);
  publisher.start();
});
