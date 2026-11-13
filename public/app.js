// AnselmoTech Social — interface (sem frameworks; CSP sem scripts inline).
const TZ = 'America/Sao_Paulo';
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmtN = (n) => (n == null ? '—' : new Intl.NumberFormat('pt-BR').format(n));
const fmtDT = (d) => (d ? new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, dateStyle: 'short', timeStyle: 'short' }).format(new Date(d)) : '—');
const fmtDay = (d) => new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, weekday: 'long', day: '2-digit', month: 'long' }).format(new Date(d));

const STATUS = [
  { id: 'ideia', label: 'Ideia' },
  { id: 'producao', label: 'Em produção' },
  { id: 'pronto', label: 'Pronto' },
  { id: 'publicado', label: 'Publicado' },
];
const FORMATS = [
  { id: 'reels', label: 'Reels' },
  { id: 'carrossel', label: 'Carrossel' },
  { id: 'imagem', label: 'Imagem' },
  { id: 'stories', label: 'Stories' },
];
const PSTATE_LABEL = { rascunho: 'rascunho', agendado: 'agendado', publicando: 'publicando', publicado: 'publicado', erro: 'erro' };
const statusLabel = (id) => STATUS.find((s) => s.id === id)?.label || id;
const formatLabel = (id) => FORMATS.find((f) => f.id === id)?.label || id;

const state = { config: null, posts: [], igStatus: null, route: 'painel', calMonth: null, filter: { q: '', format: '' } };

// ---------------- API
async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: opts.body && !(opts.body instanceof Blob) ? { 'Content-Type': 'application/json', ...(opts.headers || {}) } : opts.headers,
    body: opts.body && !(opts.body instanceof Blob) && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body,
  });
  let data = null;
  try { data = await res.json(); } catch { /* sem corpo */ }
  if (!res.ok && !(data && 'ok' in data)) {
    const err = new Error(data?.error || `Erro ${res.status}`);
    err.code = data?.code;
    err.status = res.status;
    throw err;
  }
  return data;
}

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), kind === 'err' ? 9000 : 5000);
}

async function copy(text, what = 'Texto') {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${what} copiado.`, 'ok');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.append(ta); ta.select();
    try { document.execCommand('copy'); toast(`${what} copiado.`, 'ok'); } catch { toast('Não foi possível copiar.', 'err'); }
    ta.remove();
  }
}

// Mesma lógica do servidor (store.buildCaption).
function buildCaption(p) {
  const parts = [p.caption?.trim()];
  if (p.cta && !(p.caption || '').includes(p.cta)) parts.push(p.cta.trim());
  const tags = (p.hashtags || []).filter((t) => !(p.caption || '').includes(t));
  if (tags.length) parts.push(tags.join(' '));
  return parts.filter(Boolean).join('\n\n').slice(0, 2200);
}

function spParts(date = new Date()) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(date).map((x) => [x.type, x.value]));
}
const spDateKey = (d) => { const p = spParts(new Date(d)); return `${p.year}-${p.month}-${p.day}`; };
function defaultSchedule(planDate) {
  if (planDate) return `${planDate}T09:00`;
  const p = spParts(new Date(Date.now() + 86400000));
  return `${p.year}-${p.month}-${p.day}T09:00`;
}
const isVideoUrl = (u) => /\.(mp4|mov)(\?|$)/i.test(u);
const mediaTag = (u, cls = '') => (isVideoUrl(u)
  ? `<video class="${cls}" src="${esc(u)}" muted playsinline preload="metadata"></video>`
  : `<img class="${cls}" src="${esc(u)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`);

// ---------------- dados
async function loadPosts() {
  const r = await api('/api/posts');
  state.posts = r.items;
  return state.posts;
}
async function loadStatus() {
  try { state.igStatus = await api('/api/ig/status'); } catch (e) { state.igStatus = { connected: false, message: e.message }; }
  renderConnPill();
}
function renderConnPill() {
  const s = state.igStatus;
  const el = $('#conn-pill');
  if (!s) { el.innerHTML = ''; return; }
  el.innerHTML = `<a class="pill" href="#/integracao" style="text-decoration:none"><span class="dot ${s.connected ? 'ok' : 'err'}"></span>${s.connected ? `@${esc(s.username)}` : 'Instagram desconectado'}</a>`;
}

// ---------------- roteamento
const VIEWS = {
  painel: { title: 'Painel', render: renderPainel },
  conteudo: { title: 'Ideias e rascunhos', render: renderConteudo },
  calendario: { title: 'Calendário editorial', render: renderCalendario },
  resultados: { title: 'Resultados', render: renderResultados },
  integracao: { title: 'Integração', render: renderIntegracao },
};
function route() {
  const r = (location.hash.replace(/^#\/?/, '') || 'painel').split('/')[0];
  state.route = VIEWS[r] ? r : 'painel';
  $$('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === state.route));
  $('#view-title').textContent = VIEWS[state.route].title;
  document.title = `${VIEWS[state.route].title}, AnselmoTech Social`;
  VIEWS[state.route].render();
}
window.addEventListener('hashchange', route);

function integrationNotice() {
  const s = state.igStatus;
  if (!s || s.connected) return '';
  return `<div class="notice ${s.configured ? 'err' : 'warn'}"><b>${s.configured ? 'Não foi possível acessar o Instagram.' : 'Integração não configurada.'}</b> ${esc(s.message || '')} <a href="#/integracao">Ver detalhes</a></div>`;
}

// ---------------- PAINEL
async function renderPainel() {
  const v = $('#view');
  const counts = Object.fromEntries(STATUS.map((s) => [s.id, state.posts.filter((p) => p.status === s.id).length]));
  const queue = state.posts
    .filter((p) => ['agendado', 'publicando', 'erro'].includes(p.publish.state))
    .sort((a, b) => (a.publish.scheduledAt || '').localeCompare(b.publish.scheduledAt || ''));
  const next = queue.find((p) => ['agendado', 'publicando'].includes(p.publish.state));
  const flowing = state.posts.some((p) => p.publish.state === 'publicando');
  v.innerHTML = `
    ${integrationNotice()}
    <section class="hero">
      <div class="hero-id" id="profile-card"><div class="skeleton" style="width:100%"></div></div>
      <div class="hero-next">
        ${next
          ? `<span>${next.publish.state === 'publicando' ? 'Publicando agora' : 'Próxima publicação'}</span><h3>${esc(next.title)}</h3><span class="when">${fmtDT(next.publish.scheduledAt)}</span><button class="btn sm" data-open="${next.id}">Abrir post</button>`
          : `<span>Nenhuma publicação agendada</span><h3>${counts.pronto ? `${counts.pronto} ${counts.pronto === 1 ? 'post pronto espera' : 'posts prontos esperam'} data` : 'Comece por uma ideia'}</h3><a class="btn sm" href="#/conteudo">Ver quadro de conteúdo</a>`}
      </div>
    </section>
    <section class="card">
      <div class="card-head"><h2>Pipeline de conteúdo</h2><a class="btn sm ghost" href="#/conteudo">Abrir quadro</a></div>
      <div class="pipe-mini ${flowing ? 'flowing' : ''}">
        ${STATUS.map((s, i) => `${i ? '<span class="wire" aria-hidden="true"></span>' : ''}<a class="node ${s.id}" href="#/conteudo"><span class="c">${counts[s.id]}</span><span class="t">${s.label}</span></a>`).join('')}
      </div>
    </section>
    <section class="card">
      <div class="card-head">
        <h2>Desempenho da conta</h2>
        <select id="days" aria-label="Período" style="width:auto"><option value="7">Últimos 7 dias</option><option value="14">Últimos 14 dias</option><option value="28" selected>Últimos 28 dias</option></select>
      </div>
      <div id="kpis" class="metrics-row"><div class="skeleton"></div></div>
      <p class="dim small" style="margin:14px 0 0">Números estimados pela Meta, lidos da API do Instagram pelo Composio.</p>
    </section>
    <section class="card">
      <div class="card-head"><h2>Fila de publicação</h2><span class="dim small">O servidor confere a fila a cada 30 segundos</span></div>
      ${queue.length ? `<div class="col-list">${queue.slice(0, 8).map(queueRow).join('')}</div>` : '<div class="empty">A fila está vazia. Abra um post pronto, adicione a mídia e use Agendar.</div>'}
    </section>`;
  $$('[data-open]', v).forEach((el) => el.addEventListener('click', () => openEditor(el.dataset.open)));
  $('#days').addEventListener('change', (e) => loadOverview(e.target.value));
  loadOverview(28);
}
function queueRow(p) {
  const when = p.publish.scheduledAt ? fmtDT(p.publish.scheduledAt) : '—';
  return `<div class="pcard" data-open="${p.id}">
    <div class="row"><span class="badge ${p.publish.state}">${PSTATE_LABEL[p.publish.state]}</span><span class="badge fmt">${formatLabel(p.format)}</span><span class="spacer"></span><span class="mono small">${when}</span></div>
    <h3>${esc(p.title)}</h3>${p.publish.error ? `<p style="color:var(--fail)">${esc(p.publish.error)}</p>` : ''}</div>`;
}
async function loadOverview(days) {
  const k = $('#kpis');
  const pc = $('#profile-card');
  try {
    const o = await api(`/api/ig/overview?days=${days}`);
    const pr = o.profile || {};
    pc.innerHTML = `${pr.profile_picture_url ? `<img src="${esc(pr.profile_picture_url)}" alt="" referrerpolicy="no-referrer" />` : ''}
      <div><h2>@${esc(pr.username)}</h2><div class="muted">${esc(pr.name || '')}</div>
      <div class="facts"><span><b>${fmtN(pr.followers_count)}</b>seguidores</span><span><b>${fmtN(pr.follows_count)}</b>seguindo</span><span><b>${fmtN(pr.media_count)}</b>publicações</span></div>
      ${o.publishingLimit ? `<div class="dim small" style="margin-top:6px">Publicações via API nas últimas 24h: ${o.publishingLimit.quota_usage} de ${o.publishingLimit.config?.quota_total ?? '—'}</div>` : ''}</div>`;
    const titles = { reach: 'Contas alcançadas', views: 'Visualizações', accounts_engaged: 'Contas engajadas', total_interactions: 'Interações', profile_views: 'Visitas ao perfil' };
    if (!o.metrics) { k.innerHTML = `<div class="notice warn">Métricas indisponíveis: ${esc(o.metricsError)}</div>`; return; }
    k.innerHTML = o.metrics.length
      ? o.metrics.map((m) => `<div class="m"><div class="v">${fmtN(m.value)}</div><div class="l">${esc(titles[m.name] || m.title)}</div></div>`).join('')
      : '<div class="empty">A API não retornou métricas para este período.</div>';
  } catch (e) {
    pc.innerHTML = e.code === 'nao_configurado'
      ? '<div><h2>@anselmo.tech</h2><div class="muted">Foto, seguidores e números da conta aparecem aqui quando a integração com o Instagram estiver ativa.</div><a class="btn sm" href="#/integracao" style="margin-top:12px">Configurar integração</a></div>'
      : `<div class="notice err" style="width:100%">${esc(e.message)}</div>`;
    k.innerHTML = '<div class="empty">As métricas aparecem quando a conexão com o Instagram estiver ativa.</div>';
  }
}

// ---------------- CONTEÚDO (kanban)
function renderConteudo() {
  const v = $('#view');
  const q = state.filter.q.toLowerCase();
  const list = state.posts.filter((p) => (!state.filter.format || p.format === state.filter.format)
    && (!q || `${p.title} ${p.caption} ${p.hook} ${p.pillar}`.toLowerCase().includes(q)));
  v.innerHTML = `
    <div class="toolbar">
      <input class="search" id="q" placeholder="Buscar…" value="${esc(state.filter.q)}" aria-label="Buscar" />
      <select id="ff" aria-label="Formato"><option value="">Todos os formatos</option>${FORMATS.map((f) => `<option value="${f.id}" ${state.filter.format === f.id ? 'selected' : ''}>${f.label}</option>`).join('')}</select>
      <span class="spacer"></span><span class="dim small hint-mouse">Arraste um card para a próxima etapa, ou mude o status no editor.</span><span class="dim small hint-touch">Deslize para o lado para ver as outras etapas.</span>
    </div>
    <div class="kanban ${state.posts.some((p) => p.publish.state === 'publicando') ? 'flowing' : ''}">
      ${STATUS.map((s) => {
        const items = list.filter((p) => p.status === s.id);
        return `<div class="col" data-col="${s.id}">
          <div class="col-head"><h2>${s.label}</h2><span class="count">${items.length}</span></div>
          <div class="col-list">${items.map(postCard).join('') || '<div class="dim small" style="padding:4px 2px">Nenhum post nesta etapa.</div>'}</div>
          ${s.id === 'ideia' ? '<button class="btn sm" data-new style="margin-top:10px">Nova ideia</button>' : ''}
        </div>`;
      }).join('')}
    </div>`;
  $('#q').addEventListener('input', (e) => { state.filter.q = e.target.value; renderConteudo(); $('#q').focus(); $('#q').setSelectionRange(99, 99); });
  $('#ff').addEventListener('change', (e) => { state.filter.format = e.target.value; renderConteudo(); });
  $$('[data-new]', v).forEach((b) => b.addEventListener('click', () => newPost()));
  $$('.pcard', v).forEach((c) => {
    c.addEventListener('click', () => openEditor(c.dataset.id));
    c.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', c.dataset.id));
  });
  $$('.col', v).forEach((col) => {
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drop'); });
    col.addEventListener('dragleave', () => col.classList.remove('drop'));
    col.addEventListener('drop', async (e) => {
      e.preventDefault(); col.classList.remove('drop');
      const id = e.dataTransfer.getData('text/plain');
      try { await savePost(id, { status: col.dataset.col }); renderConteudo(); } catch (err) { toast(err.message, 'err'); }
    });
  });
}
function postCard(p) {
  const when = p.publish.state === 'agendado' || p.publish.state === 'publicado' ? fmtDT(p.publish.scheduledAt || p.publish.publishedAt) : p.planDate ? p.planDate.split('-').reverse().join('/') : '';
  return `<article class="pcard" draggable="true" data-id="${p.id}">
    <div class="row"><span class="badge fmt">${formatLabel(p.format)}</span>${p.publish.state !== 'rascunho' ? `<span class="badge ${p.publish.state}">${PSTATE_LABEL[p.publish.state]}</span>` : ''}</div>
    <h3>${esc(p.title)}</h3><p>${esc(p.hook || p.caption || 'Sem texto ainda')}</p>
    <div class="meta">${p.pillar ? `<span>${esc(p.pillar)}</span>` : ''}${when ? `<span class="mono">${esc(when)}</span>` : ''}${p.mediaUrls?.length ? `<span>${p.mediaUrls.length} ${p.mediaUrls.length === 1 ? 'mídia' : 'mídias'}</span>` : ''}</div>
  </article>`;
}

// ---------------- CALENDÁRIO
function eventDate(p) {
  if (['agendado', 'publicando', 'publicado', 'erro'].includes(p.publish.state) && (p.publish.scheduledAt || p.publish.publishedAt))
    return { key: spDateKey(p.publish.publishedAt || p.publish.scheduledAt), real: true };
  if (p.planDate) return { key: p.planDate, real: false };
  return null;
}
function renderCalendario() {
  const v = $('#view');
  const now = spParts();
  if (!state.calMonth) state.calMonth = { y: +now.year, m: +now.month - 1 };
  const { y, m } = state.calMonth;
  const first = new Date(Date.UTC(y, m, 1));
  const startDow = first.getUTCDay();
  const daysIn = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const todayKey = `${now.year}-${now.month}-${now.day}`;
  const byDay = {};
  for (const p of state.posts) { const d = eventDate(p); if (d) (byDay[d.key] ||= []).push({ p, real: d.real }); }
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(Date.UTC(y, m, 1 - startDow + i));
    const key = d.toISOString().slice(0, 10);
    cells.push({ key, n: d.getUTCDate(), out: d.getUTCMonth() !== m });
  }
  const monthName = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(first);
  const evHtml = ({ p, real }) => `<div class="ev ${real ? p.publish.state : 'plan'}" data-id="${p.id}" title="${esc(p.title)}">${real && p.publish.scheduledAt ? `<span class="mono">${fmtDT(p.publish.publishedAt || p.publish.scheduledAt).split(' ')[1] || ''}</span> ` : ''}${esc(p.title)}</div>`;
  const monthKeys = Object.keys(byDay).filter((k) => k.startsWith(`${y}-${String(m + 1).padStart(2, '0')}`)).sort();
  v.innerHTML = `
    <div class="card">
      <div class="card-head">
        <div class="row"><button class="btn sm" id="prev" aria-label="Mês anterior">‹</button><h2 style="text-transform:capitalize;min-width:170px;text-align:center">${monthName}</h2><button class="btn sm" id="next" aria-label="Próximo mês">›</button><button class="btn sm ghost" id="today">Hoje</button></div>
        <div class="row small"><span class="badge agendado">agendado</span><span class="badge publicado">publicado</span><span class="badge erro">erro</span><span class="badge fmt">só planejado</span></div>
      </div>
      <div class="cal-head">${['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'].map((d) => `<div>${d}</div>`).join('')}</div>
      <div class="cal" style="margin-top:6px">
        ${cells.map((c) => `<div class="day ${c.out ? 'out' : ''} ${c.key === todayKey ? 'today' : ''}" data-day="${c.key}"><span class="n">${c.n}</span>${(byDay[c.key] || []).slice(0, 4).map(evHtml).join('')}${(byDay[c.key] || []).length > 4 ? `<span class="dim small">+${byDay[c.key].length - 4}</span>` : ''}</div>`).join('')}
      </div>
      <div class="agenda">
        ${monthKeys.length ? monthKeys.map((k) => `<div class="aday"><h3>${fmtDay(`${k}T12:00:00Z`)}</h3><div class="col-list">${byDay[k].map(evHtml).join('')}</div></div>`).join('') : '<div class="empty">Nada planejado neste mês.</div>'}
        <button class="btn" data-day="${todayKey}">+ Planejar para hoje</button>
      </div>
      <p class="dim small" style="margin:12px 0 0">Horários no fuso America/Sao_Paulo. Clique em um dia para planejar um post nele. Itens tracejados são só planejamento (não publicam sozinhos).</p>
    </div>`;
  const shift = (d) => { const t = new Date(Date.UTC(y, m + d, 1)); state.calMonth = { y: t.getUTCFullYear(), m: t.getUTCMonth() }; renderCalendario(); };
  $('#prev').onclick = () => shift(-1);
  $('#next').onclick = () => shift(1);
  $('#today').onclick = () => { state.calMonth = null; renderCalendario(); };
  $$('.ev', v).forEach((e) => e.addEventListener('click', (ev) => { ev.stopPropagation(); openEditor(e.dataset.id); }));
  $$('[data-day]', v).forEach((d) => d.addEventListener('click', () => newPost({ planDate: d.dataset.day, status: 'ideia' })));
}

// ---------------- RESULTADOS
async function renderResultados() {
  const v = $('#view');
  v.innerHTML = `${integrationNotice()}
    <div class="card"><div class="card-head"><h2>Visualizações por publicação</h2><span class="dim small">dados reais da API</span></div><div id="bars" class="bars"><div class="skeleton"></div></div></div>
    <div class="card"><div class="card-head"><h2>Publicações</h2></div><div id="mlist" class="media-list"><div class="skeleton"></div></div><div id="more"></div></div>`;
  loadMedia();
}
async function loadMedia(after) {
  const list = $('#mlist');
  try {
    const r = await api(`/api/ig/media?limit=12${after ? `&after=${encodeURIComponent(after)}` : ''}`);
    if (!after) list.innerHTML = '';
    if (!r.items.length && !after) { list.innerHTML = '<div class="empty">Nenhuma publicação encontrada.</div>'; $('#bars').innerHTML = ''; return; }
    for (const m of r.items) {
      const el = document.createElement('div');
      el.className = 'card';
      el.style.padding = '12px';
      const thumb = m.thumbnail_url || (m.media_type !== 'VIDEO' ? m.media_url : '');
      const type = m.media_product_type === 'REELS' ? 'Reels' : m.media_type === 'CAROUSEL_ALBUM' ? 'Carrossel' : m.media_type === 'VIDEO' ? 'Vídeo' : 'Imagem';
      el.innerHTML = `<div class="mrow">
        ${thumb ? `<img class="thumb" src="${esc(thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : '<div class="thumb"></div>'}
        <div><div class="row small"><span class="badge fmt">${type}</span><span class="dim mono">${fmtDT(m.timestamp)}</span></div><div class="cap">${esc(m.caption || '(sem legenda)')}</div>
        <div class="row small muted" style="margin-top:4px"><span>${fmtN(m.like_count)} curtidas</span><span>${fmtN(m.comments_count)} comentários</span><a href="${esc(m.permalink)}" target="_blank" rel="noopener">Abrir no Instagram</a></div></div>
        <div class="row"><button class="btn sm" data-ins>Métricas</button>${m.comments_count ? '<button class="btn sm ghost" data-com>Comentários</button>' : ''}</div>
      </div><div data-out></div>`;
      const out = $('[data-out]', el);
      $('[data-ins]', el).onclick = async (e) => {
        e.target.disabled = true;
        out.innerHTML = '<div class="skeleton" style="min-height:50px;margin-top:10px"></div>';
        try {
          const ins = await api(`/api/ig/media/${m.id}/insights?type=${m.media_product_type || ''}`);
          const t = { views: 'Visualizações', reach: 'Alcance', likes: 'Curtidas', comments: 'Comentários', saved: 'Salvos', shares: 'Compartilh.', total_interactions: 'Interações', ig_reels_avg_watch_time: 'Tempo médio' };
          out.innerHTML = `<div class="metric-grid">${ins.metrics.map((x) => `<div class="metric"><b>${x.name === 'ig_reels_avg_watch_time' ? `${(x.value / 1000).toFixed(1)}s` : fmtN(x.value)}</b><span>${t[x.name] || esc(x.title)}</span></div>`).join('')}</div>`;
        } catch (err) { out.innerHTML = `<div class="notice err" style="margin-top:10px">${esc(err.message)}</div>`; }
        e.target.disabled = false;
      };
      const cb = $('[data-com]', el);
      if (cb) cb.onclick = async () => {
        out.innerHTML = '<div class="skeleton" style="min-height:40px;margin-top:10px"></div>';
        try {
          const c = await api(`/api/ig/media/${m.id}/comments`);
          out.innerHTML = `<div style="margin-top:10px">${c.items.map((x) => `<div class="comment"><b>@${esc(x.username)}</b> ${esc(x.text)} <span class="dim mono small">${fmtDT(x.timestamp)}</span></div>`).join('') || '<div class="dim small">Sem comentários visíveis.</div>'}<p class="dim small">Somente leitura: o app não responde comentários.</p></div>`;
        } catch (err) { out.innerHTML = `<div class="notice err" style="margin-top:10px">${esc(err.message)}</div>`; }
      };
      list.append(el);
    }
    $('#more').innerHTML = r.hasNext && r.after ? '<button class="btn" style="margin-top:12px">Carregar mais</button>' : '';
    if (r.hasNext && r.after) $('#more button').onclick = () => loadMedia(r.after);
    if (!after) loadBars(r.items.slice(0, 8));
  } catch (e) {
    list.innerHTML = `<div class="notice err">${esc(e.message)}</div>`;
    $('#bars').innerHTML = '<div class="empty">Sem dados.</div>';
  }
}
async function loadBars(items) {
  const rows = [];
  for (const m of items) {
    try {
      const ins = await api(`/api/ig/media/${m.id}/insights?type=${m.media_product_type || ''}`);
      const views = ins.metrics.find((x) => x.name === 'views')?.value;
      if (views != null) rows.push({ label: (m.caption || '(sem legenda)').split('\n')[0].slice(0, 60), views, date: m.timestamp });
    } catch { /* ignora item sem métrica */ }
  }
  const max = Math.max(1, ...rows.map((r) => r.views));
  $('#bars').innerHTML = rows.length
    ? rows.map((r) => `<div class="bar"><span class="lbl" title="${esc(r.label)}">${esc(r.label)}</span><div class="track"><div class="fill" style="width:${(r.views / max) * 100}%"></div></div><span class="v">${fmtN(r.views)}</span></div>`).join('')
    : '<div class="empty">A API não retornou visualizações para as publicações.</div>';
}

// ---------------- INTEGRAÇÃO
async function renderIntegracao() {
  const v = $('#view');
  const c = state.config;
  const s = state.igStatus;
  const fstatus = { aceito: 'aceito (teste)', publicado: 'confirmado (publicado)', recusado: 'recusado', undefined: 'não verificado' };
  v.innerHTML = `
    <div class="grid two">
      <div class="card">
        <div class="card-head"><h2>Conexão com o Instagram</h2><button class="btn sm" id="recheck">Verificar de novo</button></div>
        ${s?.connected
          ? `<div class="notice ok"><span class="dot ok" style="display:inline-block"></span> Conectado como <b>@${esc(s.username)}</b> (conta ${esc(s.accountType || '')}) via Composio.</div>`
          : `<div class="notice ${s?.configured ? 'err' : 'warn'}">${esc(s?.message || 'Verificando…')}</div>`}
        <ul class="small muted" style="margin:14px 0 0;padding-left:18px">
          <li>IA: ${c.ai.enabled ? `Claude (${esc(c.ai.model)})` : 'gerador local (defina ANTHROPIC_API_KEY para usar Claude)'}</li>
          <li>Upload de mídia: ${c.upload.enabled ? 'Supabase Storage' : 'desligado. Cole URLs públicas ou configure o Supabase no .env'}</li>
          <li>Fuso do agendamento: ${esc(c.timezone)}</li>
        </ul>
      </div>
      <div class="card">
        <div class="card-head"><h2>Formatos na sua conta</h2></div>
        <table class="caps"><tbody>${c.formatRules ? Object.entries(c.formatRules).map(([k, r]) => `<tr><td><b>${formatLabel(k)}</b><div class="dim small">${esc(r.label)}</div></td><td><span class="badge ${c.formats[k]?.status === 'publicado' || c.formats[k]?.status === 'aceito' ? 'publicado' : c.formats[k]?.status === 'recusado' ? 'erro' : 'rascunho'}">${fstatus[c.formats[k]?.status]}</span>${c.formats[k]?.message ? `<div class="dim small">${esc(c.formats[k].message)}</div>` : ''}</td></tr>`).join('') : ''}</tbody></table>
        <p class="dim small">A confirmação de formato vem de “Testar formato” (no editor do post: cria um contêiner sem publicar) ou da primeira publicação bem-sucedida.</p>
      </div>
    </div>
    <div class="card">
      <div class="card-head"><h2>Ferramentas do Composio usadas</h2><span class="dim small">lista fixa no servidor; nenhuma outra é chamada</span></div>
      <table class="caps"><thead><tr><th>Ferramenta</th><th>Tipo</th><th>O que faz</th><th>No app</th></tr></thead><tbody>
        ${c.capabilities.map((x) => `<tr><td><code>${esc(x.slug)}</code></td><td>${x.kind === 'escrita' ? '<span class="badge erro">escrita</span>' : '<span class="badge pronto">leitura</span>'}</td><td>${esc(x.label)}</td><td>${x.used ? (x.confirm ? 'sim, só com sua confirmação' : 'sim') : '<span class="dim">não</span>'}</td></tr>`).join('')}
      </tbody></table>
    </div>
    <div class="card"><div class="card-head"><h2>Limitações reais</h2></div><ul class="small" style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:6px">${c.notAvailable.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
  $('#recheck').onclick = async () => { await loadStatus(); state.config = await api('/api/config'); renderIntegracao(); };
}

// ---------------- EDITOR
async function savePost(id, patch) {
  const r = await api(`/api/posts/${id}`, { method: 'PUT', body: patch });
  if (r._unscheduled) toast('O agendamento foi cancelado porque o conteúdo mudou. Confirme de novo.', 'warn');
  const i = state.posts.findIndex((p) => p.id === id);
  if (i >= 0) state.posts[i] = r;
  return r;
}
async function newPost(extra = {}) {
  try {
    const p = await api('/api/posts', { method: 'POST', body: { title: 'Nova ideia', ...extra } });
    state.posts.unshift(p);
    openEditor(p.id, 'conteudo');
  } catch (e) { toast(e.message, 'err'); }
}

let editor = null; // { id, tab, draft, dirty, ai }

function openEditor(id, tab = 'conteudo') {
  const p = state.posts.find((x) => x.id === id);
  if (!p) return toast('Post não encontrado.', 'err');
  editor = { id, tab, draft: structuredClone(p), dirty: false, ai: null };
  renderEditor();
  $('#drawer').hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeEditor(force = false) {
  if (!force && editor?.dirty && !window.confirm('Há alterações não salvas. Fechar mesmo assim?')) return;
  editor = null;
  $('#drawer').hidden = true;
  $('#drawer').innerHTML = '';
  document.body.style.overflow = '';
  route();
}

function renderEditor() {
  const d = editor.draft;
  const locked = d.publish.state === 'publicando';
  const tabs = [['conteudo', 'Conteúdo'], ['ia', 'Sugestões com IA'], ['roteiro', 'Roteiro'], ['publicar', 'Mídia e publicação'], ['historico', 'Histórico']];
  $('#drawer').innerHTML = `<div class="drawer-panel" role="dialog" aria-modal="true" aria-label="Editor de post">
    <div class="drawer-head">
      <input id="e-title" value="${esc(d.title)}" aria-label="Título" ${locked ? 'disabled' : ''} />
      <button class="btn sm ghost" id="e-close" aria-label="Fechar">✕</button>
    </div>
    ${publishRail(d.publish)}
    <div class="tabs">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${editor.tab === k ? 'active' : ''}">${l}</button>`).join('')}</div>
    <div class="drawer-work">
      <div class="drawer-body" id="e-body">${locked ? '<div class="notice warn">Publicação em andamento: edição bloqueada até o resultado.</div>' : ''}${TAB_RENDER[editor.tab](d, locked)}</div>
      ${feedPreview(d)}
    </div>
    <div class="drawer-foot">
      <button class="btn primary" id="e-save" ${locked ? 'disabled' : ''}>Salvar rascunho</button>
      <button class="btn" id="e-copy">Copiar legenda</button>
      <span class="dirty" id="e-dirty" hidden>Alterações não salvas</span>
      <span class="spacer"></span>
      <button class="btn ghost" id="e-dup">Duplicar</button>
      <button class="btn danger" id="e-del" ${locked ? 'disabled' : ''}>Excluir</button>
    </div></div>`;
  const root = $('#drawer');
  $('#e-close').onclick = () => closeEditor();
  root.onclick = (e) => { if (e.target === root) closeEditor(); };
  $$('[data-tab]', root).forEach((b) => (b.onclick = () => { collect(); editor.tab = b.dataset.tab; renderEditor(); }));
  $('#e-title').oninput = (e) => { d.title = e.target.value; editor.dirty = true; updatePreview(); };
  $('#e-save').onclick = saveDraft;
  $('#e-copy').onclick = () => { collect(); copy(buildCaption(d), 'Legenda'); };
  $('#e-dup').onclick = async () => {
    try { const c = await api(`/api/posts/${d.id}/duplicate`, { method: 'POST' }); state.posts.unshift(c); closeEditor(true); openEditor(c.id); toast('Rascunho duplicado.', 'ok'); } catch (e) { toast(e.message, 'err'); }
  };
  $('#e-del').onclick = async () => {
    if (!window.confirm('Excluir este post do app? (Não afeta o Instagram.)')) return;
    try { await api(`/api/posts/${d.id}`, { method: 'DELETE' }); state.posts = state.posts.filter((p) => p.id !== d.id); closeEditor(true); toast('Excluído do app.', 'ok'); } catch (e) { toast(e.message, 'err'); }
  };
  root.oninput = (e) => { if (e.target.dataset.f) { editor.dirty = true; collect(); updateCounters(); updatePreview(); } };
  TAB_BIND[editor.tab]?.(d, root);
  updateCounters();
  updatePreview();
}

// Trilho de etapas: mesma linguagem de nós e fios do pipeline do painel.
const RAIL = [['rascunho', 'Rascunho'], ['agendado', 'Agendado'], ['publicando', 'Publicando'], ['publicado', 'Publicado']];
function publishRail(pub) {
  const at = pub.state === 'erro' ? 2 : RAIL.findIndex(([k]) => k === pub.state);
  const note = pub.state === 'agendado' ? `Sai em ${fmtDT(pub.scheduledAt)}`
    : pub.state === 'publicando' ? `Agora: ${stepText(pub.step)}`
    : pub.state === 'erro' ? 'Não foi publicado. Veja o erro na aba Mídia e publicação.'
    : pub.state === 'publicado' ? `Publicado em ${fmtDT(pub.publishedAt)}` : 'Nada vai ao ar sem a sua confirmação.';
  const items = RAIL.map(([k, label], i) => {
    const cls = pub.state === 'erro' && i === 2 ? 'bad' : i < at ? 'done' : i === at ? (pub.state === 'publicado' ? 'done now' : 'now') : 'todo';
    return `${i ? `<li class="rail-wire ${i <= at ? 'on' : ''} ${pub.state === 'publicando' && i === 2 ? 'flowing' : ''}" aria-hidden="true"></li>` : ''}<li class="rail-node ${cls}" ${i === at ? 'aria-current="step"' : ''}><i></i>${pub.state === 'erro' && i === 2 ? 'Erro' : label}</li>`;
  }).join('');
  return `<div class="rail-bar"><ol class="rail" aria-label="Etapa da publicação">${items}</ol><span class="rail-note small ${pub.state === 'erro' ? 'bad' : 'muted'}">${esc(note)}</span></div>`;
}

// Prévia fixa ao lado do formulário. A mídia só renderiza ao abrir/trocar (evita recarregar vídeo a cada tecla).
const FOLD = 125; // o feed do Instagram mostra cerca de 125 caracteres antes de "mais"
function feedPreview(d) {
  const u = (d.mediaUrls || [])[0];
  const media = u ? `<div class="pv-media">${mediaTag(u)}${(d.mediaUrls || []).length > 1 ? `<span class="pv-count">1/${d.mediaUrls.length}</span>` : ''}</div>` : '<div class="pv-media empty-media">Sem mídia. Adicione na aba Mídia e publicação.</div>';
  return `<aside class="pv" aria-label="Prévia no feed">
    <div class="pv-frame">
      <div class="pv-head"><img src="/logo.svg" width="22" height="22" alt="" /><b>@anselmo.tech</b><span class="spacer"></span><span class="dim small">${esc(formatLabel(d.format))}</span></div>
      ${media}
      <div class="pv-cap" id="pv-cap"></div>
    </div>
    <p class="pv-legend small muted" id="pv-legend"></p>
  </aside>`;
}
function updatePreview() {
  if (!editor) return;
  const d = editor.draft;
  const dirty = $('#e-dirty');
  if (dirty) dirty.hidden = !editor.dirty;
  const cap = $('#pv-cap');
  if (!cap) return;
  if (d.format === 'stories') {
    cap.textContent = 'Stories não mostram legenda.';
    cap.className = 'pv-cap dim';
    $('#pv-legend').textContent = '';
    return;
  }
  const full = buildCaption(d);
  cap.className = 'pv-cap';
  if (!full) { cap.innerHTML = '<span class="dim">Sem legenda.</span>'; $('#pv-legend').textContent = ''; return; }
  if (full.length <= FOLD) {
    cap.innerHTML = `<span>${esc(full)}</span>`;
    $('#pv-legend').textContent = `Legenda inteira visível (${full.length} de ${FOLD} letras antes do “mais”).`;
    return;
  }
  // corta na última palavra inteira antes do limite
  const cut = full.lastIndexOf(' ', FOLD) > FOLD * 0.6 ? full.lastIndexOf(' ', FOLD) : FOLD;
  cap.innerHTML = `<span>${esc(full.slice(0, cut))}</span><span class="pv-fold">… mais</span><span class="pv-rest">${esc(full.slice(cut))}</span>`;
  $('#pv-legend').textContent = `O feed mostra cerca de ${FOLD} letras. O que está apagado só aparece depois de tocar em “mais”. Coloque o gancho antes da linha.`;
}

// Lê os campos do formulário para o rascunho em memória.
function collect() {
  if (!editor) return;
  const d = editor.draft;
  $$('[data-f]', $('#drawer')).forEach((el) => {
    const f = el.dataset.f;
    if (f === 'hashtags') d.hashtags = el.value.split(/[\s,]+/).map((h) => h.replace(/^#+/, '')).filter(Boolean).map((h) => `#${h}`);
    else d[f] = el.value;
  });
}
function updateCounters() {
  const cap = $('[data-f="caption"]');
  const tags = $('[data-f="hashtags"]');
  if (cap) { const c = $('#cnt-cap'); const n = cap.value.length; c.textContent = `${n}/2200`; c.classList.toggle('over', n > 2200); }
  if (tags) { const n = tags.value.split(/[\s,]+/).filter(Boolean).length; const c = $('#cnt-tag'); c.textContent = `${n}/30 hashtags`; c.classList.toggle('over', n > 30); }
}
async function saveDraft() {
  collect();
  const d = editor.draft;
  try {
    const r = await savePost(d.id, {
      title: d.title, format: d.format, status: d.status, pillar: d.pillar, planDate: d.planDate || null, hook: d.hook, caption: d.caption,
      cta: d.cta, hashtags: d.hashtags, script: d.script, notes: d.notes, altText: d.altText, mediaUrls: d.mediaUrls,
    });
    editor.draft = structuredClone(r);
    editor.dirty = false;
    toast('Rascunho salvo.', 'ok');
    renderEditor();
    return r;
  } catch (e) { toast(e.message, 'err'); return null; }
}

const TAB_RENDER = {
  conteudo: (d, locked) => `<div class="form-grid">
    <label class="f">Formato<select data-f="format" ${locked ? 'disabled' : ''}>${FORMATS.map((f) => `<option value="${f.id}" ${d.format === f.id ? 'selected' : ''}>${f.label}</option>`).join('')}</select></label>
    <label class="f">Status editorial<select data-f="status">${STATUS.map((s) => `<option value="${s.id}" ${d.status === s.id ? 'selected' : ''}>${s.label}</option>`).join('')}</select></label>
    <label class="f">Pilar / tema<input data-f="pillar" value="${esc(d.pillar)}" placeholder="ex.: n8n, IA, dados, carreira" /></label>
    <label class="f">Data planejada (calendário)<input type="date" data-f="planDate" value="${esc(d.planDate || '')}" /></label>
    <label class="f full">Gancho (primeiros 2 segundos)<input data-f="hook" value="${esc(d.hook)}" placeholder="Frase de abertura" /></label>
    <label class="f full">Legenda<textarea data-f="caption" rows="8" placeholder="Texto da legenda">${esc(d.caption)}</textarea><span class="counter" id="cnt-cap"></span></label>
    <label class="f full">Chamada para ação (CTA)<input data-f="cta" value="${esc(d.cta)}" placeholder="ex.: Comente AUTOMAÇÃO que eu te mando o fluxo" /></label>
    <label class="f full">Hashtags<textarea data-f="hashtags" rows="2" placeholder="#automacao #n8n">${esc((d.hashtags || []).join(' '))}</textarea><span class="counter" id="cnt-tag"></span></label>
    <label class="f full">Notas internas<textarea data-f="notes" rows="3">${esc(d.notes)}</textarea></label>
  </div>`,
  ia: (d) => `<div class="ai-box">
    <h3><svg viewBox="0 0 24 24" style="color:var(--wire)"><path d="M12 2l2.2 6.3L20 10l-5.8 1.7L12 18l-2.2-6.3L4 10l5.8-1.7zM19 15l1 3 3 1-3 1-1 3-1-3-3-1 3-1z"/></svg>Assistente de conteúdo</h3>
    <div class="form-grid">
      <label class="f full">Tema<input id="ai-topic" value="${esc(d.pillar || d.title)}" placeholder="ex.: automatizar respostas no WhatsApp com n8n" /></label>
      <label class="f">Objetivo<select id="ai-goal"><option>educar e gerar engajamento</option><option>gerar leads (comentários e DMs)</option><option>autoridade técnica</option><option>divulgar um projeto ou serviço</option></select></label>
      <label class="f">Público<input id="ai-aud" value="profissionais e pessoas interessadas em tecnologia" /></label>
      <label class="f full">Detalhes (opcional)<textarea id="ai-det" rows="2" placeholder="pontos que precisam aparecer, ferramenta usada, exemplo real…"></textarea></label>
    </div>
    <div class="row"><button class="btn ai" id="ai-go">Gerar sugestões</button><span class="dim small" id="ai-src"></span></div>
    <div id="ai-out">${editor.ai ? aiResults(editor.ai) : ''}</div>
  </div>`,
  roteiro: (d) => `<label class="f">Roteiro do Reels (cenas, falas, texto na tela)<textarea data-f="script" rows="14" placeholder="0-3s | fala | tela">${esc(d.script)}</textarea></label>
    <p class="dim small">Dica: gere um roteiro na aba IA e clique em “Usar roteiro”.</p>`,
  publicar: (d, locked) => publishTab(d, locked),
  historico: (d) => {
    const a = [...(d.publish.attempts || [])].reverse();
    return a.length ? `<div class="timeline">${a.map((x) => `<div class="tl ${x.ok ? '' : 'bad'}"><time>${fmtDT(x.at)}</time>${esc(x.message)}${x.response ? `<div><code>${esc(JSON.stringify(x.response))}</code></div>` : ''}</div>`).join('')}</div>`
      : '<div class="empty">Sem eventos de publicação ainda.</div>';
  },
};

function aiResults(r) {
  const sug = (txt, apply, label = 'Usar') => `<div class="sug"><div class="txt">${esc(txt)}</div><button class="btn sm" data-apply='${esc(JSON.stringify(apply))}'>${label}</button></div>`;
  return `${r.warning ? `<div class="notice warn">${esc(r.warning)}</div>` : ''}
    <h3 style="margin-top:6px">Ganchos</h3><div class="sugs">${r.ganchos.map((g) => sug(g, { hook: g })).join('')}</div>
    <h3>Legendas</h3><div class="sugs">${r.legendas.map((l) => sug(l, { caption: l })).join('')}</div>
    <h3>Chamadas para ação</h3><div class="sugs">${r.ctas.map((c) => sug(c, { cta: c })).join('')}</div>
    <h3>Hashtags <button class="btn sm" data-apply='${esc(JSON.stringify({ hashtags: r.hashtags.map((h) => `#${h}`) }))}'>Usar todas</button></h3>
    <div class="chips">${r.hashtags.map((h) => `<span class="chip" data-tag="#${esc(h)}">#${esc(h)}</span>`).join('')}</div>
    ${r.roteiro?.length ? `<h3>Roteiro de Reels <button class="btn sm" data-apply='${esc(JSON.stringify({ script: r.roteiro.map((s) => `${s.tempo} | ${s.fala} | ${s.tela}`).join('\n') }))}'>Usar roteiro</button></h3>
      <div>${r.roteiro.map((s) => `<div class="scene"><b>${esc(s.tempo)}</b><span>${esc(s.fala)}</span><span class="muted">${esc(s.tela)}</span></div>`).join('')}</div>` : ''}`;
}

const TAB_BIND = {
  ia: (d, root) => {
    $('#ai-go').onclick = async (e) => {
      collect();
      e.target.disabled = true; e.target.textContent = 'Gerando…';
      try {
        const r = await api('/api/ai/suggest', { method: 'POST', body: { topic: $('#ai-topic').value, goal: $('#ai-goal').value, audience: $('#ai-aud').value, details: $('#ai-det').value, format: d.format, caption: d.caption } });
        editor.ai = r;
        $('#ai-out').innerHTML = aiResults(r);
        $('#ai-src').textContent = r.source === 'claude' ? `Fonte: Claude (${r.model})` : 'Fonte: gerador local (sem IA externa)';
        bindAi(d, root);
      } catch (err) { toast(err.message, 'err'); }
      e.target.disabled = false; e.target.textContent = 'Gerar sugestões';
    };
    bindAi(d, root);
  },
  publicar: bindPublish,
};
function bindAi(d, root) {
  $$('[data-apply]', root).forEach((b) => (b.onclick = () => {
    Object.assign(d, JSON.parse(b.dataset.apply));
    editor.dirty = true;
    updatePreview();
    toast('Aplicado ao rascunho (lembre de salvar).', 'ok');
  }));
  $$('[data-tag]', root).forEach((c) => (c.onclick = () => {
    const t = c.dataset.tag;
    d.hashtags = d.hashtags.includes(t) ? d.hashtags.filter((x) => x !== t) : [...d.hashtags, t];
    c.classList.toggle('on', d.hashtags.includes(t));
    editor.dirty = true;
    updatePreview();
  }));
  $$('[data-tag]', root).forEach((c) => c.classList.toggle('on', d.hashtags.includes(c.dataset.tag)));
}

// ---------------- PUBLICAÇÃO
function publishTab(d, locked) {
  const pub = d.publish;
  const fmtInfo = state.config.formats[d.format];
  const rule = state.config.formatRules[d.format];
  const statusBox = {
    rascunho: '<div class="notice">Rascunho: nada será publicado até você confirmar.</div>',
    agendado: `<div class="notice warn">Agendado para <b>${fmtDT(pub.scheduledAt)}</b> (America/Sao_Paulo). O servidor publica sozinho nesse horário, mesmo com o navegador fechado (o servidor precisa estar ligado).</div>`,
    publicando: `<div class="notice warn">Publicando… etapa: <b>${esc(stepText(pub.step))}</b>. Esta tela atualiza sozinha.</div>`,
    publicado: `<div class="notice ok">Publicado e confirmado em ${fmtDT(pub.publishedAt)}. ${pub.igMediaId ? `ID: <span class="mono">${esc(pub.igMediaId)}</span>.` : ''} ${pub.permalink ? `<a href="${esc(pub.permalink)}" target="_blank" rel="noopener">Abrir no Instagram</a>` : ''}</div>`,
    erro: `<div class="notice err"><b>Erro${pub.errorCode ? ` (${esc(pub.errorCode)})` : ''}:</b> ${esc(pub.error)}</div>`,
  }[pub.state];
  return `${statusBox}
    <div class="card" style="padding:14px">
      <div class="card-head"><h3>${esc(rule?.label || d.format)}</h3>
        <span class="badge ${fmtInfo?.status === 'publicado' || fmtInfo?.status === 'aceito' ? 'publicado' : fmtInfo?.status === 'recusado' ? 'erro' : 'rascunho'}">${fmtInfo?.status ? `formato ${fmtInfo.status}` : 'formato não verificado'}</span></div>
      <div class="media-urls" id="m-list">${(d.mediaUrls || []).map((u, i) => `<div class="murl">${mediaTag(u, 'thumb')}<span class="mono small" style="word-break:break-all">${esc(u)}</span><button class="btn sm ghost" data-rm="${i}" ${locked ? 'disabled' : ''} aria-label="Remover">✕</button></div>`).join('') || '<div class="dim small">Nenhuma mídia.</div>'}</div>
      <div class="row" style="margin-top:10px">
        <input id="m-url" placeholder="https://… (URL pública .jpg ou .mp4)" style="flex:1;min-width:200px" ${locked ? 'disabled' : ''} />
        <button class="btn sm" id="m-add" ${locked ? 'disabled' : ''}>Adicionar URL</button>
        ${state.config.upload.enabled ? `<label class="btn sm" ${locked ? 'style="pointer-events:none;opacity:.5"' : ''}>Enviar arquivo<input type="file" id="m-file" accept="image/jpeg,video/mp4,video/quicktime" hidden /></label>` : ''}
      </div>
      <p class="dim small">O Instagram busca a mídia pela URL: precisa ser pública e direta (JPEG para imagem; MP4/MOV para vídeo). Links de página do Google Drive não funcionam.${state.config.upload.enabled ? '' : ' Para enviar arquivos do computador, configure o Supabase Storage no .env.'}</p>
      ${d.format === 'imagem' || d.format === 'carrossel' ? `<label class="f">Texto alternativo (acessibilidade, opcional)<input data-f="altText" value="${esc(d.altText)}" ${locked ? 'disabled' : ''} /></label>` : ''}
    </div>
    <div class="card" style="padding:14px">
      <h3>Publicar ou agendar</h3>
      <div class="row" style="margin-top:10px">
        <label class="f" style="flex:1;min-width:200px">Data e horário (America/Sao_Paulo)<input type="datetime-local" id="p-when" value="${esc(pub.scheduledLocal || defaultSchedule(d.planDate))}" ${locked ? 'disabled' : ''} /></label>
      </div>
      <div class="row" style="margin-top:12px">
        ${pub.state === 'agendado' ? '<button class="btn danger" id="p-cancel">Cancelar agendamento</button>' : ''}
        ${['rascunho', 'erro', 'agendado'].includes(pub.state) ? `<button class="btn primary" id="p-sched">${pub.state === 'agendado' ? 'Reagendar…' : 'Agendar…'}</button><button class="btn" id="p-now">Publicar agora…</button>` : ''}
        ${pub.state !== 'publicando' ? '<button class="btn ghost" id="p-test">Testar formato…</button>' : ''}
        ${(pub.containerId || pub.publishAttemptAt) && pub.state !== 'publicando' ? '<button class="btn ghost" id="p-verify">Verificar resultado</button>' : ''}
      </div>
      <p class="dim small">Toda publicação passa por prévia e confirmação digitada. “Testar formato” só cria um contêiner no Instagram para ver se o formato é aceito na sua conta, sem publicar nada.</p>
    </div>
    <div class="card" style="padding:14px">
      <h3>Publicação manual</h3>
      <p class="small muted">Prefere postar pelo app do Instagram? Copie o texto e marque como publicado.</p>
      <div class="row"><button class="btn sm" id="c-all">Copiar legenda completa</button><button class="btn sm ghost" id="c-tags">Copiar hashtags</button><button class="btn sm ghost" id="c-done" ${d.status === 'publicado' ? 'disabled' : ''}>Marcar como publicado (manual)</button></div>
    </div>`;
}
function stepText(s) {
  return { criando_container: 'criando contêiner de mídia', aguardando_processamento: 'Instagram processando a mídia', publicando_container: 'publicando', verificando: 'verificando o resultado' }[s] || s || '—';
}

function bindPublish(d) {
  const add = (u) => {
    u = u.trim();
    if (!/^https?:\/\//i.test(u)) return toast('Informe uma URL começando com https://', 'warn');
    d.mediaUrls = [...(d.mediaUrls || []), u].slice(0, 10);
    editor.dirty = true;
    collect(); renderEditor();
  };
  $('#m-add') && ($('#m-add').onclick = () => add($('#m-url').value));
  $$('[data-rm]').forEach((b) => (b.onclick = () => { collect(); d.mediaUrls.splice(+b.dataset.rm, 1); editor.dirty = true; renderEditor(); }));
  const file = $('#m-file');
  if (file) file.onchange = async () => {
    const f = file.files[0];
    if (!f) return;
    toast(`Enviando ${f.name}…`);
    try {
      const r = await api('/api/upload', { method: 'POST', body: f, headers: { 'Content-Type': f.type, 'X-Filename': encodeURIComponent(f.name) } });
      add(r.url);
      toast('Arquivo enviado. Salve o rascunho.', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  };
  const go = (mode) => async () => {
    const when = mode === 'agendar' ? $('#p-when')?.value : null; // lê antes de salvar (salvar re-renderiza)
    if (mode === 'agendar' && !when) return toast('Escolha data e horário.', 'warn');
    collect();
    if (editor.dirty) { const saved = await saveDraft(); if (!saved) return; }
    startPublishFlow(mode, when);
  };
  $('#p-sched') && ($('#p-sched').onclick = go('agendar'));
  $('#p-now') && ($('#p-now').onclick = go('agora'));
  $('#p-test') && ($('#p-test').onclick = go('teste'));
  $('#p-cancel') && ($('#p-cancel').onclick = async () => {
    try { const r = await api(`/api/posts/${d.id}/publish/cancel`, { method: 'POST' }); if (!r.ok) throw new Error(r.error); updateLocal(r.post); toast('Agendamento cancelado.', 'ok'); } catch (e) { toast(e.message, 'err'); }
  });
  $('#p-verify') && ($('#p-verify').onclick = async (e) => {
    e.target.disabled = true;
    try { const r = await api(`/api/posts/${d.id}/publish/verify`, { method: 'POST' }); if (r.post) updateLocal(r.post); toast(r.message || r.error, r.ok ? 'ok' : 'err'); } catch (err) { toast(err.message, 'err'); }
    e.target.disabled = false;
  });
  $('#c-all').onclick = () => { collect(); copy(buildCaption(d), 'Legenda'); };
  $('#c-tags').onclick = () => { collect(); copy((d.hashtags || []).join(' '), 'Hashtags'); };
  $('#c-done').onclick = async () => {
    if (!window.confirm('Marcar como publicado manualmente? (Só muda o status no app.)')) return;
    try { const r = await savePost(d.id, { status: 'publicado' }); editor.draft = structuredClone(r); renderEditor(); } catch (e) { toast(e.message, 'err'); }
  };
}

function updateLocal(post) {
  const i = state.posts.findIndex((p) => p.id === post.id);
  if (i >= 0) state.posts[i] = post;
  if (editor?.id === post.id && !editor.dirty) { editor.draft = structuredClone(post); renderEditor(); }
}

async function startPublishFlow(mode, scheduledLocal) {
  const d = editor.draft;
  if (mode === 'agendar' && !scheduledLocal) return;
  openModal('<div class="skeleton" style="min-height:200px"></div><p class="muted small">Validando mídia, conexão e cota…</p>');
  let r;
  try {
    r = await api(`/api/posts/${d.id}/publish/prepare`, { method: 'POST', body: { mode, scheduledLocal } });
  } catch (e) { return modalError(e.message); }
  if (r.alreadyPublished && r.post) updateLocal(r.post);
  const pv = r.preview;
  const title = { agora: 'Publicar agora', agendar: 'Agendar publicação', teste: 'Testar formato (não publica)' }[mode];
  const media = pv?.mediaUrls?.length ? `<div class="ph-media">${pv.media.map((m) => (m.kind === 'video' ? `<video src="${esc(m.url)}" controls playsinline preload="metadata"></video>` : `<img src="${esc(m.url)}" alt="" referrerpolicy="no-referrer" />`)).join('') || pv.mediaUrls.map((u) => mediaTag(u)).join('')}</div>` : '<div class="empty" style="border:0">Sem mídia</div>';
  const reach = { agora: 'Vai ao ar em segundos', agendar: 'Vai ao ar no horário marcado', teste: 'Não vai ao ar' }[mode];
  openModal(`
    <div class="cf-strip ${mode === 'teste' ? 'off' : 'live'}">${reach}</div>
    <h2>${title}</h2>
    ${r.errors?.length ? `<div class="notice err"><b>Não é possível continuar:</b><ul>${r.errors.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
    ${r.warnings?.length ? `<div class="notice warn"><b>Atenção:</b><ul>${r.warnings.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
    ${pv ? `<div class="phone"><div class="ph-head"><img src="/logo.svg" width="24" height="24" alt="" />${esc(pv.account || '@anselmo.tech')}<span class="spacer"></span><span class="muted small">${esc(pv.formatLabel)}</span></div>${media}${pv.format !== 'stories' ? `<div class="ph-cap">${esc(pv.caption || '(sem legenda)')}</div>` : ''}</div>
      <div class="small"><b>Quando:</b> ${mode === 'teste' ? 'agora (somente teste, sem publicar)' : esc(pv.scheduledHuman || 'agora')}</div>` : ''}
    ${r.ok ? `<label class="f">Para confirmar, digite <b class="confirm-word">${esc(r.confirmWord)}</b>
        <span class="cells" id="cf-cells" aria-hidden="true">${[...r.confirmWord].map((ch) => `<i>${esc(ch)}</i>`).join('')}</span>
        <input class="confirm-input" id="cf-word" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="${r.confirmWord.length + 4}" /></label>
      <p class="dim small">${mode === 'agora' ? 'A publicação entra na fila do servidor e começa em segundos.' : mode === 'agendar' ? 'O servidor publicará sozinho no horário. Se você editar o conteúdo depois, o agendamento é desfeito.' : 'Será criado um contêiner de mídia no Instagram, que não aparece no perfil e expira em até 24h.'}</p>` : ''}
    <div class="row end"><button class="btn ghost" id="cf-cancel">${r.ok ? 'Cancelar' : 'Fechar'}</button>${r.ok ? `<button class="btn primary" id="cf-go" disabled>${title}</button>` : ''}</div>`);
  $('#cf-cancel').onclick = closeModal;
  if (!r.ok) return;
  const inp = $('#cf-word');
  inp.focus();
  inp.oninput = () => {
    const typed = inp.value.trim().toUpperCase();
    $$('#cf-cells i').forEach((c, i) => { c.className = typed[i] === undefined ? '' : typed[i] === r.confirmWord[i] ? 'ok' : 'bad'; });
    $('#cf-go').disabled = typed !== r.confirmWord;
  };
  $('#cf-go').onclick = async (e) => {
    e.target.disabled = true; e.target.textContent = mode === 'teste' ? 'Testando (até 90 s)…' : 'Confirmando…';
    try {
      const c = await api(`/api/posts/${d.id}/publish/confirm`, { method: 'POST', body: { token: r.token, confirmText: inp.value } });
      if (!c.ok) throw new Error(c.error);
      closeModal();
      if (mode === 'teste') {
        state.config = await api('/api/config');
        toast(c.test.message, c.test.result === 'aceito' ? 'ok' : 'warn');
        renderEditor();
        return;
      }
      updateLocal(c.post);
      toast(mode === 'agora' ? 'Confirmado. Entrou na fila; acompanhe o status aqui.' : `Agendado para ${fmtDT(c.post.publish.scheduledAt)}. Ainda não publicado.`, 'ok');
      startPolling();
    } catch (err) {
      modalError(err.message);
    }
  };
}
function openModal(html) { const m = $('#modal'); m.innerHTML = `<div class="modal-box">${html}</div>`; m.hidden = false; m.onclick = (e) => { if (e.target === m) closeModal(); }; }
function closeModal() { $('#modal').hidden = true; $('#modal').innerHTML = ''; }
function modalError(msg) { openModal(`<h2>Não foi possível concluir</h2><div class="notice err">${esc(msg)}</div><p class="small muted">Nada foi publicado.</p><div class="row end"><button class="btn" id="cf-close">Fechar</button></div>`); $('#cf-close').onclick = closeModal; }

// ---------------- acompanhamento da fila
let pollTimer = null;
function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    const before = new Map(state.posts.map((p) => [p.id, p.publish.state]));
    try { await loadPosts(); } catch { return; }
    for (const p of state.posts) {
      const prev = before.get(p.id);
      if (prev && prev !== p.publish.state) {
        if (p.publish.state === 'publicado') toast(`“${p.title}” publicado e confirmado pelo Instagram.`, 'ok');
        if (p.publish.state === 'erro') toast(`“${p.title}”: ${p.publish.error}`, 'err');
        if (p.publish.state === 'publicando') toast(`“${p.title}”: publicação iniciada.`);
      }
    }
    if (editor) { const cur = state.posts.find((p) => p.id === editor.id); if (cur && !editor.dirty && JSON.stringify(cur.publish) !== JSON.stringify(editor.draft.publish)) { editor.draft = structuredClone(cur); renderEditor(); } }
    else if (['painel', 'conteudo', 'calendario'].includes(state.route) && $('#modal').hidden) VIEWS[state.route].render();
    if (!state.posts.some((p) => ['agendado', 'publicando'].includes(p.publish.state))) { clearInterval(pollTimer); pollTimer = null; }
  }, 5000);
}

// ---------------- init
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (!$('#modal').hidden) closeModal(); else if (editor) closeEditor(); } });
$('#btn-new').onclick = () => newPost();
(async function init() {
  try {
    state.config = await api('/api/config');
    await loadPosts();
  } catch (e) {
    $('#view').innerHTML = `<div class="notice err">Não foi possível falar com o servidor: ${esc(e.message)}</div>`;
    return;
  }
  route();
  loadStatus().then(() => { if (state.route === 'integracao' || (!state.igStatus?.connected && ['painel', 'resultados'].includes(state.route))) route(); });
  if (state.posts.some((p) => ['agendado', 'publicando'].includes(p.publish.state))) startPolling();
})();
