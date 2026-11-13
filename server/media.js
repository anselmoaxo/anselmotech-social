// Validação das URLs de mídia (o Instagram precisa buscá-las publicamente) e
// upload opcional para o Supabase Storage (bucket público) — chave fica só no servidor.
import crypto from 'node:crypto';

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || '';

export const uploadEnabled = () => Boolean(SUPABASE_URL && SUPABASE_KEY && SUPABASE_BUCKET);

const IMAGE_TYPES = ['image/jpeg', 'image/jpg'];
const VIDEO_TYPES = ['video/mp4', 'video/quicktime'];

// Regras por formato, conforme a descrição das ferramentas do Composio.
export const FORMAT_RULES = {
  imagem: { min: 1, max: 1, accept: ['image'], label: 'Imagem no feed (1 JPEG)' },
  reels: { min: 1, max: 1, accept: ['video'], label: 'Reels (1 vídeo MP4/MOV)' },
  stories: { min: 1, max: 1, accept: ['image', 'video'], label: 'Stories (1 JPEG ou 1 vídeo)' },
  carrossel: { min: 2, max: 10, accept: ['image', 'video'], label: 'Carrossel (2 a 10 JPEG/MP4)' },
};

function kindFromType(ct) {
  const t = (ct || '').split(';')[0].trim().toLowerCase();
  if (IMAGE_TYPES.includes(t)) return 'image';
  if (VIDEO_TYPES.includes(t)) return 'video';
  return null;
}

async function probe(url) {
  const opts = { redirect: 'follow', signal: AbortSignal.timeout(15000) };
  let res = await fetch(url, { ...opts, method: 'HEAD' }).catch(() => null);
  if (!res || !res.ok || !res.headers.get('content-type')) {
    res = await fetch(url, { ...opts, method: 'GET', headers: { Range: 'bytes=0-1023' } }).catch((e) => ({ error: e }));
  }
  if (res.error) return { ok: false, message: 'Não foi possível acessar a URL (rede/timeout).' };
  if (!res.ok && res.status !== 206) return { ok: false, message: `A URL respondeu HTTP ${res.status}. Ela precisa ser pública.` };
  try { await res.body?.cancel(); } catch { /* ignore */ }
  const ct = res.headers.get('content-type') || '';
  const len = Number(res.headers.get('content-length') || 0);
  const range = res.headers.get('content-range');
  const size = range ? Number(range.split('/')[1]) || len : len;
  return { ok: true, contentType: ct, kind: kindFromType(ct), size };
}

/** Valida as mídias de um post para o formato escolhido. Retorna { ok, items, errors, warnings }. */
export async function validateMedia(format, urls) {
  const rule = FORMAT_RULES[format];
  const errors = [];
  const warnings = [];
  if (!rule) return { ok: false, items: [], errors: [`Formato "${format}" não é suportado pela integração do Composio.`], warnings };
  if (urls.length < rule.min || urls.length > rule.max)
    errors.push(`${rule.label}: informe ${rule.min === rule.max ? rule.min : `${rule.min} a ${rule.max}`} mídia(s). Você informou ${urls.length}.`);
  const items = [];
  for (const url of urls) {
    if (!/^https:\/\//i.test(url)) warnings.push(`Use HTTPS: ${url}`);
    const r = await probe(url);
    items.push({ url, ...r });
    if (!r.ok) { errors.push(`${url}: ${r.message}`); continue; }
    if (!r.kind) { errors.push(`${url}: tipo "${r.contentType || 'desconhecido'}" não aceito. Use JPEG (imagem) ou MP4/MOV (vídeo).`); continue; }
    if (!rule.accept.includes(r.kind)) errors.push(`${url}: ${rule.label} não aceita ${r.kind === 'image' ? 'imagem' : 'vídeo'}.`);
    if (r.kind === 'image' && r.size > 8 * 1024 * 1024) errors.push(`${url}: imagem maior que 8 MB.`);
  }
  if (format === 'carrossel') warnings.push('Carrossel: proporção entre 4:5 e 1,91:1; vídeos de 3 a 60 s.');
  if (format === 'imagem') warnings.push('Imagem: proporção entre 4:5 e 1,91:1, largura 320–1440 px.');
  return { ok: errors.length === 0, items, errors, warnings };
}

export async function uploadToSupabase(buffer, contentType, originalName = 'arquivo') {
  if (!uploadEnabled()) throw new Error('Upload não configurado (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_BUCKET).');
  const kind = kindFromType(contentType);
  if (!kind) throw new Error('Envie JPEG (imagem) ou MP4/MOV (vídeo).');
  const ext = kind === 'image' ? 'jpg' : contentType.includes('quicktime') ? 'mov' : 'mp4';
  const safe = originalName.toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9-]+/g, '-').slice(0, 40) || 'midia';
  const objectPath = `anselmotech-social/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID().slice(0, 8)}-${safe}.${ext}`;
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(SUPABASE_BUCKET)}/${objectPath}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY, 'Content-Type': contentType, 'x-upsert': 'false' },
    body: buffer,
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`Supabase Storage recusou o upload (HTTP ${res.status}).`);
  return `${SUPABASE_URL}/storage/v1/object/public/${encodeURIComponent(SUPABASE_BUCKET)}/${objectPath}`;
}
