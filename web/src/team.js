// Team screen (lazy chunk): tasks with deadlines (assign → done → approve / return), members with
// their activity (14-day bars, actions, tasks finished on time), invite link.
export default (A) => {
  const { esc, I, money, fmtDate, fmtDT, ago, initials } = A;
  let data = null;
  let loading = false;
  let err = null;
  const ROLE = { owner: 'Rahbar', manager: 'Menejer', member: 'Xodim' };
  const TS = { open: 'Ochiq', done: 'Tekshiruvda', approved: 'Tasdiqlangan' };

  async function load(force) {
    if (loading && !force) return;
    loading = true;
    try {
      const d = await A.cached('team', '/api/team');
      const changed = JSON.stringify(d) !== JSON.stringify(data);
      data = d;
      err = null;
      if (changed && A.top().v === 'team') A.render();
    } catch (e) {
      err = e;
      data = null;
      if (A.top().v === 'team') A.render();
    } finally {
      loading = false;
    }
  }
  const after = async () => {
    await load(true);
    A.refreshBoot().catch(() => {});
  };

  function promo() {
    A.on({ plans: () => A.go('plans') });
    return `<header class="top"><h2 class="t grow">Jamoa</h2></header>
      <div class="wrap"><div class="empty" style="padding-top:36px">${I('users')}<b>Jamoa bilan ishlang</b>Rahbar vazifa va muddat beradi, xodim bajarib tasdiqlaydi. Har bir xodimning faolligi va muddatida bajarish foizi ko‘rinib turadi.</div>
      <div class="card" style="padding:18px">
        ${[['task', 'Vazifa → bajarildi → tasdiqlandi', 'Muddatdan oldin eslatma, kechiksa rahbarga xabar'], ['chart', 'Xodim faolligi', '14 kunlik grafik, amallar soni, o‘z vaqtida bajarish %'], ['grid', 'Umumiy loyihalar', 'Butun jamoa bitta kontent kalendarda']]
          .map(([i, t, d]) => `<div class="row" style="align-items:flex-start;padding:8px 0"><span class="picon sm">${I(i)}</span><div><b>${t}</b><div class="small mute">${d}</div></div></div>`).join('')}
        <div class="hr"></div>
        <div class="small mute">Narx: har bir kishi uchun ${money(A.S.boot?.team.seatMonth || 0)} / oy · ${A.S.boot?.team.bulkFrom}+ kishi — ${money(A.S.boot?.team.bulkMonth || 0)}</div>
        <button class="btn" style="margin-top:14px" data-a="plans">Jamoa ochish</button>
        <p class="tiny mute" style="text-align:center;margin:12px 0 0">Taklif havolasi bilan kelgan bo‘lsangiz — havolani qayta oching.</p>
      </div></div>${A.tabbar('team')}`;
  }

  const spark = (arr) => {
    const max = Math.max(1, ...arr);
    return `<span class="spark">${arr.map((n) => `<i class="${n ? '' : 'z'}" style="height:${n ? Math.max(12, (n / max) * 100) : 10}%"></i>`).join('')}</span>`;
  };
  const nameOf = (id) => data.members.find((m) => m.id === id)?.name || '—';

  function render(st) {
    if (!st.fresh) {
      // every visit to the tab re-checks (one small request, 304 when nothing changed)
      st.fresh = 1;
      if (err) err = data = null;
      load();
    }
    if (!data && !err) return A.skeleton() + A.tabbar('team');
    if (err?.status === 404) return promo();
    if (err && !data) {
      A.on({ retry: () => { err = null; A.render(); } });
      return `<header class="top"><h2 class="t grow">Jamoa</h2></header><div class="wrap"><div class="empty"><b>Yuklab bo‘lmadi</b>${esc(err.message)}<div style="margin-top:14px"><button class="btn sm" data-a="retry">Qayta urinish</button></div></div></div>${A.tabbar('team')}`;
    }
    const t = data.team;
    const me = A.S.boot.me.id;
    const boss = t.role !== 'member';
    st.tab ||= 'tasks';
    st.filter ||= boss ? 'review' : 'mine';
    A.on({
      tabs: (el) => { st.tab = el.dataset.v; A.render(); },
      filter: (el) => { st.filter = el.dataset.v; A.render(); },
      task: (el) => taskSheet(data.tasks.find((x) => x.id === +el.dataset.id)),
      add: () => newTask(),
      invite: () => inviteSheet(),
      member: (el) => memberSheet(data.members.find((m) => m.id === +el.dataset.id)),
      plans: () => A.go('plans'),
      rename: () => renameSheet(),
    });
    const used = data.members.length;
    const head = `<header class="top"><div class="grow" style="min-width:0"><div class="eyebrow">${ROLE[t.role]}</div><h2 class="t ell" ${t.role === 'owner' ? 'data-a="rename"' : ''}>${esc(t.name)}</h2></div>${boss ? `<button class="ib" data-a="invite">${I('plus')}</button>` : ''}</header>`;
    const banner = !t.active
      ? `<div class="card row" style="padding:14px;margin-top:6px;border-color:var(--ink)"><span>${I('lock')}</span><div class="grow small"><b>Obuna tugagan</b><br><span class="mute">Vazifalar faqat o‘qish uchun</span></div>${t.role === 'owner' ? '<button class="btn xs" data-a="plans">Uzaytirish</button>' : ''}</div>`
      : `<div class="meta" style="margin:2px 0 4px"><span>${I('users', 'xs')} ${used} / ${t.seats}</span><span>${I('clock', 'xs')} ${fmtDate(t.until)} gacha</span></div>`;
    const seg = `<div class="seg" style="margin-top:14px"><button class="${st.tab === 'tasks' ? 'on' : ''}" data-a="tabs" data-v="tasks">Vazifalar</button><button class="${st.tab === 'people' ? 'on' : ''}" data-a="tabs" data-v="people">Xodimlar</button></div>`;
    return `${head}<div class="wrap">${banner}${seg}${st.tab === 'tasks' ? tasks(st, me, boss) : people()}</div>
      ${boss && t.active && st.tab === 'tasks' ? `<button class="fab" data-a="add" aria-label="Vazifa">${I('plus', 'l')}</button>` : ''}${A.tabbar('team')}`;
  }

  function tasks(st, me, boss) {
    const all = data.tasks;
    const filters = [
      ['mine', 'Menga', (x) => x.assignee === me && x.status !== 'approved'],
      ['open', 'Ochiq', (x) => x.status === 'open'],
      ['review', 'Tekshiruvda', (x) => x.status === 'done'],
      ['approved', 'Tasdiqlangan', (x) => x.status === 'approved'],
      ['all', 'Hammasi', () => true],
    ];
    const f = filters.find((x) => x[0] === st.filter) || filters[0];
    const list = all.filter(f[2]);
    const chips = filters.map(([k, l, fn]) => `<button class="chip ${st.filter === k ? 'on' : ''}" data-a="filter" data-v="${k}">${l} <span class="num" style="opacity:.6">${all.filter(fn).length}</span></button>`).join('');
    return `<div class="chips" style="margin-top:14px">${chips}</div>
      ${list.length ? `<div class="card" style="margin-top:14px">${list.map((x) => taskRow(x, me)).join('')}</div>` : `<div class="empty">${I('task')}<b>Vazifa yo‘q</b>${boss ? '“+” bilan xodimga vazifa bering.' : 'Rahbar vazifa berganda shu yerda chiqadi.'}</div>`}
      <div style="height:90px"></div>`;
  }

  function taskRow(x, me) {
    const late = x.status === 'open' && x.deadline < Date.now();
    const icon = x.status === 'approved' ? A.ring('published') : x.status === 'done' ? A.ring('review') : A.ring(late ? 'draft' : 'idea');
    return `<button class="task" data-a="task" data-id="${x.id}">${icon}<div style="flex:1;min-width:0">
      <div class="ti ell" style="font-weight:600">${esc(x.title)}</div>
      <div class="meta"><span>${x.assignee === me ? 'Siz' : esc(nameOf(x.assignee))}</span><span class="num">${I('clock', 'xs')} ${fmtDT(x.deadline)}</span>${late ? '<span class="badge fill">Kechikdi</span>' : x.status === 'done' ? '<span class="badge">Tekshiruvda</span>' : ''}</div>
    </div></button>`;
  }

  function people() {
    const ms = data.members;
    const totalA7 = ms.reduce((s, m) => s + m.a7, 0);
    return `<div class="kpis" style="margin-top:14px">
        <div class="card kpi"><small>7 kunlik amallar</small><b>${totalA7}</b></div>
        <div class="card kpi"><small>Ochiq vazifalar</small><b>${data.tasks.filter((x) => x.status === 'open').length}</b></div>
      </div>
      <div class="card" style="margin-top:12px;padding:0 16px">${ms
        .map((m) => {
          const s = m.tasks;
          const ontime = s.finished ? Math.round((s.ontime / s.finished) * 100) : null;
          return `<button class="mem" style="width:100%;text-align:left" data-a="member" data-id="${m.id}"><span class="av">${initials(m.name)}</span>
            <div style="flex:1;min-width:0"><div class="row" style="gap:6px"><b class="ell">${esc(m.name)}</b>${m.role !== 'member' ? `<span class="badge">${ROLE[m.role]}</span>` : ''}</div>
            <div class="meta"><span>${m.a7} amal / 7 kun</span><span>${s.finished} bajardi${ontime !== null ? ` · ${ontime}% o‘z vaqtida` : ''}</span>${s.overdue ? `<span class="badge fill">${s.overdue} kechikkan</span>` : ''}</div>
            <div class="tiny mute">${m.lastSeen ? ago(m.lastSeen) : '—'}</div></div>${spark(m.spark)}</button>`;
        })
        .join('')}</div>
      <p class="tiny mute" style="text-align:center;margin-top:10px">Grafik — oxirgi 14 kundagi amallar (post, izoh, vazifa)</p><div style="height:40px"></div>`;
  }

  // ---------------------------------------------------------------- sheets
  function taskSheet(x) {
    if (!x) return;
    const me = A.S.boot.me.id;
    const boss = data.team.role !== 'member';
    const mine = x.assignee === me;
    const late = x.deadline < (x.doneAt || Date.now());
    const proj = data.projects.find((p) => p.id === x.projectId);
    const actions = [];
    if (data.team.active) {
      if (x.status === 'open' && (mine || boss)) actions.push(`<textarea id="note" rows="2" style="min-height:60px" placeholder="Izoh (ixtiyoriy): havola, natija…"></textarea><button class="btn" style="margin-top:10px" data-a="done">${I('check', 's')} Bajardim</button>`);
      if (x.status === 'done' && boss) actions.push(`<textarea id="note" rows="2" style="min-height:60px" placeholder="Qaytarsangiz — sababini yozing"></textarea><div class="two" style="margin-top:10px"><button class="btn ghost" data-a="reject">Qaytarish</button><button class="btn" data-a="approve">${I('check', 's')} Tasdiqlash</button></div>`);
      if (x.status === 'approved' && boss) actions.push('<button class="btn ghost" data-a="reopen">Qayta ochish</button>');
    }
    const s = A.sheet(`<div class="sh"><span class="eyebrow">${TS[x.status]}</span><span class="sp"></span><button class="ib" data-a="close">${I('close')}</button></div>
      <h2 class="t">${esc(x.title)}</h2>
      ${x.descr ? `<p class="ro" style="margin:12px 0 0">${esc(x.descr)}</p>` : ''}
      <div class="card" style="padding:4px 16px;margin-top:16px">
        <div class="prow" style="grid-template-columns:1fr auto"><span class="mute">Ijrochi</span><b>${esc(nameOf(x.assignee))}</b></div>
        <div class="prow" style="grid-template-columns:1fr auto"><span class="mute">Muddat</span><b class="num">${fmtDT(x.deadline)}${late && x.status !== 'approved' ? ' · kech' : ''}</b></div>
        <div class="prow" style="grid-template-columns:1fr auto"><span class="mute">Bergan</span><b>${esc(nameOf(x.createdBy))}</b></div>
        ${proj ? `<div class="prow" style="grid-template-columns:1fr auto"><span class="mute">Loyiha</span><b>${esc(proj.name)}</b></div>` : ''}
        ${x.doneAt ? `<div class="prow" style="grid-template-columns:1fr auto"><span class="mute">Bajarildi</span><b class="num">${fmtDT(x.doneAt)}</b></div>` : ''}
      </div>
      ${x.note ? `<div class="card" style="padding:12px 14px;margin-top:10px"><div class="eyebrow">Izoh</div><div class="ro small" style="margin-top:4px">${esc(x.note)}</div></div>` : ''}
      <div style="margin-top:18px">${actions.join('')}</div>
      ${boss ? `<div style="text-align:center;margin-top:14px"><button class="link small mute" data-a="del">Vazifani o‘chirish</button></div>` : ''}`, {
      close: () => A.closeSheet(s),
      done: (el) => act(el, 'done'),
      approve: (el) => act(el, 'approve'),
      reject: (el) => act(el, 'reject'),
      reopen: (el) => act(el, 'reopen'),
      async del(el) {
        if (!el.dataset.sure) { el.dataset.sure = 1; el.textContent = 'Rostdan o‘chirilsinmi? Yana bosing'; return; }
        try { await A.api('DELETE', `/api/tasks/${x.id}`); A.closeSheet(s); after(); } catch (e) { A.fail(e); }
      },
    });
    async function act(el, action) {
      const note = s.el.querySelector('#note')?.value || '';
      await A.busy(el, async () => {
        try {
          await A.api('PATCH', `/api/tasks/${x.id}`, { action, note });
          A.hapOk();
          A.closeSheet(s);
          A.toast({ done: 'Rahbarga yuborildi', approve: 'Tasdiqlandi', reject: 'Qaytarildi', reopen: 'Qayta ochildi' }[action]);
          after();
        } catch (e) { A.fail(e); }
      });
    }
  }

  function newTask() {
    const f = { assignee: null, projectId: null };
    const d = new Date(Date.now() + 86400e3);
    const s = A.sheet(`<div class="sh"><span class="eyebrow">Yangi vazifa</span><span class="sp"></span><button class="ib" data-a="close">${I('close')}</button></div>
      <input class="titlein" id="t-title" maxlength="200" placeholder="Nima qilish kerak?">
      <div class="field"><textarea id="t-descr" rows="3" maxlength="3000" placeholder="Batafsil: talablar, havolalar…"></textarea></div>
      <div class="field"><label class="eyebrow">Ijrochi</label><div class="chips wrapc">${data.members.map((m) => `<button class="chip" data-a="who" data-v="${m.id}"><span class="av" style="width:22px;height:22px;font-size:9px">${initials(m.name)}</span>${esc(m.name.split(' ')[0])}</button>`).join('')}</div></div>
      <div class="two field"><label><span class="eyebrow">Muddat — sana</span><input type="date" id="t-date" value="${A.ymd(d)}"></label><label><span class="eyebrow">Vaqt</span><input type="time" id="t-time" value="18:00"></label></div>
      ${data.projects.length ? `<div class="field"><label class="eyebrow">Loyiha (ixtiyoriy)</label><div class="chips">${data.projects.map((p) => `<button class="chip" data-a="proj" data-v="${p.id}">${esc(p.name)}</button>`).join('')}</div></div>` : ''}
      <div style="margin-top:22px"><button class="btn" data-a="save">Vazifa berish</button></div>
      <p class="tiny mute" style="text-align:center;margin-top:10px">Xodimga bot orqali xabar boradi, muddatdan 3 soat oldin eslatiladi.</p>`, {
      close: () => A.closeSheet(s),
      who(el) { f.assignee = +el.dataset.v; for (const c of el.parentElement.children) c.classList.toggle('on', c === el); A.hap(); },
      proj(el) { const v = +el.dataset.v; f.projectId = f.projectId === v ? null : v; for (const c of el.parentElement.children) c.classList.toggle('on', c === el && f.projectId === v); },
      async save(el) {
        const title = s.el.querySelector('#t-title').value.trim();
        if (!title) return A.toast('Vazifa nomini yozing');
        if (!f.assignee) return A.toast('Ijrochini tanlang');
        const deadline = new Date(`${s.el.querySelector('#t-date').value}T${s.el.querySelector('#t-time').value || '18:00'}:00`).getTime();
        if (!(deadline > Date.now())) return A.toast('Muddat kelajakda bo‘lsin');
        await A.busy(el, async () => {
          try {
            await A.api('POST', '/api/team/tasks', { title, descr: s.el.querySelector('#t-descr').value, assignee: f.assignee, deadline, projectId: f.projectId });
            A.hapOk();
            A.closeSheet(s);
            A.toast('Vazifa berildi');
            after();
          } catch (e) { A.fail(e); }
        });
      },
    });
    setTimeout(() => s.el.querySelector('#t-title')?.focus(), 350);
  }

  async function inviteSheet() {
    let link = data.team.invite || '';
    const s = A.sheet(`<div class="sh"><span class="eyebrow">Xodim qo‘shish</span><span class="sp"></span><button class="ib" data-a="close">${I('close')}</button></div>
      <h2 class="t">Taklif havolasi</h2><p class="mute" style="margin:8px 0 16px">Havolani ochgan xodim jamoaga qo‘shiladi. Joylar: ${data.members.length} / ${data.team.seats}.</p>
      <div class="card row" style="padding:12px 14px"><span class="mute">${I('link', 's')}</span><span id="lnk" class="ell grow small">${esc(link || '…')}</span><button class="ib" data-a="copy">${I('copy', 's')}</button></div>
      <button class="btn" style="margin-top:16px" data-a="send">${I('send', 's')} Telegram orqali yuborish</button>
      <div style="text-align:center;margin-top:14px"><button class="link small mute" data-a="reset">Havolani yangilash</button></div>`, {
      close: () => A.closeSheet(s),
      copy() { navigator.clipboard?.writeText(link).then(() => { A.hapOk(); A.toast('Nusxa olindi'); }); },
      send() {
        const u = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(`«${data.team.name}» jamoasiga qo‘shiling`)}`;
        A.tg ? A.tg.openTelegramLink(u) : open(u, '_blank');
      },
      async reset(el) { await A.busy(el, () => get(true)); A.toast('Yangi havola tayyor'); },
    });
    async function get(reset) {
      try {
        const r = await A.api('POST', '/api/team/invite', { reset });
        link = r.link || r.code;
        s.el.querySelector('#lnk').textContent = link;
      } catch (e) { A.fail(e); }
    }
    if (!link) get(false);
  }

  function memberSheet(m) {
    if (!m) return;
    const owner = data.team.role === 'owner';
    const me = A.S.boot.me.id;
    const s2 = m.tasks;
    const ontime = s2.finished ? Math.round((s2.ontime / s2.finished) * 100) : 0;
    const max = Math.max(1, ...m.spark);
    const s = A.sheet(`<div class="sh"><span class="av lg">${initials(m.name)}</span><div><h2 class="t">${esc(m.name)}</h2><div class="mute small">${ROLE[m.role]}${m.username ? ` · @${esc(m.username)}` : ''}</div></div><span class="sp"></span><button class="ib" data-a="close">${I('close')}</button></div>
      <div class="kpis"><div class="card kpi"><small>Amallar · 7 kun</small><b>${m.a7}</b></div><div class="card kpi"><small>Faol kunlar · 30</small><b>${m.days30}</b></div><div class="card kpi"><small>Bajarilgan</small><b>${s2.finished}</b></div><div class="card kpi"><small>O‘z vaqtida</small><b>${ontime}%</b></div></div>
      <div class="field"><label class="eyebrow">14 kun</label><div class="bars">${m.spark.map((n) => `<i class="${n ? '' : 'z'}" style="height:${n ? Math.max(6, (n / max) * 100) : 3}%"></i>`).join('')}</div></div>
      <div class="meta" style="margin-top:10px"><span>Ochiq: ${s2.open}</span><span>Tekshiruvda: ${s2.done}</span><span>Kechikkan: ${s2.overdue}</span><span>Oxirgi faollik: ${m.lastSeen ? ago(m.lastSeen) : '—'}</span></div>
      ${owner && m.id !== me ? `<div class="field"><label class="eyebrow">Rol</label><div class="seg"><button class="${m.role === 'member' ? 'on' : ''}" data-a="role" data-v="member">Xodim</button><button class="${m.role === 'manager' ? 'on' : ''}" data-a="role" data-v="manager">Menejer</button></div><p class="tiny mute">Menejer ham vazifa beradi va tasdiqlaydi.</p></div>
        <button class="btn danger" style="margin-top:12px" data-a="remove">Jamoadan chiqarish</button>` : ''}
      ${m.id === me && m.role !== 'owner' ? '<button class="btn ghost" style="margin-top:16px" data-a="remove">Jamoadan chiqish</button>' : ''}`, {
      close: () => A.closeSheet(s),
      async role(el) {
        for (const c of el.parentElement.children) c.classList.toggle('on', c === el);
        try { await A.api('PATCH', `/api/team/members/${m.id}`, { role: el.dataset.v }); after(); } catch (e) { A.fail(e); }
      },
      async remove(el) {
        if (!el.dataset.sure) { el.dataset.sure = 1; el.textContent = 'Rostdanmi? Yana bosing'; return; }
        await A.busy(el, async () => {
          try { await A.api('DELETE', `/api/team/members/${m.id}`); A.closeSheet(s); after(); } catch (e) { A.fail(e); }
        });
      },
    });
  }

  function renameSheet() {
    const s = A.sheet(`<div class="sh"><span class="eyebrow">Jamoa nomi</span><span class="sp"></span><button class="ib" data-a="close">${I('close')}</button></div>
      <input class="titlein" id="tn" maxlength="60" value="${esc(data.team.name)}"><button class="btn" style="margin-top:20px" data-a="save">Saqlash</button>`, {
      close: () => A.closeSheet(s),
      async save(el) {
        await A.busy(el, async () => {
          try { await A.api('PATCH', '/api/team', { name: s.el.querySelector('#tn').value }); A.closeSheet(s); after(); } catch (e) { A.fail(e); }
        });
      },
    });
  }

  return { render };
};
