// Testa a máquina de estados da publicação com o Composio SIMULADO (nenhuma chamada real).
// Rodar: npm test
import { test, mock, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ats-test-'));

class IntegrationError extends Error { constructor(code, m, s = 502) { super(m); this.code = code; this.status = s; } }
const sim = { calls: [], container: null, publishMode: 'ok', containerStatus: 'FINISHED', published: new Set(), mediaList: [] };
const reset = () => Object.assign(sim, { calls: [], container: null, publishMode: 'ok', containerStatus: 'FINISHED', published: new Set(), mediaList: [] });
let n = 0;

mock.module('../server/composio.js', {
  namedExports: {
    IntegrationError,
    sanitize: (x) => String(x),
    isConfigured: () => true,
    status: async () => ({ configured: true, connected: true, username: 'anselmo.tech' }),
    igUserId: async () => '17841458238026567',
    read: async (slug, args) => {
      sim.calls.push(slug);
      if (slug === 'INSTAGRAM_GET_IG_USER_CONTENT_PUBLISHING_LIMIT') return { data: [{ quota_usage: 0, config: { quota_total: 100 } }] };
      if (slug === 'INSTAGRAM_GET_POST_STATUS') return { id: args.creation_id, status_code: sim.published.has(args.creation_id) ? 'PUBLISHED' : sim.containerStatus };
      if (slug === 'INSTAGRAM_GET_IG_USER_MEDIA') return { data: sim.mediaList };
      if (slug === 'INSTAGRAM_GET_IG_MEDIA') return { id: args.ig_media_id, permalink: `https://www.instagram.com/p/${args.ig_media_id}/` };
      throw new Error(`leitura inesperada ${slug}`);
    },
    writeConfirmed: async (slug, args, conf) => {
      assert.equal(conf?.confirmed, true);
      sim.calls.push(slug);
      if (slug === 'INSTAGRAM_POST_IG_USER_MEDIA' || slug === 'INSTAGRAM_CREATE_CAROUSEL_CONTAINER') { sim.container = `C${++n}`; return { id: sim.container }; }
      if (slug === 'INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH') {
        if (sim.publishMode === 'timeout_but_published') { sim.published.add(args.creation_id); sim.mediaList = [{ id: 'M1', caption: args.caption || 'Legenda de teste' }]; const e = new IntegrationError('resultado_incerto', 'timeout'); e.uncertain = true; throw e; }
        if (sim.publishMode === 'fail') throw new IntegrationError('falha_integracao', 'erro (#9007) mídia não pronta');
        sim.published.add(args.creation_id); return { id: 'M2' };
      }
      throw new Error(`escrita inesperada ${slug}`);
    },
  },
});
mock.module('../server/media.js', {
  namedExports: {
    FORMAT_RULES: { imagem: { min: 1, max: 1, accept: ['image'], label: 'Imagem' }, reels: { min: 1, max: 1, accept: ['video'], label: 'Reels' } },
    validateMedia: async (format, urls) => ({ ok: true, errors: [], warnings: [], items: urls.map((url) => ({ url, ok: true, kind: format === 'reels' ? 'video' : 'image' })) }),
  },
});

let store; let pub;
before(async () => {
  // Cada teste começa com a fila vazia: processamos apenas os posts criados no próprio teste.
  store = await import('../server/store.js');
  pub = await import('../server/publisher.js');
  store.load();
});
beforeEach(async () => {
  reset();
  for (const p of store.queue()) store.patchPublish(p.id, { state: 'rascunho' });
});

const count = (slug) => sim.calls.filter((c) => c === slug).length;
const mk = () => store.create({ title: 'T', format: 'imagem', caption: 'Legenda de teste', mediaUrls: ['https://x.test/a.jpg'] });
async function confirmNow(id) {
  const p = await pub.prepare(id, { mode: 'agora' });
  assert.equal(p.ok, true, JSON.stringify(p.errors));
  const c = await pub.confirm(id, p.token, 'PUBLICAR');
  assert.equal(c.ok, true, c.error);
  assert.equal(c.post.publish.state, 'agendado'); // confirmar NÃO é publicar
}

test('palavra de confirmação errada e token reutilizado são recusados', async () => {
  const post = mk();
  const p = await pub.prepare(post.id, { mode: 'agora' });
  assert.equal((await pub.confirm(post.id, p.token, 'sim')).ok, false);
  assert.equal((await pub.confirm(post.id, p.token, 'PUBLICAR')).ok, true);
  assert.equal((await pub.confirm(post.id, p.token, 'PUBLICAR')).ok, false);
});

test('fluxo normal: 1 contêiner, 1 publicação, guarda ID e link', async () => {
  const post = mk();
  await confirmNow(post.id);
  await pub.processQueueNow();
  const p = store.get(post.id);
  assert.equal(p.publish.state, 'publicado');
  assert.equal(p.publish.igMediaId, 'M2');
  assert.match(p.publish.permalink, /instagram\.com/);
  assert.equal(count('INSTAGRAM_POST_IG_USER_MEDIA'), 1);
  assert.equal(count('INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH'), 1);
});

test('timeout na publicação que na verdade publicou: verifica e NÃO publica de novo', async () => {
  sim.publishMode = 'timeout_but_published';
  const post = mk();
  await confirmNow(post.id);
  await pub.processQueueNow();
  await pub.processQueueNow();
  const p = store.get(post.id);
  assert.equal(p.publish.state, 'publicado');
  assert.equal(p.publish.igMediaId, 'M1');
  assert.equal(count('INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH'), 1);
});

test('falha real: vira erro; nova tentativa reaproveita o mesmo contêiner', async () => {
  sim.publishMode = 'fail';
  const post = mk();
  await confirmNow(post.id);
  await pub.processQueueNow();
  let p = store.get(post.id);
  assert.equal(p.publish.state, 'erro');
  assert.match(p.publish.error, /NÃO foi concluída/);
  sim.publishMode = 'ok';
  await confirmNow(post.id); // prepare verifica antes de liberar
  await pub.processQueueNow();
  p = store.get(post.id);
  assert.equal(p.publish.state, 'publicado');
  assert.equal(count('INSTAGRAM_POST_IG_USER_MEDIA'), 1, 'não deve criar segundo contêiner');
  assert.equal(count('INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH'), 2);
});

test('post já publicado não pode ser publicado de novo', async () => {
  const post = mk();
  await confirmNow(post.id);
  await pub.processQueueNow();
  const again = await pub.prepare(post.id, { mode: 'agora' });
  assert.equal(again.ok, false);
});

test('contêiner com status ERROR: erro de formato, nada publicado', async () => {
  sim.containerStatus = 'ERROR';
  const post = mk();
  await confirmNow(post.id);
  await pub.processQueueNow();
  const p = store.get(post.id);
  assert.equal(p.publish.state, 'erro');
  assert.equal(p.publish.errorCode, 'formato_arquivo');
  assert.equal(count('INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH'), 0);
});

test('agendamento futuro: não publica antes da hora; editar desfaz o agendamento', async () => {
  const post = mk();
  const p = await pub.prepare(post.id, { mode: 'agendar', scheduledLocal: '2027-06-10T09:00' });
  assert.equal(p.ok, true);
  assert.equal(p.preview.scheduledAt, '2027-06-10T12:00:00.000Z'); // 09:00 em São Paulo = 12:00 UTC
  const c = await pub.confirm(post.id, p.token, 'AGENDAR');
  assert.equal(c.post.publish.state, 'agendado');
  await pub.processQueueNow();
  assert.equal(store.get(post.id).publish.state, 'agendado');
  assert.equal(count('INSTAGRAM_POST_IG_USER_MEDIA'), 0);
  const r = store.update(post.id, { caption: 'Outra legenda' });
  assert.equal(r.unscheduled, true);
  assert.equal(store.get(post.id).publish.state, 'rascunho');
});

test('conteúdo alterado entre a prévia e a confirmação invalida a confirmação', async () => {
  const post = mk();
  const p = await pub.prepare(post.id, { mode: 'agora' });
  store.update(post.id, { caption: 'mudei' });
  const c = await pub.confirm(post.id, p.token, 'PUBLICAR');
  assert.equal(c.ok, false);
});
