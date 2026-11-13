// Armazenamento local persistente em JSON (data/db.json), com gravação atômica.
// É também a fila de publicação: posts com publish.state "agendado"/"publicando"
// são retomados pelo agendador mesmo depois de reiniciar o servidor.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), 'data'));
const DB_FILE = path.join(DATA_DIR, 'db.json');

export const STATUSES = ['ideia', 'producao', 'pronto', 'publicado']; // status editorial
export const FORMATS = ['imagem', 'reels', 'carrossel', 'stories'];
export const PUBLISH_STATES = ['rascunho', 'agendado', 'publicando', 'publicado', 'erro'];

let db = { posts: [], formats: {} };

export function load() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DB_FILE)) {
    try {
      db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch {
      const bak = `${DB_FILE}.corrompido-${Date.now()}`;
      fs.copyFileSync(DB_FILE, bak);
      console.warn(`[store] db.json inválido; cópia salva em ${path.basename(bak)}. Iniciando vazio.`);
      db = {};
    }
  }
  if (!Array.isArray(db.posts)) db.posts = [];
  if (!db.formats || typeof db.formats !== 'object') db.formats = {};
  db.posts = db.posts.map(normalize);
}

function persist() {
  const tmp = `${DB_FILE}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  fs.writeSync(fd, JSON.stringify(db, null, 2));
  fs.fsyncSync(fd);
  fs.closeSync(fd);
  fs.renameSync(tmp, DB_FILE);
}

const str = (v, max = 5000) => (v == null ? '' : String(v).slice(0, max));

function emptyPublish() {
  return {
    state: 'rascunho', mode: null, scheduledAt: null, scheduledLocal: null, timezone: 'America/Sao_Paulo',
    confirmedAt: null, confirmedHash: null,
    containerId: null, containerCreatedAt: null, publishAttemptAt: null, step: null, pollCount: 0,
    igMediaId: null, permalink: null, publishedAt: null, error: null, errorCode: null,
    attempts: [],
  };
}

function normalize(p) {
  return {
    title: '', pillar: '', hook: '', caption: '', cta: '', script: '', notes: '', altText: '',
    hashtags: [], status: 'ideia', format: 'reels', planDate: null, mediaUrls: [],
    ...p,
    publish: { ...emptyPublish(), ...(p.publish || {}) },
  };
}

function clean(input, base) {
  const out = { ...base };
  const fields = { title: 200, pillar: 80, hook: 500, caption: 2200, cta: 300, script: 8000, notes: 4000, altText: 1000 };
  for (const [k, max] of Object.entries(fields)) if (k in input) out[k] = str(input[k], max).trim();
  if ('hashtags' in input) {
    const list = Array.isArray(input.hashtags) ? input.hashtags : String(input.hashtags || '').split(/[\s,]+/);
    out.hashtags = [...new Set(list.map((h) => String(h).trim().replace(/^#+/, '')).filter(Boolean).map((h) => `#${h}`))].slice(0, 30);
  }
  if ('mediaUrls' in input) {
    const list = Array.isArray(input.mediaUrls) ? input.mediaUrls : String(input.mediaUrls || '').split(/\s+/);
    out.mediaUrls = list.map((u) => String(u).trim()).filter((u) => /^https?:\/\//i.test(u)).slice(0, 10);
  }
  if ('status' in input && STATUSES.includes(input.status)) out.status = input.status;
  if ('format' in input && FORMATS.includes(input.format)) out.format = input.format;
  if ('planDate' in input) out.planDate = /^\d{4}-\d{2}-\d{2}$/.test(input.planDate || '') ? input.planDate : null;
  return out;
}

export function list() {
  return [...db.posts].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

export function get(id) {
  return db.posts.find((p) => p.id === id) || null;
}

export function create(input) {
  const now = new Date().toISOString();
  const post = clean(input, normalize({ id: crypto.randomUUID(), createdAt: now, updatedAt: now }));
  if (!post.title) post.title = 'Nova ideia';
  db.posts.push(post);
  persist();
  return post;
}

/** Edição feita pelo usuário. Se o post estava agendado, o agendamento é desfeito
 *  (a confirmação valia para o conteúdo anterior). Posts em publicação não podem ser editados. */
export function update(id, input) {
  const idx = db.posts.findIndex((p) => p.id === id);
  if (idx < 0) return { error: 'nao_encontrado' };
  const cur = db.posts[idx];
  if (cur.publish.state === 'publicando') return { error: 'publicando' };
  const next = clean(input, cur);
  next.updatedAt = new Date().toISOString();
  let unscheduled = false;
  if (cur.publish.state === 'agendado' && contentHash(next) !== cur.publish.confirmedHash) {
    next.publish = { ...next.publish, state: 'rascunho', confirmedHash: null, confirmedAt: null, mode: null };
    addAttempt(next, { step: 'agendamento', ok: true, message: 'Agendamento cancelado porque o conteúdo foi alterado. Confirme de novo.' });
    unscheduled = true;
  }
  db.posts[idx] = next;
  persist();
  return { post: next, unscheduled };
}

/** Atualização do estado de publicação (uso do servidor). Persiste imediatamente. */
export function patchPublish(id, patch, attempt) {
  const idx = db.posts.findIndex((p) => p.id === id);
  if (idx < 0) return null;
  const p = db.posts[idx];
  p.publish = { ...p.publish, ...patch };
  if (attempt) addAttempt(p, attempt);
  if (patch.state === 'publicado') p.status = 'publicado';
  p.updatedAt = new Date().toISOString();
  persist();
  return p;
}

function addAttempt(p, a) {
  p.publish.attempts = [...(p.publish.attempts || []), { at: new Date().toISOString(), ...a }].slice(-30);
}

export function remove(id) {
  const p = get(id);
  if (p && p.publish.state === 'publicando') return { error: 'publicando' };
  const before = db.posts.length;
  db.posts = db.posts.filter((x) => x.id !== id);
  if (db.posts.length !== before) persist();
  return { removed: db.posts.length !== before };
}

export function queue() {
  return db.posts.filter((p) => ['agendado', 'publicando'].includes(p.publish.state));
}

// ---- Registro de formatos confirmados na conta ----
export function formats() {
  return db.formats;
}
export function setFormat(format, data) {
  db.formats[format] = { ...(db.formats[format] || {}), ...data, at: new Date().toISOString() };
  persist();
}

// ---- Conteúdo que vai para o Instagram ----
export function buildCaption(p) {
  const parts = [p.caption?.trim()];
  if (p.cta && !p.caption?.includes(p.cta)) parts.push(p.cta.trim());
  const tags = (p.hashtags || []).filter((t) => !(p.caption || '').includes(t));
  if (tags.length) parts.push(tags.join(' '));
  return parts.filter(Boolean).join('\n\n').slice(0, 2200);
}

/** Impressão digital do que foi confirmado: legenda final, formato, mídias e horário. */
export function contentHash(p, scheduledAt = p.publish?.scheduledAt) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify([p.format, buildCaption(p), p.mediaUrls || [], p.altText || '', scheduledAt || null]))
    .digest('hex');
}
