// Ssenariychi Mini App — core (inlined into index.html by tools/build.mjs).
// First paint never waits for the network or the Telegram SDK: the screen is drawn from data already on
// the device, then small requests (304 when nothing changed) refresh it in the background.
// Team and admin screens are separate chunks, loaded on demand.
'use strict';
(() => {
  const CHUNKS = __CHUNKS__;
  const root = document.getElementById('app');
  const qs = new URLSearchParams(location.search);
  const launch = new URLSearchParams(location.hash.slice(1));
  let tg = null;
  let initData = launch.get('tgWebAppData') || '';
  try {
    initData ||= JSON.parse(sessionStorage.getItem('__telegram__initParams') || '{}').tgWebAppData || '';
  } catch {}
  const devId = !initData && (qs.get('dev') || (() => { try { return localStorage.getItem('dev'); } catch { return null; } })());
  if (qs.get('dev')) try { localStorage.setItem('dev', qs.get('dev')); } catch {}

  // ---------------------------------------------------------------- tiny helpers
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const I = (n, c = '') => `<svg class="i ${c}"><use href="#i-${n}"/></svg>`;
  const P = (n, c = '') => `<svg class="i ${c}"><use href="#p-${n}"/></svg>`;
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseYmd = (s) => new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  const today = () => ymd(new Date());
  const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
  const MONTHS = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'];
  const MON = ['yan', 'fev', 'mar', 'apr', 'may', 'iyn', 'iyl', 'avg', 'sen', 'okt', 'noy', 'dek'];
  const WD = ['Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh', 'Ya'];
  const WDF = ['Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba'];
  const fmtDay = (s) => {
    const t = today();
    if (s === t) return 'Bugun';
    if (s === addDays(t, 1)) return 'Ertaga';
    if (s === addDays(t, -1)) return 'Kecha';
    const d = parseYmd(s);
    return `${d.getDate()} ${MON[d.getMonth()]}${d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : ''}`;
  };
  const fmtDayLong = (s) => { const d = parseYmd(s); return `${WDF[d.getDay()]} · ${d.getDate()} ${MONTHS[d.getMonth()].toLowerCase()}`; };
  const fmtDate = (t) => { const d = new Date(t); return `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`; };
  const fmtDT = (t) => { const d = new Date(t); return `${fmtDay(ymd(d))}, ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const ago = (t) => {
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 2) return 'hozir';
    if (m < 60) return `${m} daq oldin`;
    if (m < 1440) return `${Math.round(m / 60)} soat oldin`;
    return `${Math.round(m / 1440)} kun oldin`;
  };
  const money = (n) => `${String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} so‘m`;
  const initials = (n) => esc((n || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase());

  const PLATFORMS = { instagram: ['Instagram', 'IG'], telegram: ['Telegram', 'TG'], tiktok: ['TikTok', 'TT'], youtube: ['YouTube', 'YT'], facebook: ['Facebook', 'FB'], x: ['X', 'X'], linkedin: ['LinkedIn', 'IN'], other: ['Boshqa', '··'] };
  const KINDS = { post: 'Post', reels: 'Reels', story: 'Story', carousel: 'Karusel', video: 'Video', shorts: 'Shorts', article: 'Maqola', live: 'Efir' };
  const STATUS = { idea: ['G‘oya', 0], draft: ['Jarayonda', 0.25], review: ['Tekshiruvda', 0.5], ready: ['Tayyor', 0.75], published: ['Chiqdi', 1] };
  const PICONS = ['spark', 'coffee', 'camera', 'bag', 'heart', 'star', 'bolt', 'globe', 'music', 'book', 'home', 'rocket', 'gem', 'leaf', 'film', 'trophy', 'fire', 'smile', 'mic', 'gym', 'shirt', 'food', 'code', 'edu', 'tag', 'car', 'paw', 'plane'];
  const COLORS = ['#b4533c', '#c25450', '#a1477a', '#6b4f9e', '#3a5a9a', '#2f6f73', '#5f7f4f', '#c08a2e', '#8b7d6b'];

  const ring = (s) => {
    const f = STATUS[s]?.[1] ?? 0;
    if (f >= 1) return '<svg class="ring" viewBox="0 0 20 20"><circle class="full" cx="10" cy="10" r="9"/><path d="M6.2 10.3l2.5 2.4 5-5"/></svg>';
    const c = 2 * Math.PI * 8;
    return `<svg class="ring" viewBox="0 0 20 20"><circle class="bg" cx="10" cy="10" r="8"${f ? '' : ' stroke-dasharray="2 3"'}/>${f ? `<circle class="fg" cx="10" cy="10" r="8" stroke-dasharray="${(f * c).toFixed(1)} ${c.toFixed(1)}"/>` : ''}</svg>`;
  };
  const projIcon = (p, size = '') => `<span class="picon ${size} ${p.color ? 'c' : ''}"${p.color ? ` style="--pc:${esc(p.color)}"` : ''}>${P(p.icon || 'spark', size === 'lg' ? 'l' : '')}</span>`;

  // ---------------------------------------------------------------- storage (device cache)
  const LS = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); } catch {
        // storage full: drop cached projects (they come back from the server with one request)
        try { for (const key of Object.keys(localStorage)) if (key.startsWith('p:')) localStorage.removeItem(key); localStorage.setItem(k, JSON.stringify(v)); } catch {}
      }
    },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };
  const remember = (k) => { // keep at most 15 projects on the device (most recently opened)
    const list = (LS.get('pk') || []).filter((x) => x !== k);
    list.unshift(k);
    for (const old of list.splice(15)) LS.del(old);
    LS.set('pk', list);
  };

  // ---------------------------------------------------------------- network
  const auth = () => (initData ? `tma ${initData}` : devId ? `dev ${devId} Dev ${devId}` : '');
  async function api(method, path, body, etag) {
    const headers = { authorization: auth() };
    if (body) headers['content-type'] = 'application/json';
    if (etag) headers['if-none-match'] = etag;
    let r;
    try {
      r = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
    } catch {
      throw Object.assign(new Error('Internet bilan aloqa yo‘q'), { offline: true });
    }
    if (r.status === 304) return { $304: true };
    const isJson = (r.headers.get('content-type') || '').includes('json');
    const j = isJson ? await r.json().catch(() => ({})) : {};
    if (r.ok && !isJson) throw Object.assign(new Error('Server noto‘g‘ri javob berdi'), { status: r.status });
    if (!r.ok) throw Object.assign(new Error(j.error || 'Xatolik yuz berdi'), { status: r.status, upgrade: j.upgrade });
    j.$etag = r.headers.get('etag');
    return j;
  }
  /** GET with the device copy: sends its ETag, keeps it on 304. */
  async function cached(key, path) {
    let c = LS.get(key);
    if (key === 'boot' && !Array.isArray(c?.data?.projects)) c = null; // broken copy → full fetch
    const r = await api('GET', path, null, c?.etag);
    if (r.$304 && c) return c.data;
    const etag = r.$etag;
    delete r.$etag;
    if (etag) LS.set(key, { etag, data: r });
    return r;
  }

  // ---------------------------------------------------------------- state
  const S = {
    // a device copy without a projects list is broken (e.g. cached from a bad response) — ignore it
    boot: Array.isArray(LS.get('boot')?.data?.projects) ? LS.get('boot').data : null,
    projects: {},
    stack: [{ v: 'home' }],
  };
  const top = () => S.stack[S.stack.length - 1];
  const roleIn = (pid) => S.boot?.projects.find((p) => p.id === +pid)?.role || 'viewer';
  const canEdit = (pid) => ['owner', 'editor'].includes(roleIn(pid));

  // ---------------------------------------------------------------- Telegram & theme
  const hap = (t = 'light') => { try { tg?.HapticFeedback?.impactOccurred(t); } catch {} };
  const hapOk = () => { try { tg?.HapticFeedback?.notificationOccurred('success'); } catch {} };
  const hapErr = () => { try { tg?.HapticFeedback?.notificationOccurred('error'); } catch {} };
  function applyTheme() {
    let pref = null;
    try { pref = localStorage.getItem('theme'); } catch {}
    const warm = pref === 'warm';
    const dark = !warm && (pref === 'dark' || (pref !== 'light' && (tg?.colorScheme ? tg.colorScheme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches)));
    document.documentElement.dataset.theme = warm ? 'warm' : dark ? 'dark' : 'light';
    const bg = warm ? '#f4ecd8' : dark ? '#000000' : '#ffffff';
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', bg);
    try {
      tg?.setHeaderColor?.(bg);
      tg?.setBackgroundColor?.(bg);
      if (tg?.isVersionAtLeast?.('7.10')) tg.setBottomBarColor(bg);
    } catch {}
  }
  function tgReady() {
    if (tg || !window.Telegram?.WebApp) return;
    tg = window.Telegram.WebApp;
    tg.ready();
    tg.expand();
    try { if (tg.isVersionAtLeast('7.7')) tg.disableVerticalSwipes(); } catch {}
    if (!initData && tg.initData) initData = tg.initData;
    tg.BackButton.onClick(back);
    tg.onEvent('themeChanged', applyTheme);
    applyTheme();
    syncBack();
  }
  window.__tgl = tgReady;
  tgReady();

  // ---------------------------------------------------------------- toast, sheets, navigation
  let toastT = 0;
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.hidden = false;
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
    clearTimeout(toastT);
    toastT = setTimeout(() => (el.hidden = true), 2600);
  }
  function fail(e) {
    hapErr();
    if (e?.upgrade) return upgradeSheet(e.message);
    toast(e?.message || 'Xatolik');
  }

  const sheets = [];
  function sheet(html, on = {}, onClose) {
    const shade = document.createElement('div');
    shade.className = 'shade';
    const el = document.createElement('div');
    el.className = 'sheet';
    el.innerHTML = `<div class="grab"></div>${html}`;
    document.body.append(shade, el);
    const s = { el, shade, on, onClose };
    sheets.push(s);
    shade.onclick = () => closeSheet(s);
    requestAnimationFrame(() => { shade.classList.add('in'); el.classList.add('in'); });
    syncBack();
    return s;
  }
  function closeSheet(s = sheets[sheets.length - 1]) {
    if (!s) return;
    sheets.splice(sheets.indexOf(s), 1);
    s.el.classList.remove('in');
    s.shade.classList.remove('in');
    setTimeout(() => { s.el.remove(); s.shade.remove(); }, 280);
    s.onClose?.();
    syncBack();
  }
  const closeAll = () => { while (sheets.length) closeSheet(); };
  function syncBack() {
    if (!tg) return;
    if (sheets.length || S.stack.length > 1) tg.BackButton.show();
    else tg.BackButton.hide();
  }
  function go(v, args = {}) {
    S.stack.push({ v, ...args });
    render();
    scrollTo(0, 0);
  }
  function back() {
    if (sheets.length) return closeSheet();
    if (S.stack.length > 1) {
      S.stack.pop();
      render();
    }
  }
  function tab(v) {
    if (top().v === v && S.stack.length === 1) return;
    hap();
    S.stack = [{ v }];
    render();
    scrollTo(0, 0);
  }

  // one click listener for everything: [data-a] → handler of the screen or of the sheet it is in
  let on = {};
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-a]');
    if (!el) return;
    const sh = el.closest('.sheet');
    const handlers = sh ? sheets.find((s) => s.el === sh)?.on : on;
    const fn = handlers?.[el.dataset.a];
    if (fn) {
      e.preventDefault();
      fn(el, e);
    }
  });
  const busy = async (btn, fn) => {
    if (btn?.classList.contains('busy')) return;
    btn?.classList.add('busy');
    try { return await fn(); } finally { btn?.classList.remove('busy'); }
  };

  // ---------------------------------------------------------------- screens
  const VIEWS = {};
  function render() {
    on = {};
    const t = top();
    const html = (VIEWS[t.v] || VIEWS.home)(t);
    root.innerHTML = html;
    root.classList.remove('fade');
    void root.offsetWidth;
    root.classList.add('fade');
    syncBack();
  }
  const skeleton = () => `<header class="top"><span class="sk" style="width:120px;height:24px"></span></header><div class="wrap"><span class="sk" style="width:55%;height:34px;margin:14px 0 22px"></span><div class="list"><span class="sk" style="height:76px;border-radius:18px"></span><span class="sk" style="height:76px;border-radius:18px"></span></div></div>`;
  const logo = '<svg viewBox="290 284 680 686"><rect x="297" y="291" width="660" height="672" rx="168" fill="currentColor"/><path d="M484 375H777A72 72 0 0 1 849 447V600L672 871H484A72 72 0 0 1 412 799V447A72 72 0 0 1 484 375Z" fill="var(--bg)"/><g fill="var(--bg)" stroke="currentColor" stroke-width="22"><rect x="349" y="469" width="117" height="59" rx="29.5"/><rect x="349" y="597" width="117" height="59" rx="29.5"/><rect x="349" y="731" width="117" height="59" rx="29.5"/></g><path d="M556 455 L668 521 L556 588 Z" fill="currentColor" stroke="currentColor" stroke-width="26" stroke-linejoin="round"/><path d="M540 658H717M540 740H673" stroke="currentColor" stroke-width="34" stroke-linecap="round"/><g transform="translate(702 866) rotate(-51)"><path d="M0 0 L66 -46 H262 A46 46 0 0 1 262 46 H66 Z" fill="var(--bg)" stroke="currentColor" stroke-width="22" stroke-linejoin="round"/><path d="M232 -46V46" stroke="currentColor" stroke-width="13"/></g></svg>';
  const NAME = 'Ssenariychi';
  // always visible and labelled — many people never notice Telegram's own back arrow
  const backBtn = () => `<button class="backb" data-a="back">${I('back', 's')}Orqaga</button>`;

  // ---------------------------------------------------------------- theme picker
  const THEMES = [['light', 'Oq', '#ffffff'], ['warm', 'Sariq', '#f4ecd8'], ['dark', 'Qora', '#000000']];
  const curTheme = () => { try { return localStorage.getItem('theme') || 'auto'; } catch { return 'auto'; } };
  const setTheme = (v) => { try { v === 'auto' ? localStorage.removeItem('theme') : localStorage.setItem('theme', v); } catch {} applyTheme(); hap(); };
  const themeRow = () => `<div class="themes">${THEMES.map(([v, l, c]) => `<button class="${curTheme() === v ? 'on' : ''}" data-a="theme" data-v="${v}"><i style="background:${c}"></i>${l}</button>`).join('')}</div>`;
  function themeSheet() {
    const s = sheet(`<div class="sh"><h2 class="t">Ko‘rinish</h2><span class="sp"></span><button class="ib" data-a="close">${I('close')}</button></div>
      <p class="mute small" style="margin:-6px 0 14px">«Sariq» — ko‘zni charchatmaydi, uzoq o‘qish uchun qulay.</p>
      ${themeRow()}`, {
      close: () => closeSheet(s),
      theme(el) { setTheme(el.dataset.v); for (const c of el.parentElement.children) c.classList.toggle('on', c === el); },
    });
  }
  function tabbar(cur) {
    on.tab = (el) => tab(el.dataset.v);
    const b = (v, icon, label) => `<button class="${cur === v ? 'on' : ''}" data-a="tab" data-v="${v}">${I(icon)}<span>${label}</span></button>`;
    return `<nav class="tabs">${b('home', 'grid', 'Loyihalar')}${b('team', 'users', 'Jamoa')}${b('profile', 'user', 'Profil')}</nav>`;
  }
  const planChip = () => {
    const e = S.boot?.ent;
    if (!e) return '';
    const paid = e.plan.id !== 'free' || e.team?.active;
    return `<button class="chip-plan ${paid ? 'paid' : ''}" data-a="plans">${e.team?.active && e.plan.id === 'free' ? 'Jamoa' : esc(e.plan.name)}</button>`;
  };

  // ---------------------------------------------------------------- home: projects
  VIEWS.home = () => {
    const b = S.boot;
    if (!b) return skeleton() + tabbar('home');
    on.plans = () => go('plans');
    on.open = (el) => openProject(+el.dataset.id);
    on.newp = () => projectSheet();
    on.archive = () => go('archive');
    on.themes = () => themeSheet();
    const live = b.projects.filter((p) => !p.archived);
    const mine = live.filter((p) => !p.team && p.role === 'owner');
    const team = live.filter((p) => p.team);
    const shared = live.filter((p) => !p.team && p.role !== 'owner');
    const archived = b.projects.length - live.length;
    const first = (b.me.name || '').split(' ')[0];
    const group = (title, list) => (list.length ? `<div class="sec"><span class="eyebrow">${title}</span></div><div class="list">${list.map(card).join('')}</div>` : '');
    return `
      <header class="top"><div class="mark grow">${logo}<span>${NAME}</span></div><button class="ib" data-a="themes" aria-label="Ko‘rinish">${I('moon')}</button>${planChip()}</header>
      <div class="wrap">
        <h1 class="t" style="margin-top:8px">${first ? `Salom, ${esc(first)}!` : 'Salom!'}</h1>
        ${live.length
          ? '<p class="mute" style="margin:6px 0 0">Loyihani bosing — ichida kalendar va postlar.</p>'
          : `<div class="card" style="padding:20px;margin-top:18px"><b style="font:500 20px/1.3 var(--serif)">Qanday ishlaydi?</b>
              <ol class="steps"><li><b>1</b>Loyiha oching (brend yoki mijoz nomi)</li><li><b>2</b>Kalendarda kunni tanlab, post yozing</li><li><b>3</b>Mijozga yuboring — u 👍 / 👎 bosib, izoh yozadi</li></ol></div>`}
        <div style="margin-top:18px"><button class="btn" data-a="newp">${I('plus', 's')} Yangi loyiha ochish</button></div>
        ${group('Mening loyihalarim', mine)}${group(b.ent.team ? esc(b.ent.team.name) : 'Jamoa loyihalari', team)}${group('Menga yuborilgan', shared)}
        ${archived ? `<div style="text-align:center;margin-top:18px"><button class="link small" data-a="archive">Arxiv (${archived})</button></div>` : ''}
      </div>${tabbar('home')}`;
  };
  function card(p) {
    const pct = p.posts ? Math.round((p.ready / p.posts) * 100) : 0;
    const roleTag = p.role === 'viewer' ? '<span class="badge">Ko‘rish</span>' : p.role === 'editor' && !p.team ? '<span class="badge">Muharrir</span>' : '';
    return `<button class="card pcard" data-a="open" data-id="${p.id}"${p.color ? ` style="--pc:${esc(p.color)}"` : ''}>
      ${projIcon(p)}
      <div style="flex:1;min-width:0">
        <div class="row" style="gap:8px"><span class="pname ell">${esc(p.name)}</span>${roleTag}</div>
        <div class="meta" style="margin-top:3px"><span class="num">${p.posts} post</span><span class="num">${p.ready} tayyor</span>${p.next ? `<span>${I('clock', 'xs')} ${fmtDay(p.next)}</span>` : ''}</div>
        <div class="bar"><i style="width:${pct}%"></i></div>
      </div>${I('next', 's mute')}</button>`;
  }
  VIEWS.archive = () => {
    on.back = back;
    on.open = (el) => openProject(+el.dataset.id);
    const list = (S.boot?.projects || []).filter((p) => p.archived);
    return `<header class="top">${backBtn()}<h2 class="t grow">Arxiv</h2></header><div class="wrap"><div class="list" style="margin-top:8px">${list.map(card).join('') || '<div class="empty">Arxiv bo‘sh</div>'}</div></div>`;
  };

  // ---------------------------------------------------------------- project: calendar & list
  async function loadProject(id) {
    const key = `p:${id}`;
    if (!S.projects[id]) S.projects[id] = LS.get(key)?.data || null;
    const p = await cached(key, `/api/projects/${id}`);
    remember(key);
    const changed = S.projects[id]?.rev !== p.rev;
    S.projects[id] = p;
    return changed;
  }
  function openProject(id, postId) {
    hap();
    const t = today();
    go('project', { id, month: t.slice(0, 7), day: t, mode: 'cal', filter: 'all' });
    loadProject(id)
      .then((changed) => {
        if (changed && top().v === 'project' && top().id === id) render();
        if (postId) {
          const post = S.projects[id]?.posts.find((x) => x.id === +postId);
          if (post) postSheet(id, post);
        }
      })
      .catch((e) => {
        fail(e);
        if (e.status === 403 || e.status === 404) back();
      });
  }
  /** After any change: the project (one request, the new version) and the home counters. */
  async function sync(id) {
    try {
      await loadProject(id);
      if (top().v === 'project' && top().id === id) render();
    } catch (e) { fail(e); }
    refreshBoot();
  }

  VIEWS.project = (st) => {
    const p = S.projects[st.id];
    const meta = S.boot?.projects.find((x) => x.id === st.id) || p;
    on.back = back;
    if (!p) return `<header class="top">${backBtn()}<span class="sk" style="width:140px;height:24px"></span></header><div class="wrap"><span class="sk" style="height:320px;border-radius:18px;margin-top:20px"></span></div>`;
    const edit = canEdit(st.id);
    const owner = roleIn(st.id) === 'owner';
    on.mode = (el) => { st.mode = el.dataset.v; render(); };
    on.month = (el) => {
      const d = parseYmd(`${st.month}-01`);
      d.setMonth(d.getMonth() + +el.dataset.d);
      st.month = ymd(d).slice(0, 7);
      render();
    };
    on.day = (el) => { st.day = el.dataset.d; if (st.day.slice(0, 7) !== st.month) st.month = st.day.slice(0, 7); hap(); render(); };
    on.post = (el) => postSheet(st.id, p.posts.find((x) => x.id === +el.dataset.id));
    on.add = () => postSheet(st.id, null, st.mode === 'cal' ? st.day : today());
    on.settings = () => projectSheet(p);
    on.share = () => shareSheet(p);
    on.ai = () => aiPlanSheet(p, st);
    on.filter = (el) => { st.filter = el.dataset.v; render(); };
    on.past = () => { st.past = !st.past; render(); };

    const total = p.posts.length;
    const done = p.posts.filter((x) => STATUS[x.status]?.[1] >= 0.75).length;
    const act = (a, icon, label, main = false) => `<button class="act ${main ? 'main' : ''}" data-a="${a}">${I(icon)}${label}</button>`;
    return `
      <header class="top">${backBtn()}
        <div class="row grow" style="gap:10px;min-width:0">${projIcon(meta || p, 'sm')}<b class="ell" style="font:500 19px/1.2 var(--serif);letter-spacing:-.01em">${esc(p.name)}</b></div>
      </header>
      <div class="wrap" style="${p.color ? `--pc:${esc(p.color)}` : ''}">
        <div class="acts">
          ${edit ? act('add', 'plus', 'Post qo‘shish', true) : ''}
          ${owner ? act('share', 'share', 'Mijozga yuborish') : ''}
          ${edit && S.boot?.ai ? act('ai', 'ai', 'AI reja') : ''}
          ${act('settings', 'sliders', 'Sozlamalar')}
        </div>
        ${total ? `<p class="mute small" style="margin:12px 2px 0">Jami <b class="num" style="color:var(--ink)">${total}</b> ta post · <b class="num" style="color:var(--ink)">${done}</b> tasi tayyor</p>` : ''}
        <div class="seg" style="margin-top:14px"><button class="${st.mode === 'cal' ? 'on' : ''}" data-a="mode" data-v="cal">${I('cal', 's')} Kalendar</button><button class="${st.mode === 'list' ? 'on' : ''}" data-a="mode" data-v="list">${I('list', 's')} Ro‘yxat</button></div>
        ${st.mode === 'cal' ? calendar(p, st, edit) : listView(p, st)}
      </div>`;
  };

  function calendar(p, st, edit) {
    const byDay = {};
    for (const x of p.posts) (byDay[x.date] ||= []).push(x);
    const first = parseYmd(`${st.month}-01`);
    const offset = (first.getDay() + 6) % 7;
    const start = new Date(first);
    start.setDate(1 - offset);
    const days = Math.ceil((offset + new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()) / 7) * 7;
    const t = today();
    let cells = '';
    for (let i = 0; i < days; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const k = ymd(d);
      const list = byDay[k] || [];
      const dots = list.slice(0, 3).map((x) => `<i class="${STATUS[x.status][1] >= 0.75 ? '' : 'h'}"></i>`).join('');
      cells += `<button class="day ${k.slice(0, 7) !== st.month ? 'out' : ''} ${k === t ? 'today' : ''} ${k === st.day ? 'sel' : ''}" data-a="day" data-d="${k}"><span class="n">${d.getDate()}</span><span class="dots">${dots}</span></button>`;
    }
    const sel = (byDay[st.day] || []).slice().sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
    return `
      <div class="mhead"><button class="ib" data-a="month" data-d="-1">${I('back', 's')}</button><b>${MONTHS[first.getMonth()]} <span class="mute">${first.getFullYear()}</span></b><button class="ib" data-a="month" data-d="1">${I('next', 's')}</button></div>
      <div class="wd">${WD.map((w) => `<span>${w}</span>`).join('')}</div>
      <div class="grid7">${cells}</div>
      <div class="dgroup"><div class="eyebrow">${fmtDayLong(st.day)}</div>
        ${sel.length ? `<div class="card">${sel.map(postRow).join('')}</div>` : `<div class="card" style="padding:22px;text-align:center"><span class="mute small">Bu kunga post yo‘q</span>${edit ? `<div style="margin-top:12px"><button class="btn sm soft" data-a="add">${I('plus', 's')} Post qo‘shish</button></div>` : ''}</div>`}
      </div><div style="height:70px"></div>`;
  }

  function listView(p, st) {
    const t = today();
    const posts = p.posts.filter((x) => st.filter === 'all' || x.status === st.filter);
    const upcoming = posts.filter((x) => x.date >= t);
    const past = posts.filter((x) => x.date < t).reverse();
    const group = (list) => {
      const by = {};
      for (const x of list) (by[x.date] ||= []).push(x);
      return Object.keys(by).map((d) => `<div class="dgroup"><div class="eyebrow">${fmtDay(d)}<span style="opacity:.6">· ${WDF[parseYmd(d).getDay()]}</span></div><div class="card">${by[d].map(postRow).join('')}</div></div>`).join('');
    };
    const chips = [['all', 'Hammasi'], ...Object.entries(STATUS).map(([k, v]) => [k, v[0]])]
      .map(([k, l]) => `<button class="chip ${st.filter === k ? 'on' : ''}" data-a="filter" data-v="${k}">${l}</button>`).join('');
    return `<div class="chips" style="margin-top:14px">${chips}</div>
      ${upcoming.length ? group(upcoming) : `<div class="empty" style="padding:32px 10px">${I('cal')}<b>Oldinda post yo‘q</b>Kalendarda kunni tanlang yoki “+” ni bosing.</div>`}
      ${past.length ? `<div style="text-align:center;margin:22px 0 4px"><button class="link small" data-a="past">${st.past ? 'O‘tganlarni yashirish' : `O‘tgan postlar · ${past.length}`}</button></div>${st.past ? group(past) : ''}` : ''}
      <div style="height:80px"></div>`;
  }

  function postRow(x) {
    const pl = PLATFORMS[x.platform] || PLATFORMS.other;
    const fb = [x.up.length ? `<span>${I('up', 'xs')} ${x.up.length}</span>` : '', x.down.length ? `<span>${I('down', 'xs')} ${x.down.length}</span>` : '', x.comments ? `<span>${I('chat', 'xs')} ${x.comments}</span>` : ''].join('');
    return `<button class="post" data-a="post" data-id="${x.id}">${ring(x.status)}
      <div style="flex:1;min-width:0">
        <div class="meta"><span class="pl">${pl[1]}</span><span>${KINDS[x.kind] || x.kind}</span>${x.time ? `<span class="num">${x.time}</span>` : ''}${x.remindAt && x.remindAt > Date.now() ? `<span>${I('bell', 'xs')}</span>` : ''}</div>
        <div class="ti ell">${esc(x.title)}</div>
        ${fb ? `<div class="meta">${fb}</div>` : x.body ? `<div class="meta ell" style="display:block">${esc(x.body.slice(0, 90))}</div>` : ''}
      </div></button>`;
  }

  // ---------------------------------------------------------------- post sheet (edit, view, feedback)
  const REMIND = [['none', 'Yo‘q'], ['at', 'Vaqtida'], ['1h', '1 soat oldin'], ['1d', '1 kun oldin']];
  const baseTime = (f) => new Date(`${f.date}T${f.time || '09:00'}:00`).getTime();
  const remindAt = (f) => (f.remind === 'none' ? null : baseTime(f) - { at: 0, '1h': 3600e3, '1d': 86400e3 }[f.remind]);
  const remindOf = (post) => {
    if (!post?.remindAt) return post ? 'none' : (S.boot?.me.prefs?.remind || 'at');
    const d = baseTime(post) - post.remindAt;
    return d >= 86400e3 ? '1d' : d >= 3600e3 ? '1h' : 'at';
  };

  function postSheet(pid, post, date) {
    if (post === undefined) return;
    const p = S.projects[pid];
    const edit = canEdit(pid);
    const me = S.boot?.me.id;
    const f = post
      ? { ...post, remind: remindOf(post) }
      : { title: '', date: date || today(), time: '', platform: S.boot?.me.prefs?.platform || 'instagram', kind: 'post', status: 'idea', body: '', notes: '', remind: remindOf(null) };
    const chipRow = (k, map, label = (v) => v) => `<div class="chips" data-k="${k}">${Object.keys(map).map((v) => `<button class="chip ${f[k] === v ? 'on' : ''}" data-a="pf" data-k="${k}" data-v="${v}">${label(v)}</button>`).join('')}</div>`;
    const ai = !!S.boot?.ai;
    const more = !!(post && (post.notes || post.kind !== 'post'));
    const head = `<div class="sh"><span class="eyebrow">${post ? (edit ? 'Post' : esc(p.name)) : 'Yangi post'}</span><span class="sp"></span><button class="ib" data-a="close">${I('close')}</button></div>`;

    const form = `
      <label class="eyebrow">Post nima haqida?</label>
      <input class="titlein" id="f-title" placeholder="Masalan: Yangi menyu taqdimoti" maxlength="200" value="${esc(f.title)}">
      <div class="two field"><label><span class="eyebrow">Sana</span><input type="date" id="f-date" value="${f.date}"></label><label><span class="eyebrow">Vaqt</span><input type="time" id="f-time" value="${f.time}"></label></div>
      <div class="field"><label class="eyebrow">Platforma</label>${chipRow('platform', PLATFORMS, (v) => PLATFORMS[v][0])}</div>
      <div class="field"><label class="eyebrow">Holati</label>${chipRow('status', STATUS, (v) => `${ring(v)}${STATUS[v][0]}`)}</div>
      <div class="field"><label class="eyebrow">Matn yoki ssenariy</label><textarea id="f-body" rows="6" maxlength="8000" placeholder="Post matni, ssenariy yoki g‘oya…">${esc(f.body)}</textarea>
        ${ai ? `<div class="aibar"><button class="chip" data-a="ai" data-k="caption">${I('ai', 'xs')} Yozib ber</button><button class="chip" data-a="ai" data-k="improve">${I('wand', 'xs')} Yaxshila</button><button class="chip" data-a="ai" data-k="hashtags">${I('hash', 'xs')} Heshteglar</button></div>` : ''}</div>
      <div class="field"><label class="eyebrow">${I('bell', 'xs')} Bot qachon eslatsin?</label><div class="chips" data-k="remind">${REMIND.map(([v, l]) => `<button class="chip ${f.remind === v ? 'on' : ''}" data-a="pf" data-k="remind" data-v="${v}">${l}</button>`).join('')}</div></div>
      <div style="margin-top:16px"><button class="link small" data-a="more">${more ? 'Kamroq ko‘rsatish' : 'Ko‘proq sozlamalar (format, izoh)'}</button></div>
      <div id="more"${more ? '' : ' hidden'}>
        <div class="field"><label class="eyebrow">Format</label>${chipRow('kind', KINDS, (v) => KINDS[v])}</div>
        <div class="field"><label class="eyebrow">Ichki izoh (faqat jamoa ko‘radi)</label><textarea id="f-notes" rows="2" maxlength="2000" style="min-height:60px" placeholder="Eslatma, havolalar…">${esc(f.notes)}</textarea></div>
      </div>
      <div style="margin-top:22px"><button class="btn" data-a="save">${post ? 'Saqlash' : 'Qo‘shish'}</button></div>
      ${post ? `<div style="text-align:center;margin-top:12px"><button class="link small mute" data-a="del">O‘chirish</button></div>` : ''}`;

    const pl = post && (PLATFORMS[post.platform] || PLATFORMS.other);
    const view = post
      ? `<h2 class="t">${esc(post.title)}</h2>
         <div class="meta" style="margin:10px 0 16px">${ring(post.status)}<span>${STATUS[post.status][0]}</span><span class="pl">${pl[1]}</span><span>${KINDS[post.kind]}</span><span>${fmtDay(post.date)}${post.time ? `, ${post.time}` : ''}</span></div>
         ${post.body ? `<div class="ro">${esc(post.body)}</div>` : '<div class="mute small">Matn hali yozilmagan</div>'}
         ${post.notes ? `<div class="card" style="padding:12px 14px;margin-top:14px"><div class="eyebrow">Izoh</div><div class="ro small" style="margin-top:4px">${esc(post.notes)}</div></div>` : ''}`
      : '';

    const feedback = post
      ? `<div class="hr"></div><div class="eyebrow" style="margin-bottom:10px">Sizga yoqdimi?</div>
         <div class="votes"><button class="vote ${post.up.includes(me) ? 'on' : ''}" data-a="vote" data-v="1">${I('up', 's')} Yaxshi <span class="num">${post.up.length}</span></button><button class="vote ${post.down.includes(me) ? 'on' : ''}" data-a="vote" data-v="-1">${I('down', 's')} Yomon <span class="num">${post.down.length}</span></button></div>
         ${post.up.length + post.down.length ? `<div class="tiny mute" style="margin-top:8px">${[...post.up.map((u) => `👍 ${esc(p.people[u] || '')}`), ...post.down.map((u) => `👎 ${esc(p.people[u] || '')}`)].join(' · ')}</div>` : ''}
         <div id="cmts" style="margin-top:8px">${post.comments ? '<div class="shimmer" style="height:44px"></div>' : ''}</div>
         <div class="sendrow"><textarea id="c-text" rows="1" maxlength="1000" placeholder="Izoh yozing…"></textarea><button class="ib" data-a="comment" aria-label="Yuborish">${I('send', 's')}</button></div>`
      : '';

    const s = sheet(head + (edit ? form : view) + feedback, {
      close: () => closeSheet(s),
      more(el) {
        const box = s.el.querySelector('#more');
        box.hidden = !box.hidden;
        el.textContent = box.hidden ? 'Ko‘proq sozlamalar (format, izoh)' : 'Kamroq ko‘rsatish';
      },
      pf(el) {
        f[el.dataset.k] = el.dataset.v;
        for (const c of el.parentElement.children) c.classList.toggle('on', c === el);
        hap();
      },
      async save(el) {
        const $ = (id) => s.el.querySelector(id);
        Object.assign(f, { title: $('#f-title').value.trim(), date: $('#f-date').value, time: $('#f-time').value, body: $('#f-body').value, notes: $('#f-notes').value });
        if (!f.title) return toast('Sarlavha yozing'), $('#f-title').focus();
        if (!f.date) return toast('Sanani tanlang');
        const r = remindAt(f);
        if (r && r < Date.now() && f.remind !== 'none') toast('Eslatma vaqti o‘tib ketgan — eslatma qo‘yilmadi');
        const body = { title: f.title, date: f.date, time: f.time, platform: f.platform, kind: f.kind, status: f.status, body: f.body, notes: f.notes, remindAt: r && r > Date.now() ? r : null };
        await busy(el, async () => {
          try {
            if (post) await api('PATCH', `/api/posts/${post.id}`, body);
            else await api('POST', `/api/projects/${pid}/posts`, body);
            hapOk();
            closeSheet(s);
            toast(post ? 'Saqlandi' : 'Post qo‘shildi');
            const st = top();
            if (st.v === 'project' && !post) { st.day = f.date; st.month = f.date.slice(0, 7); }
            sync(pid);
          } catch (e) { fail(e); }
        });
      },
      async del(el) {
        if (!el.dataset.sure) { el.dataset.sure = 1; el.textContent = 'Rostdan o‘chirilsinmi? Yana bir marta bosing'; return hap('medium'); }
        await busy(el, async () => {
          try { await api('DELETE', `/api/posts/${post.id}`); closeSheet(s); toast('O‘chirildi'); sync(pid); } catch (e) { fail(e); }
        });
      },
      async ai(el) {
        const ent = S.boot?.ent;
        if (!ent?.ai) return upgradeSheet('AI yordamchi «AI» tarifida. Matn, heshteg va butun oylik reja — bir bosishda.');
        const ta = s.el.querySelector('#f-body');
        const kind = el.dataset.k;
        const text = ta.value.trim();
        const title = s.el.querySelector('#f-title').value.trim();
        if (kind === 'caption' && !title) return toast('Avval mavzuni yozing');
        if (kind !== 'caption' && !text) return toast('Avval matn yozing');
        await busy(el, async () => {
          try {
            const r = await api('POST', '/api/ai', { kind, projectId: pid, title, platform: f.platform, format: f.kind, text, fresh: kind !== 'hashtags' });
            ta.value = kind === 'hashtags' ? `${text}\n\n${r.text}` : r.text;
            ta.style.height = `${Math.min(ta.scrollHeight + 2, 420)}px`;
            if (S.boot) S.boot.ent.aiUsed = r.used;
            hapOk();
            toast(`AI: ${r.used} / ${r.quota} bu oy`);
          } catch (e) { fail(e); }
        });
      },
      async vote(el) {
        const v = +el.dataset.v;
        const mine = v > 0 ? post.up : post.down;
        const next = mine.includes(me) ? 0 : v;
        post.up = post.up.filter((u) => u !== me);
        post.down = post.down.filter((u) => u !== me);
        if (next > 0) post.up.push(me);
        if (next < 0) post.down.push(me);
        const [upB, downB] = s.el.querySelectorAll('.vote');
        upB.classList.toggle('on', next > 0);
        downB.classList.toggle('on', next < 0);
        upB.querySelector('.num').textContent = post.up.length;
        downB.querySelector('.num').textContent = post.down.length;
        hap('medium');
        try { await api('POST', `/api/posts/${post.id}/vote`, { v: next }); sync(pid); } catch (e) { fail(e); }
      },
      async comment(el) {
        const ta = s.el.querySelector('#c-text');
        const text = ta.value.trim();
        if (!text) return;
        await busy(el, async () => {
          try {
            await api('POST', `/api/posts/${post.id}/comments`, { text });
            ta.value = '';
            post.comments++;
            hapOk();
            loadComments();
            sync(pid);
          } catch (e) { fail(e); }
        });
      },
      async delc(el) {
        try { await api('DELETE', `/api/comments/${el.dataset.id}`); post.comments--; loadComments(); sync(pid); } catch (e) { fail(e); }
      },
    });
    const ta = s.el.querySelector('#f-body');
    if (ta) {
      const grow = () => (ta.style.height = `${Math.min(ta.scrollHeight + 2, 420)}px`);
      ta.addEventListener('input', grow);
      setTimeout(grow, 50);
    }
    if (!post && edit) setTimeout(() => s.el.querySelector('#f-title')?.focus(), 350);
    async function loadComments() {
      const box = s.el.querySelector('#cmts');
      if (!box) return;
      try {
        const { comments } = await api('GET', `/api/posts/${post.id}/comments`);
        const owner = roleIn(pid) === 'owner';
        box.innerHTML = comments
          .map((c) => `<div class="cmt"><div class="who"><span class="av" style="width:24px;height:24px;font-size:10px">${initials(c.name)}</span>${esc(c.name)}<span class="mute tiny" style="font-weight:400">${ago(c.at)}</span><span class="sp"></span>${c.uid === me || owner ? `<button class="mute" data-a="delc" data-id="${c.id}">${I('close', 'xs')}</button>` : ''}</div><p>${esc(c.text)}</p></div>`)
          .join('');
      } catch (e) { box.innerHTML = ''; }
    }
    if (post?.comments) loadComments();
  }

  // ---------------------------------------------------------------- project settings / new project
  function projectSheet(p) {
    const isNew = !p;
    const role = p ? roleIn(p.id) : 'owner';
    const f = { name: p?.name || '', icon: p?.icon || 'spark', color: p?.color || null, team: false };
    const ent = S.boot?.ent;
    const boss = ent?.team?.active && ent.team.role !== 'member';
    if (!isNew && role !== 'owner') {
      const s = sheet(`<div class="sh">${projIcon(p, 'lg')}<div><h2 class="t">${esc(p.name)}</h2><div class="mute small">${role === 'editor' ? 'Siz muharrirsiz' : 'Siz faqat ko‘ra olasiz va fikr bildirasiz'}</div></div></div>
        ${p.owner ? `<div class="mem"><span class="av">${initials(p.owner.name)}</span><div class="grow"><b>${esc(p.owner.name)}</b><div class="tiny mute">Egasi</div></div></div>` : ''}
        ${p.team ? '' : `<button class="btn ghost" style="margin-top:16px" data-a="leave">${I('out', 's')} Loyihadan chiqish</button>`}`, {
        async leave(el) {
          await busy(el, async () => {
            try { await api('DELETE', `/api/projects/${p.id}/members/${S.boot.me.id}`); closeAll(); S.stack = [{ v: 'home' }]; render(); refreshBoot(); toast('Loyihadan chiqdingiz'); } catch (e) { fail(e); }
          });
        },
      });
      return;
    }
    const members = p?.members || [];
    const html = `<div class="sh"><span class="eyebrow">${isNew ? 'Yangi loyiha' : 'Loyiha sozlamalari'}</span><span class="sp"></span><button class="ib" data-a="close">${I('close')}</button></div>
      <div class="row" style="gap:14px"><span id="pv">${projIcon(f, 'lg')}</span><input id="p-name" class="titlein" style="flex:1" maxlength="60" placeholder="Brend yoki mijoz nomi" value="${esc(f.name)}"></div>
      <div class="field"><label class="eyebrow">Ikonka</label><div class="icons">${PICONS.map((n) => `<button class="${f.icon === n ? 'on' : ''}" data-a="icon" data-v="${n}">${P(n)}</button>`).join('')}</div></div>
      <div class="field"><label class="eyebrow">Rang <span style="text-transform:none;letter-spacing:0;font-weight:400">— ixtiyoriy</span></label><div class="swatches"><button class="none ${!f.color ? 'on' : ''}" data-a="color" data-v=""></button>${COLORS.map((c) => `<button class="${f.color === c ? 'on' : ''}" style="--sw:${c}" data-a="color" data-v="${c}"></button>`).join('')}</div></div>
      ${isNew && boss ? `<div class="field row"><div class="grow"><b>Jamoa loyihasi</b><div class="tiny mute">Jamoaning hamma a’zolari ko‘radi va tahrirlaydi</div></div><button class="toggle" data-a="teamt"></button></div>` : ''}
      ${!isNew && members.length ? `<div class="field"><label class="eyebrow">A’zolar · ${members.length}</label><div class="card" style="padding:0 14px">${members.map((m) => `<div class="mem"><span class="av">${initials(m.name)}</span><div class="grow" style="min-width:0"><b class="ell" style="display:block">${esc(m.name)}</b><div class="tiny mute">${m.username ? '@' + esc(m.username) : ''}</div></div><div class="seg" style="width:170px"><button class="${m.role === 'viewer' ? 'on' : ''}" data-a="mrole" data-id="${m.id}" data-v="viewer">Ko‘rish</button><button class="${m.role === 'editor' ? 'on' : ''}" data-a="mrole" data-id="${m.id}" data-v="editor">Tahrir</button></div><button class="ib" data-a="mdel" data-id="${m.id}">${I('close', 's')}</button></div>`).join('')}</div></div>` : ''}
      <div style="margin-top:22px"><button class="btn" data-a="save">${isNew ? 'Yaratish' : 'Saqlash'}</button></div>
      ${!isNew ? `<div class="two" style="margin-top:10px"><button class="btn ghost sm" style="width:100%" data-a="arch">${I('archive', 's')} ${p.archived ? 'Arxivdan qaytarish' : 'Arxivlash'}</button><button class="btn danger sm" style="width:100%" data-a="del">${I('trash', 's')} O‘chirish</button></div>` : ''}`;
    const s = sheet(html, {
      close: () => closeSheet(s),
      icon(el) { f.icon = el.dataset.v; for (const c of el.parentElement.children) c.classList.toggle('on', c === el); s.el.querySelector('#pv').innerHTML = projIcon(f, 'lg'); hap(); },
      color(el) { f.color = el.dataset.v || null; for (const c of el.parentElement.children) c.classList.toggle('on', c === el); s.el.querySelector('#pv').innerHTML = projIcon(f, 'lg'); hap(); },
      teamt(el) { f.team = !f.team; el.classList.toggle('on', f.team); hap(); },
      async save(el) {
        f.name = s.el.querySelector('#p-name').value.trim();
        if (!f.name) return toast('Nom yozing');
        await busy(el, async () => {
          try {
            if (isNew) {
              const r = await api('POST', '/api/projects', f);
              closeSheet(s);
              hapOk();
              await refreshBoot();
              openProject(r.id);
            } else {
              await api('PATCH', `/api/projects/${p.id}`, { name: f.name, icon: f.icon, color: f.color });
              closeSheet(s);
              toast('Saqlandi');
              await refreshBoot();
              sync(p.id);
            }
          } catch (e) { fail(e); }
        });
      },
      async mrole(el) {
        for (const c of el.parentElement.children) c.classList.toggle('on', c === el);
        try { await api('PATCH', `/api/projects/${p.id}/members/${el.dataset.id}`, { role: el.dataset.v }); sync(p.id); } catch (e) { fail(e); }
      },
      async mdel(el) {
        try { await api('DELETE', `/api/projects/${p.id}/members/${el.dataset.id}`); el.closest('.mem').remove(); sync(p.id); } catch (e) { fail(e); }
      },
      async arch(el) {
        await busy(el, async () => {
          try { await api('PATCH', `/api/projects/${p.id}`, { archived: !p.archived }); closeSheet(s); toast(p.archived ? 'Qaytarildi' : 'Arxivlandi'); await refreshBoot(); S.stack = [{ v: 'home' }]; render(); } catch (e) { fail(e); }
        });
      },
      async del(el) {
        if (!el.dataset.sure) { el.dataset.sure = 1; el.innerHTML = 'Hamma postlar o‘chadi. Yana bosing'; return hap('heavy'); }
        await busy(el, async () => {
          try { await api('DELETE', `/api/projects/${p.id}`); closeAll(); LS.del(`p:${p.id}`); delete S.projects[p.id]; S.stack = [{ v: 'home' }]; await refreshBoot(); render(); toast('Loyiha o‘chirildi'); } catch (e) { fail(e); }
        });
      },
    });
    if (isNew) setTimeout(() => s.el.querySelector('#p-name')?.focus(), 350);
  }

  // ---------------------------------------------------------------- sharing
  async function shareSheet(p) {
    let link = '';
    const s = sheet(`<div class="sh"><span class="eyebrow">Ulashish</span><span class="sp"></span><button class="ib" data-a="close">${I('close')}</button></div>
      <h2 class="t">Mijoz yoki jamoaga ko‘rsating</h2>
      <p class="mute" style="margin:8px 0 18px">Havolani ochgan odam kontent rejani ko‘radi, har bir postga 👍 / 👎 bosadi va izoh qoldiradi. Tahrirlash huquqini sozlamalarda berasiz.</p>
      <div class="card row" style="padding:12px 14px"><span class="mute">${I('link', 's')}</span><span id="lnk" class="ell grow small">…</span><button class="ib" data-a="copy">${I('copy', 's')}</button></div>
      <div style="margin-top:16px"><button class="btn" data-a="send">${I('send', 's')} Telegram orqali yuborish</button></div>
      <div style="text-align:center;margin-top:14px"><button class="link small mute" data-a="reset">Havolani yangilash (eskisi ishlamay qoladi)</button></div>`, {
      close: () => closeSheet(s),
      copy() { if (!link) return; navigator.clipboard?.writeText(link).then(() => { hapOk(); toast('Nusxa olindi'); }, () => toast(link)); },
      send() {
        if (!link) return;
        const url = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(`«${p.name}» kontent rejasi — ko‘rib, fikringizni yozing`)}`;
        tg ? tg.openTelegramLink(url) : open(url, '_blank');
      },
      async reset(el) { await busy(el, () => load(true)); toast('Yangi havola tayyor'); },
    });
    async function load(reset = false) {
      try {
        const r = await api('POST', `/api/projects/${p.id}/share`, { reset });
        link = r.link || r.code;
        s.el.querySelector('#lnk').textContent = link;
      } catch (e) { fail(e); }
    }
    load();
  }

  // ---------------------------------------------------------------- AI content plan
  function aiPlanSheet(p, st) {
    const ent = S.boot?.ent;
    if (!ent?.ai) return upgradeSheet('AI bir bosishda 7, 14 yoki 30 kunlik kontent reja tuzib beradi — sarlavha va tayyor matnlari bilan.');
    const f = { days: 7, perWeek: 5, platforms: ['instagram'], start: st.mode === 'cal' && st.day >= today() ? st.day : today() };
    let result = null;
    const s = sheet('', {
      close: () => closeSheet(s),
      days(el) { f.days = +el.dataset.v; for (const c of el.parentElement.children) c.classList.toggle('on', c === el); },
      pl(el) { const v = el.dataset.v; f.platforms = f.platforms.includes(v) ? f.platforms.filter((x) => x !== v) : [...f.platforms, v]; el.classList.toggle('on'); hap(); },
      step(el) { f.perWeek = Math.min(14, Math.max(1, f.perWeek + +el.dataset.d)); s.el.querySelector('#pw').textContent = f.perWeek; },
      async gen(el) {
        f.brief = s.el.querySelector('#brief').value.trim();
        f.start = s.el.querySelector('#start').value || today();
        if (!f.platforms.length) return toast('Platforma tanlang');
        s.el.querySelector('#res').innerHTML = '<div class="shimmer"></div><div class="shimmer"></div><div class="shimmer"></div><p class="mute small" style="text-align:center">AI reja tuzmoqda… 10–30 soniya</p>';
        await busy(el, async () => {
          try {
            const r = await api('POST', '/api/ai', { kind: 'plan', projectId: p.id, ...f });
            result = r.posts.map((x) => ({ ...x, on: true }));
            S.boot.ent.aiUsed = r.used;
            hapOk();
            showResult();
          } catch (e) { s.el.querySelector('#res').innerHTML = ''; fail(e); }
        });
      },
      tog(el) { const x = result[+el.dataset.i]; x.on = !x.on; el.classList.toggle('on', x.on); updateAdd(); },
      async add(el) {
        const posts = result.filter((x) => x.on).map(({ on: _, ...x }) => x);
        if (!posts.length) return;
        await busy(el, async () => {
          try {
            await api('POST', `/api/projects/${p.id}/posts/bulk`, { posts });
            hapOk();
            closeSheet(s);
            toast(`${posts.length} ta post qo‘shildi`);
            st.mode = 'list';
            sync(p.id);
          } catch (e) { fail(e); }
        });
      },
    });
    const PL = ['instagram', 'telegram', 'tiktok', 'youtube', 'facebook'];
    s.el.innerHTML = `<div class="grab"></div><div class="sh"><span class="eyebrow">${I('ai', 'xs')} AI kontent reja</span><span class="sp"></span><button class="ib" data-a="close">${I('close')}</button></div>
      <h2 class="t">«${esc(p.name)}» uchun reja</h2>
      <div class="field"><label class="eyebrow">Brif</label><textarea id="brief" rows="3" maxlength="1500" placeholder="Masalan: Toshkentdagi qahvaxona, auditoriya 20–35 yosh, yangi kuzgi menyu, maqsad — yetkazib berishni oshirish"></textarea></div>
      <div class="field"><label class="eyebrow">Muddat</label><div class="seg">${[7, 14, 30].map((d) => `<button class="${f.days === d ? 'on' : ''}" data-a="days" data-v="${d}">${d} kun</button>`).join('')}</div></div>
      <div class="two field"><label><span class="eyebrow">Boshlanish</span><input type="date" id="start" value="${f.start}"></label><label><span class="eyebrow">Haftasiga</span><div class="stepper"><button data-a="step" data-d="-1">−</button><b id="pw" class="num" style="flex:1;text-align:center;font-size:18px">${f.perWeek}</b><button data-a="step" data-d="1">+</button></div></label></div>
      <div class="field"><label class="eyebrow">Platformalar</label><div class="chips wrapc">${PL.map((v) => `<button class="chip ${f.platforms.includes(v) ? 'on' : ''}" data-a="pl" data-v="${v}">${PLATFORMS[v][0]}</button>`).join('')}</div></div>
      <div style="margin-top:20px"><button class="btn" data-a="gen">${I('ai', 's')} Reja tuzish</button><div class="tiny mute" style="text-align:center;margin-top:8px">3 ta AI so‘rov · bu oy ${ent.aiUsed} / ${ent.aiQuota}</div></div>
      <div id="res"></div>`;
    function showResult() {
      s.el.querySelector('#res').innerHTML = `<div class="hr"></div><div class="eyebrow" style="margin-bottom:4px">Taklif · ${result.length} post</div>
        ${result.map((x, i) => `<button class="sug on" data-a="tog" data-i="${i}"><span class="check">${I('check')}</span><div style="min-width:0;flex:1"><div class="meta"><span>${fmtDay(x.date)}</span>${x.time ? `<span class="num">${x.time}</span>` : ''}<span class="pl">${PLATFORMS[x.platform][1]}</span><span>${KINDS[x.kind]}</span></div><div class="ti" style="font-weight:600;margin:3px 0">${esc(x.title)}</div><div class="small mute" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(x.body)}</div></div></button>`).join('')}
        <div style="position:sticky;bottom:0;padding:14px 0 4px;background:var(--paper)"><button class="btn" data-a="add" id="addb"></button></div>`;
      updateAdd();
      s.el.querySelector('#res').scrollIntoView({ behavior: 'smooth' });
    }
    function updateAdd() {
      const n = result.filter((x) => x.on).length;
      const b = s.el.querySelector('#addb');
      b.textContent = n ? `Kalendarga qo‘shish · ${n}` : 'Postlarni tanlang';
      b.disabled = !n;
    }
  }

  // ---------------------------------------------------------------- plans & payment
  function upgradeSheet(msg) {
    const s = sheet(`<div style="text-align:center;padding:6px 4px 0"><span class="picon lg" style="margin:0 auto 14px;background:var(--ink);color:var(--inv)">${I('crown', 'l')}</span>
      <h2 class="t">Imkoniyatni kengaytiring</h2><p class="mute" style="margin:10px 0 20px">${esc(msg)}</p>
      <button class="btn" data-a="plans">Tariflarni ko‘rish</button><button class="btn ghost" style="margin-top:10px" data-a="close">Keyinroq</button></div>`, {
      close: () => closeSheet(s),
      plans: () => { closeAll(); go('plans'); },
    });
  }

  VIEWS.plans = (st) => {
    const b = S.boot;
    on.back = back;
    if (!b) return skeleton();
    st.period ||= 'month';
    const t = b.team;
    st.seats ||= Math.max(t.minSeats, b.ent.team?.role === 'owner' ? b.ent.team.seats : 5);
    const month = st.period === 'month';
    const maxSave = Math.max(0, ...b.plans.filter((p) => p.month && p.year).map((p) => Math.round((1 - p.year / (p.month * 12)) * 100)));
    on.period = (el) => { st.period = el.dataset.v; render(); };
    on.buy = (el) => pay(el, { kind: 'plan', planId: el.dataset.id, period: st.period });
    on.seat = (el) => { st.seats = Math.min(t.maxSeats, Math.max(t.minSeats, st.seats + +el.dataset.d)); updateTeam(); };
    on.buyTeam = (el) => pay(el, { kind: 'team', period: st.period, seats: st.seats, teamName: document.getElementById('tname')?.value || '' });
    const cur = b.ent.plan;
    const feat = (p) => [
      p.maxProjects ? `${p.maxProjects} ta loyiha` : 'Cheksiz loyihalar',
      p.maxPosts ? `Loyihaga ${p.maxPosts} ta post` : 'Cheksiz postlar',
      'Kalendar, eslatmalar, ulashish',
      p.ai ? `AI yordamchi · oyiga ${p.aiQuota} so‘rov` : null,
    ].filter(Boolean);
    const planCard = (p, i) => {
      const price = month ? p.month : p.year;
      const isCur = cur.id === p.id;
      const dark = p.ai && !isCur;
      return `<div class="card plan ${isCur ? 'cur' : ''} ${dark ? 'dark' : ''}">
        <div class="row"><b style="font-size:17px">${esc(p.name)}</b><span class="sp"></span>${isCur ? '<span class="badge fill">Joriy</span>' : p.ai ? '<span class="badge">AI</span>' : ''}</div>
        <div class="price num">${money(price)}</div><div class="mute small">${price ? (month ? 'oyiga' : `yiliga · oyiga ${money(Math.round(price / 12))}`) : 'doim'}</div>
        <ul>${feat(p).map((x) => `<li>${I('check')}${x}</li>`).join('')}${!p.ai ? `<li class="mute">${I('lock')}AI yordamchi yo‘q</li>` : ''}</ul>
        ${price ? `<button class="btn ${dark ? '' : isCur ? 'ghost' : ''}" data-a="buy" data-id="${p.id}">${isCur ? 'Uzaytirish' : 'Tanlash'}</button>` : ''}
        ${isCur && cur.until ? `<div class="tiny mute" style="text-align:center;margin-top:8px">${fmtDate(cur.until)} gacha faol</div>` : ''}
      </div>`;
    };
    setTimeout(updateTeam);
    return `<header class="top">${backBtn()}<h2 class="t grow">Tariflar</h2></header>
      <div class="wrap">
        <div class="seg" style="margin-top:8px"><button class="${month ? 'on' : ''}" data-a="period" data-v="month">Oylik</button><button class="${!month ? 'on' : ''}" data-a="period" data-v="year">Yillik${maxSave ? ` · −${maxSave}%` : ''}</button></div>
        <div class="list" style="margin-top:16px">${b.plans.map(planCard).join('')}</div>
        <div class="sec"><span class="eyebrow">Jamoa uchun</span></div>
        <div class="card plan">
          <div class="row"><span class="picon">${I('users')}</span><div><b style="font-size:17px">Jamoa</b><div class="mute small">Har bir xodim uchun alohida to‘lov</div></div></div>
          <ul><li>${I('check')}Rahbar vazifa va muddat beradi — xodim bajarib tasdiqlaydi</li><li>${I('check')}Har bir xodimning faolligi va muddatida bajarish foizi</li><li>${I('check')}Umumiy loyihalar, cheksiz post${t.ai ? ', AI yordamchi' : ''}</li></ul>
          <div class="row" style="justify-content:space-between"><span class="eyebrow">Odamlar soni</span><div class="stepper"><button data-a="seat" data-d="-1">−</button><b id="seats" class="num" style="min-width:48px;text-align:center;font-size:20px">${st.seats}</b><button data-a="seat" data-d="1">+</button></div></div>
          ${b.ent.team ? '' : `<div class="field"><input id="tname" maxlength="60" placeholder="Jamoa nomi (masalan: Agentlik)"></div>`}
          <div class="hr"></div>
          <div class="row"><div><div class="price num" id="ttotal" style="margin:0"></div><div class="mute small" id="tunit"></div></div></div>
          <button class="btn" style="margin-top:16px" data-a="buyTeam">${b.ent.team?.role === 'owner' ? 'Jamoani uzaytirish' : 'Jamoa ochish'}</button>
          <div class="tiny mute" style="margin-top:10px;text-align:center">${t.bulkFrom}+ kishi — har biriga ${money(month ? t.bulkMonth : t.bulkYear)}</div>
        </div>
        <div style="height:40px"></div>
      </div>`;
    function updateTeam() {
      const el = document.getElementById('ttotal');
      if (!el) return;
      const bulk = st.seats >= t.bulkFrom;
      const unit = month ? (bulk ? t.bulkMonth : t.seatMonth) : bulk ? t.bulkYear : t.seatYear;
      document.getElementById('seats').textContent = st.seats;
      el.textContent = money(unit * st.seats);
      document.getElementById('tunit').textContent = `${money(unit)} × ${st.seats} kishi · ${month ? 'oyiga' : 'yiliga'}`;
      hap();
    }
  };

  async function pay(el, body) {
    if (!S.boot.pay) return toast('To‘lov hali sozlanmagan. Admin bilan bog‘laning.');
    await busy(el, async () => {
      try {
        const r = await api('POST', '/api/pay', body);
        if (r.invoiceLink && tg?.openInvoice) {
          tg.openInvoice(r.invoiceLink, (status) => {
            if (status === 'paid') { hapOk(); toast('To‘lov qabul qilindi'); setTimeout(refreshBoot, 1500); }
          });
          return;
        }
        const s = sheet(`<div class="sh"><span class="eyebrow">To‘lov #${r.id}</span><span class="sp"></span><button class="ib" data-a="close">${I('close')}</button></div>
          <div class="price num" style="font:500 34px/1 var(--serif)">${money(r.amount)}</div>
          <div class="card row" style="padding:14px;margin-top:18px"><span class="picon sm">${I('money')}</span><div class="grow"><b class="num" style="letter-spacing:.04em">${esc(r.card.number)}</b><div class="tiny mute">${esc(r.card.holder || '')}</div></div><button class="ib" data-a="copy">${I('copy', 's')}</button></div>
          <ol class="small" style="padding-left:18px;line-height:1.7;margin:18px 0">
            <li>Kartaga <b>${money(r.amount)}</b> o‘tkazing.</li><li>Chek rasmini <b>botga</b> yuboring — bot sizga yozib qo‘ydi.</li><li>Admin tasdiqlashi bilan obuna yoqiladi va bot xabar beradi.</li></ol>
          <button class="btn" data-a="bot">${I('send', 's')} Botga o‘tish</button>`, {
          close: () => closeSheet(s),
          copy() { navigator.clipboard?.writeText(r.card.number.replace(/\s/g, '')).then(() => { hapOk(); toast('Karta raqami nusxalandi'); }); },
          bot() { const u = `https://t.me/${r.bot || S.boot.bot}`; tg ? (tg.openTelegramLink(u), tg.close()) : open(u, '_blank'); },
        });
      } catch (e) { fail(e); }
    });
  }

  // ---------------------------------------------------------------- profile
  VIEWS.profile = () => {
    const b = S.boot;
    if (!b) return skeleton() + tabbar('profile');
    const e = b.ent;
    on.plans = () => go('plans');
    on.team = () => tab('team');
    on.admin = () => go('admin');
    on.archive = () => go('archive');
    on.theme = (el) => { setTheme(el.dataset.v); render(); };
    on.help = () => { const u = `https://t.me/${b.bot}`; tg ? tg.openTelegramLink(u) : open(u, '_blank'); };
    const aiPct = e.aiQuota ? Math.min(100, Math.round((e.aiUsed / e.aiQuota) * 100)) : 0;
    const archived = b.projects.filter((p) => p.archived).length;
    return `<header class="top"><div class="mark grow">${logo}<span>${NAME}</span></div></header>
      <div class="wrap">
        <div class="row" style="margin-top:10px;gap:16px"><span class="av lg">${initials(b.me.name)}</span><div style="min-width:0"><h2 class="t ell">${esc(b.me.name)}</h2><div class="mute small">${b.me.username ? '@' + esc(b.me.username) : `ID ${b.me.id}`}</div></div></div>
        <div class="card" style="padding:18px;margin-top:22px">
          <div class="row"><div class="grow"><div class="eyebrow">Tarif</div><b style="font:500 22px/1.3 var(--serif)">${esc(e.plan.name)}${e.team?.active ? ` <span class="mute" style="font-size:15px">+ jamoa</span>` : ''}</b><div class="tiny mute">${e.plan.until ? `${fmtDate(e.plan.until)} gacha` : e.team?.active ? `Jamoa: ${fmtDate(e.team.until)} gacha` : 'Bepul tarif'}</div></div><button class="btn sm ${e.plan.id === 'free' && !e.team?.active ? '' : 'ghost'}" data-a="plans">${e.plan.id === 'free' && !e.team?.active ? 'Oshirish' : 'Tariflar'}</button></div>
          ${e.ai ? `<div class="hr"></div><div class="row small"><span>${I('ai', 's')}</span><span class="grow">AI bu oy</span><b class="num">${e.aiUsed} / ${e.aiQuota}</b></div><div class="meter" style="margin-top:8px"><i style="width:${aiPct}%"></i></div>` : ''}
        </div>
        <div class="card menu" style="margin-top:12px">
          <button class="mi" data-a="team">${I('users')}<span class="grow">Jamoa</span>${I('next', 's')}</button>
          ${archived ? `<button class="mi" data-a="archive">${I('archive')}<span class="grow">Arxiv</span><span class="mute num small">${archived}</span></button>` : ''}
          <button class="mi" data-a="help">${I('help')}<span class="grow">Yordam va takliflar</span>${I('next', 's')}</button>
          ${b.me.admin ? `<button class="mi" data-a="admin">${I('chart')}<span class="grow">Admin panel</span>${I('next', 's')}</button>` : ''}
        </div>
        <div class="field" style="margin-top:22px"><label class="eyebrow">Ko‘rinish</label>${themeRow()}
          <div class="tiny mute" style="margin-top:8px">«Sariq» — ko‘zni charchatmaydi.${curTheme() === 'auto' ? ' Hozir Telegram rangiga moslashgan.' : ` <button class="link tiny" data-a="theme" data-v="auto">Telegram rangiga qaytarish</button>`}</div></div>
        <p class="tiny mute" style="text-align:center;margin-top:30px">${NAME} · SMM kontent reja</p>
      </div>${tabbar('profile')}`;
  };

  // ---------------------------------------------------------------- chunks (team, admin)
  const mods = {};
  function chunk(name, st) {
    if (mods[name]) return mods[name].render(st);
    import(`./${CHUNKS[name]}`)
      .then((m) => {
        mods[name] = m.default(App);
        if (top().v === st.v) render();
      })
      .catch(() => toast('Yuklab bo‘lmadi. Internetni tekshiring.'));
    return skeleton() + (st.v === 'team' ? tabbar('team') : '');
  }
  VIEWS.team = (st) => chunk('team', st);
  VIEWS.admin = (st) => chunk('admin', st);

  // what the chunks may use
  const App = {
    S, api, cached, LS, esc, I, P, ring, projIcon, money, fmtDate, fmtDT, fmtDay, ago, initials, ymd, today, pad,
    go, back, tab, render, sheet, closeSheet, closeAll, toast, fail, busy, hap, hapOk, tabbar, backBtn, skeleton, openProject, refreshBoot,
    on: (h) => Object.assign(on, h),
    top,
    get tg() { return tg; },
  };

  // ---------------------------------------------------------------- start
  async function refreshBoot() {
    const prev = S.boot;
    const b = await cached('boot', '/api/boot');
    S.boot = b;
    const t = top().v;
    if (prev !== b && JSON.stringify(prev) !== JSON.stringify(b) && ['home', 'profile', 'plans', 'archive'].includes(t) && !sheets.length) render();
    return b;
  }

  async function start() {
    if (!initData && !devId) {
      // the SDK may still be loading: give it a moment, it carries the launch data too
      for (let i = 0; i < 30 && !initData; i++) {
        await new Promise((r) => setTimeout(r, 100));
        tgReady();
      }
    }
    if (!initData && !devId) {
      root.innerHTML = `<div class="wrap" style="padding-top:20vh;text-align:center"><div class="mark" style="justify-content:center;font-size:30px">${logo}<span>${NAME}</span></div><p class="mute" style="margin-top:16px">Ilovani Telegram ichida oching.</p></div>`;
      return;
    }
    const startParam = launch.get('tgWebAppStartParam') || tg?.initDataUnsafe?.start_param || qs.get('join') || '';
    const v = qs.get('v');
    if (v && ['team', 'plans', 'admin', 'profile'].includes(v)) S.stack = v === 'team' || v === 'profile' ? [{ v }] : [{ v: 'home' }, { v }];
    render();
    try {
      await refreshBoot();
      if (!S.boot) throw new Error('boot');
      render();
    } catch (e) {
      if (!S.boot) root.innerHTML = `<div class="wrap" style="padding-top:20vh;text-align:center"><b style="font:500 22px var(--serif)">Ulanib bo‘lmadi</b><p class="mute">${esc(e.message)}</p><button class="btn sm" onclick="location.reload()">Qayta urinish</button></div>`;
      else toast(e.message);
      return;
    }
    if (/^[jt]_[\w-]+$/.test(startParam)) {
      try {
        const r = await api('POST', '/api/join', { code: startParam });
        await refreshBoot();
        if (r.projectId) openProject(r.projectId);
        else if (r.teamId) { toast('Jamoaga qo‘shildingiz'); tab('team'); }
      } catch (e) { fail(e); }
    } else if (qs.get('p')) openProject(+qs.get('p'), qs.get('post'));

    // back from another app or chat: refresh quietly (each is one small request, 304 when unchanged)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      refreshBoot().catch(() => {});
      const t = top();
      if (t.v === 'project') sync(t.id);
    });
    // later: service worker for instant second launch, and the chunks this user will likely open
    const idle = window.requestIdleCallback || ((f) => setTimeout(f, 1500));
    idle(() => {
      if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
      if (S.boot?.ent.team) import(`./${CHUNKS.team}`).catch(() => {});
      if (S.boot?.me.admin) import(`./${CHUNKS.admin}`).catch(() => {});
    });
  }
  on.back = back;
  start();
})();
