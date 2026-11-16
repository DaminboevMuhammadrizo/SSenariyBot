// Admin panel (lazy chunk, only loaded for the admin): statistics in numbers and %, plan prices,
// team pricing and payment card, payments to approve, users (search, grant a plan), broadcast.
export default (A) => {
  const { esc, I, money, fmtDate, ago, initials } = A;
  let stats = null;
  let cfg = null;
  let pays = null;
  let users = null;
  const STATUS = { idea: 'G‘oya', draft: 'Jarayonda', review: 'Tekshiruvda', ready: 'Tayyor', published: 'Chiqdi' };
  const TSTATUS = { open: 'Ochiq', done: 'Tekshiruvda', approved: 'Tasdiqlangan' };
  const KIND = { plan: 'Kontent reja', caption: 'Matn yozish', improve: 'Yaxshilash', hashtags: 'Heshteglar' };
  const num = (n) => String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const rerender = () => A.top().v === 'admin' && A.render();

  async function loadStats() {
    try {
      stats = await A.cached('admin:stats', '/api/admin/stats');
      rerender();
    } catch (e) { A.fail(e); }
  }
  async function loadCfg() {
    try { cfg = await A.api('GET', '/api/admin/plans'); rerender(); } catch (e) { A.fail(e); }
  }
  async function loadPays(status) {
    try { pays = { status, list: (await A.api('GET', `/api/admin/payments?status=${status}`)).payments }; rerender(); } catch (e) { A.fail(e); }
  }
  async function loadUsers(q = '', f = 'all', more = false) {
    try {
      const r = await A.api('GET', `/api/admin/users?q=${encodeURIComponent(q)}&f=${f}&offset=${more ? users.next : 0}`);
      users = { q, f, next: r.next, list: more ? [...users.list, ...r.users] : r.users };
      rerender();
    } catch (e) { A.fail(e); }
  }

  // ---------------------------------------------------------------- building blocks
  const kpi = (label, value, sub = '') => `<div class="card kpi"><small>${label}</small><b>${value}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
  const prow = (label, n, pct, extra = '') => `<div class="prow"><span>${label}</span><b>${n}</b><span class="mute small num" style="min-width:52px;text-align:right">${pct}%</span>${extra}<div class="meter"><i style="width:${Math.min(100, pct)}%"></i></div></div>`;
  const line = (label, value) => `<div class="prow" style="grid-template-columns:1fr auto"><span class="mute">${label}</span><b class="num">${value}</b></div>`;
  const bars = (series, key, label) => {
    const max = Math.max(1, ...series.map((d) => d[key]));
    return `<div class="card" style="padding:16px;margin-top:10px"><div class="row"><span class="eyebrow grow">${label}</span><span class="tiny mute num">bugun ${series[series.length - 1][key]} · max ${max}</span></div>
      <div class="bars">${series.map((d) => `<i class="${d[key] ? '' : 'z'}" title="${d.day}: ${d[key]}" style="height:${d[key] ? Math.max(4, (d[key] / max) * 100) : 2}%"></i>`).join('')}</div>
      <div class="row tiny mute" style="justify-content:space-between;margin-top:6px"><span>${series[0].day.slice(5).split('-').reverse().join('.')}</span><span>bugun</span></div></div>`;
  };
  const sec = (t) => `<div class="sec"><span class="eyebrow">${t}</span></div>`;

  // ---------------------------------------------------------------- tabs
  function statsTab() {
    if (!stats) return '<div class="shimmer" style="height:120px"></div><div class="shimmer" style="height:240px"></div>';
    const { users: u, subs, revenue: r, ai, content: c, series, system: sy } = stats;
    return `
      <div class="kpis" style="margin-top:14px">
        ${kpi('Foydalanuvchilar', num(u.total), `bugun +${u.newToday} · 7 kun +${u.new7}`)}
        ${kpi('Bugun faol', `${u.dau}`, `${u.dauPct}% · DAU/MAU ${u.stickiness}%`)}
        ${kpi('Pullik', `${subs.paid}`, `${subs.paidPct}% · konversiya ${r.conversion}%`)}
        ${kpi('Daromad · oy', money(r.month), `${r.monthCount} ta to‘lov`)}
      </div>
      ${bars(series, 'dau', 'Faol foydalanuvchilar · 14 kun')}

      ${sec('Faollik')}
      <div class="card" style="padding:4px 16px">
        ${prow('Bugun', u.dau, u.dauPct)}${prow('7 kun', u.wau, u.wauPct)}${prow('30 kun', u.mau, u.mauPct)}
        ${line('Yangi: 30 kun', u.new30)}${line('Botni bloklagan', u.blocked)}
      </div>

      ${sec('Tariflar')}
      <div class="card" style="padding:4px 16px">${subs.plans.map((p) => prow(esc(p.name), p.n, p.pct)).join('')}
        ${line('Faol jamoalar', `${subs.teams} · ${subs.teamMembers} / ${subs.seats} o‘rin (${subs.seatFill}%)`)}</div>

      ${sec('Daromad')}
      <div class="card" style="padding:4px 16px">
        ${line('Bu oy', money(r.month))}${line('Jami', money(r.total))}${line('To‘lovlar soni', r.count)}${line('O‘rtacha chek', money(r.avg))}${line('Tasdiq kutmoqda', r.pending)}
        ${r.byKind.map((k) => line(`${esc(k.plan)} · ${k.period === 'year' ? 'yillik' : 'oylik'} · ${k.n} ta`, money(k.sum))).join('')}
      </div>

      ${sec(`AI · ${ai.enabled ? esc(ai.model) : 'o‘chirilgan'}`)}
      <div class="kpis">
        ${kpi('So‘rovlar · oy', num(ai.requests), `muvaffaqiyatli ${ai.success}% · keshdan ${ai.cachedPct}%`)}
        ${kpi('Limitdan ishlatildi', `${ai.quotaUsed}%`, `${num(ai.used)} / ${num(ai.quota)} birlik`)}
        ${kpi('AI ishlatganlar', `${ai.users}`, `huquqi borlarning ${ai.adoption}% · hammaning ${ai.usersPct}%`)}
        ${kpi('Tokenlar · oy', num(ai.tokensIn + ai.tokensOut), `kirish ${num(ai.tokensIn)} · chiqish ${num(ai.tokensOut)}`)}
      </div>
      <div class="card" style="padding:4px 16px;margin-top:10px">
        ${ai.byKind.length ? ai.byKind.map((k) => prow(KIND[k.kind] || k.kind, k.req, k.pct)).join('') : '<div class="prow mute">Bu oy so‘rov yo‘q</div>'}
        ${line('Hamma vaqt: so‘rov / token', `${num(ai.allTimeRequests)} / ${num(ai.allTimeTokens)}`)}
      </div>
      ${bars(series, 'ai', 'AI so‘rovlari · 14 kun')}

      ${sec('Kontent')}
      <div class="kpis">${kpi('Loyihalar', c.activeProjects, `jami ${c.projects} · ulashilgan ${c.sharedProjects}`)}${kpi('Postlar', num(c.posts), `7 kun +${c.posts7} · ${c.perUser} / odam`)}${kpi('Baho', `${c.approval}%`, `👍 ${c.up} · 👎 ${c.down}`)}${kpi('Izohlar', c.comments)}</div>
      <div class="card" style="padding:4px 16px;margin-top:10px">${c.byStatus.map((s) => prow(STATUS[s.status] || s.status, s.n, s.pct)).join('')}</div>
      <div class="card" style="padding:4px 16px;margin-top:10px">${c.byPlatform.map((s) => prow(esc(s.platform), s.n, s.pct)).join('')}</div>

      ${sec('Jamoa vazifalari')}
      <div class="card" style="padding:4px 16px">${c.tasksByStatus.map((s) => prow(TSTATUS[s.status] || s.status, s.n, s.pct)).join('')}${line('Kechikkan (ochiq)', c.overdue)}${line('O‘z vaqtida bajarilgan', `${c.onTime}%`)}</div>
      ${bars(series, 'joined', 'Yangi foydalanuvchilar · 14 kun')}

      ${sec('Server')}
      <div class="card" style="padding:4px 16px">${line('RAM (RSS / heap)', `${sy.rssMb} / ${sy.heapMb} MB`)}${line('Kesh', `${sy.cache.mb} / ${sy.cache.maxMb} MB · hit ${Math.round(sy.cache.hitRate * 100)}%`)}${line('Baza', `${sy.dbMb} MB`)}${line('Ishlash vaqti', `${sy.uptimeH} soat · ${esc(sy.node)}`)}</div>
      <p class="tiny mute" style="text-align:center">Yangilandi: ${ago(stats.at)}</p>`;
  }

  function plansTab() {
    if (!cfg) return '<div class="shimmer" style="height:240px"></div>';
    const t = cfg.team;
    const field = (id, label, value, type = 'number') => `<label><span class="eyebrow">${label}</span><input id="${id}" type="${type}" inputmode="${type === 'number' ? 'numeric' : 'text'}" value="${esc(value)}"></label>`;
    const planForm = (p) => `<div class="card" style="padding:16px;margin-top:10px" data-plan="${esc(p.id)}">
        <div class="row"><b class="grow">${esc(p.name)} <span class="mute tiny">${esc(p.id)}</span></b>${p.id !== 'free' ? `<button class="toggle ${p.active ? 'on' : ''}" data-a="pactive" title="Sotuvda"></button>` : ''}</div>
        <div class="formgrid tbl" style="margin-top:12px">
          ${field('name', 'Nomi', p.name, 'text')}${field('sort', 'Tartib', p.sort)}
          ${p.id === 'free' ? '' : field('month', '1 oylik, so‘m', p.month) + field('year', '1 yillik, so‘m', p.year)}
          ${field('maxProjects', 'Loyihalar (0 = cheksiz)', p.maxProjects)}${field('maxPosts', 'Post/loyiha (0 = cheksiz)', p.maxPosts)}
          ${field('aiQuota', 'AI limit / oy', p.aiQuota)}
          <label class="row" style="flex-direction:row;align-items:center;gap:10px;margin-top:18px"><button class="toggle ${p.ai ? 'on' : ''}" data-a="pai"></button><span>AI yoqilgan</span></label>
        </div>
        <div class="row" style="margin-top:14px"><button class="btn sm" data-a="psave">Saqlash</button>${p.id !== 'free' ? '<button class="btn sm ghost" data-a="pdel">O‘chirish</button>' : ''}</div>
      </div>`;
    return `
      ${sec('Shaxsiy tariflar')}${cfg.plans.map(planForm).join('')}
      <button class="btn ghost" style="margin-top:10px" data-a="pnew">${I('plus', 's')} Yangi tarif</button>

      ${sec('Jamoa narxi (har bir kishi uchun)')}
      <div class="card" style="padding:16px"><div class="formgrid tbl" id="teamf">
        ${field('seatMonth', '1 oy / kishi', t.seatMonth)}${field('seatYear', '1 yil / kishi', t.seatYear)}
        ${field('bulkFrom', 'Ulgurji: necha kishidan', t.bulkFrom)}<span></span>
        ${field('bulkMonth', 'Ulgurji 1 oy / kishi', t.bulkMonth)}${field('bulkYear', 'Ulgurji 1 yil / kishi', t.bulkYear)}
        ${field('minSeats', 'Kamida', t.minSeats)}${field('maxSeats', 'Ko‘pi bilan', t.maxSeats)}
        ${field('aiQuota', 'AI limit / kishi / oy', t.aiQuota)}
        <label class="row" style="flex-direction:row;align-items:center;gap:10px;margin-top:18px"><button class="toggle ${t.ai ? 'on' : ''}" data-a="tai"></button><span>Jamoada AI</span></label>
      </div>
      <p class="tiny mute">Masalan: 13 000 so‘m × 10 kishi = 130 000 so‘m/oy; ${t.bulkFrom}+ kishi bo‘lsa ulgurji narx.</p>
      <button class="btn sm" data-a="tsave">Saqlash</button></div>

      ${sec(`To‘lov · ${cfg.payment === 'invoice' ? 'Telegram Payments' : 'karta + chek'}`)}
      <div class="card" style="padding:16px"><div class="col tbl" id="cardf">
        ${field('number', 'Karta raqami', cfg.card.number, 'text')}${field('holder', 'Egasi', cfg.card.holder, 'text')}${field('note', 'Qo‘shimcha izoh', cfg.card.note, 'text')}
      </div><button class="btn sm" style="margin-top:12px" data-a="csave">Saqlash</button>
      ${cfg.payment === 'invoice' ? '<p class="tiny mute">PAYMENT_PROVIDER_TOKEN o‘rnatilgan — to‘lov Telegram ichida (Click/Payme). Karta ishlatilmaydi.</p>' : ''}</div>
      <div style="height:30px"></div>`;
  }

  function paysTab() {
    if (!pays) return '<div class="shimmer" style="height:200px"></div>';
    const chips = [['pending', 'Kutilmoqda'], ['paid', 'Tasdiqlangan'], ['rejected', 'Rad etilgan'], ['new', 'Chek yo‘q'], ['all', 'Hammasi']]
      .map(([k, l]) => `<button class="chip ${pays.status === k ? 'on' : ''}" data-a="pstat" data-v="${k}">${l}</button>`).join('');
    const row = (p) => `<div class="card" style="padding:14px 16px;margin-top:10px">
        <div class="row"><span class="av">${initials(p.name)}</span><div class="grow" style="min-width:0"><b class="ell" style="display:block">${esc(p.name)}</b><div class="tiny mute">${p.username ? '@' + esc(p.username) + ' · ' : ''}<span class="num">${p.uid}</span></div></div><b class="num">${money(p.amount)}</b></div>
        <div class="meta" style="margin-top:8px"><span>#${p.id}</span><span>${p.kind === 'team' ? `Jamoa · ${p.seats} kishi${p.teamName ? ' · ' + esc(p.teamName) : ''}` : esc(p.planName)}</span><span>${p.period === 'year' ? '1 yil' : '1 oy'}</span><span>${ago(p.at)}</span>${p.receipt ? '<span class="badge">chek botda</span>' : ''}${p.status !== 'pending' ? `<span class="badge ${p.status === 'paid' ? 'fill' : ''}">${{ paid: 'tasdiqlangan', rejected: 'rad etilgan', new: 'chek yo‘q' }[p.status] || p.status}</span>` : ''}</div>
        ${p.status === 'pending' || p.status === 'new' ? `<div class="two" style="margin-top:12px"><button class="btn sm ghost" style="width:100%" data-a="pno" data-id="${p.id}">Rad etish</button><button class="btn sm" style="width:100%" data-a="pok" data-id="${p.id}">${I('check', 's')} Tasdiqlash</button></div>` : ''}
      </div>`;
    return `<div class="chips" style="margin-top:14px">${chips}</div>${pays.list.map(row).join('') || '<div class="empty">To‘lov yo‘q</div>'}
      <p class="tiny mute" style="text-align:center">Chek rasmlari bot orqali sizga keladi — o‘sha yerdan ham tasdiqlash mumkin.</p><div style="height:20px"></div>`;
  }

  function usersTab() {
    if (!users) return '<div class="shimmer" style="height:200px"></div>';
    const chips = [['all', 'Hammasi'], ['paid', 'Pullik'], ['ai', 'AI ishlatgan']].map(([k, l]) => `<button class="chip ${users.f === k ? 'on' : ''}" data-a="uf" data-v="${k}">${l}</button>`).join('');
    return `<div class="row" style="margin-top:14px"><input id="uq" placeholder="Ism, @username yoki ID" value="${esc(users.q)}"><button class="ib" data-a="usearch">${I('search')}</button></div>
      <div class="chips" style="margin-top:10px">${chips}</div>
      <div class="card" style="padding:0 16px;margin-top:10px">${users.list.map((u) => `<button class="mem" style="width:100%;text-align:left" data-a="user" data-id="${u.id}"><span class="av">${initials(u.name)}</span><div class="grow" style="min-width:0"><b class="ell" style="display:block">${esc(u.name)}</b><div class="tiny mute">${u.username ? '@' + esc(u.username) + ' · ' : ''}${u.id} · ${ago(u.lastSeen)}${u.blocked ? ' · bloklagan' : ''}</div></div><div style="text-align:right"><span class="badge ${u.plan !== 'free' ? 'fill' : ''}">${esc(u.plan)}</span><div class="tiny mute" style="margin-top:4px">${u.projects} loyiha${u.aiUsed ? ` · AI ${u.aiUsed}` : ''}</div></div></button>`).join('') || '<div class="empty">Topilmadi</div>'}</div>
      ${users.next ? '<div style="text-align:center;margin-top:12px"><button class="btn sm ghost" data-a="umore">Yana</button></div>' : ''}
      ${sec('Hammaga xabar')}
      <div class="card" style="padding:16px"><textarea id="bc" rows="3" maxlength="3500" placeholder="Bot orqali barcha foydalanuvchilarga yuboriladi"></textarea><button class="btn sm" style="margin-top:10px" data-a="bcast">${I('send', 's')} Yuborish</button></div>
      <div style="height:30px"></div>`;
  }

  // ---------------------------------------------------------------- screen
  function render(st) {
    st.tab ||= 'stats';
    if (st.tab === 'stats' && !st.loaded) { st.loaded = 1; loadStats(); }
    if (st.tab === 'plans' && !cfg) loadCfg();
    if (st.tab === 'pays' && !pays) loadPays('pending');
    if (st.tab === 'users' && !users) loadUsers();
    const planVals = (box) => {
      const v = (k) => box.querySelector(`#${k}`)?.value;
      return { name: v('name'), month: v('month'), year: v('year'), maxProjects: v('maxProjects'), maxPosts: v('maxPosts'), aiQuota: v('aiQuota'), sort: v('sort'), ai: box.querySelector('[data-a=pai]').classList.contains('on'), active: box.querySelector('[data-a=pactive]') ? box.querySelector('[data-a=pactive]').classList.contains('on') : true };
    };
    A.on({
      back: A.back,
      tabs: (el) => { st.tab = el.dataset.v; A.render(); },
      refresh: () => { stats = null; st.loaded = 0; A.render(); },
      pactive: (el) => el.classList.toggle('on'),
      pai: (el) => el.classList.toggle('on'),
      tai: (el) => el.classList.toggle('on'),
      async psave(el) {
        const box = el.closest('[data-plan]');
        await A.busy(el, async () => {
          try { cfg.plans = (await A.api('PUT', `/api/admin/plans/${box.dataset.plan}`, planVals(box))).plans; A.hapOk(); A.toast('Tarif saqlandi'); A.refreshBoot(); } catch (e) { A.fail(e); }
        });
      },
      async pdel(el) {
        const box = el.closest('[data-plan]');
        if (!el.dataset.sure) { el.dataset.sure = 1; el.textContent = 'Yana bosing'; return; }
        try { const r = await A.api('DELETE', `/api/admin/plans/${box.dataset.plan}`); cfg.plans = r.plans; A.toast(r.hidden ? 'Obunachilari bor — sotuvdan olindi' : 'O‘chirildi'); A.render(); A.refreshBoot(); } catch (e) { A.fail(e); }
      },
      pnew() {
        const s = A.sheet(`<div class="sh"><span class="eyebrow">Yangi tarif</span><span class="sp"></span><button class="ib" data-a="close">${I('close')}</button></div>
          <div class="col"><label><span class="eyebrow">ID (lotin, masalan: business)</span><input id="nid" maxlength="24"></label><label><span class="eyebrow">Nomi</span><input id="nname" maxlength="40"></label>
          <div class="two"><label><span class="eyebrow">1 oy, so‘m</span><input id="nm" inputmode="numeric"></label><label><span class="eyebrow">1 yil, so‘m</span><input id="ny" inputmode="numeric"></label></div></div>
          <button class="btn" style="margin-top:18px" data-a="ok">Qo‘shish</button>`, {
          close: () => A.closeSheet(s),
          async ok(el) {
            const id = s.el.querySelector('#nid').value.trim().toLowerCase();
            await A.busy(el, async () => {
              try {
                cfg.plans = (await A.api('PUT', `/api/admin/plans/${encodeURIComponent(id)}`, { name: s.el.querySelector('#nname').value, month: s.el.querySelector('#nm').value, year: s.el.querySelector('#ny').value })).plans;
                A.closeSheet(s);
                A.render();
                A.refreshBoot();
              } catch (e) { A.fail(e); }
            });
          },
        });
      },
      async tsave(el) {
        const box = document.getElementById('teamf');
        const team = {};
        for (const inp of box.querySelectorAll('input')) team[inp.id] = inp.value;
        team.ai = box.querySelector('[data-a=tai]').classList.contains('on');
        await A.busy(el, async () => {
          try { cfg.team = (await A.api('PUT', '/api/admin/settings', { team })).team; A.hapOk(); A.toast('Jamoa narxi saqlandi'); A.refreshBoot(); } catch (e) { A.fail(e); }
        });
      },
      async csave(el) {
        const box = document.getElementById('cardf');
        const card = {};
        for (const inp of box.querySelectorAll('input')) card[inp.id] = inp.value;
        await A.busy(el, async () => {
          try { cfg.card = (await A.api('PUT', '/api/admin/settings', { card })).card; A.hapOk(); A.toast('Saqlandi'); A.refreshBoot(); } catch (e) { A.fail(e); }
        });
      },
      pstat: (el) => { pays = { status: el.dataset.v, list: pays?.list || [] }; loadPays(el.dataset.v); },
      pok: (el) => decide(el, 'approve'),
      pno: (el) => decide(el, 'reject'),
      usearch: () => loadUsers(document.getElementById('uq').value, users.f),
      uf: (el) => loadUsers(users.q, el.dataset.v),
      umore: () => loadUsers(users.q, users.f, true),
      user: (el) => grantSheet(users.list.find((u) => u.id === +el.dataset.id)),
      async bcast(el) {
        const text = document.getElementById('bc').value.trim();
        if (!text) return;
        if (!el.dataset.sure) { el.dataset.sure = 1; el.textContent = 'Hammaga yuborilsinmi? Yana bosing'; return; }
        await A.busy(el, async () => {
          try { const r = await A.api('POST', '/api/admin/broadcast', { text }); A.toast(`${r.queued} kishiga navbatga qo‘yildi`); document.getElementById('bc').value = ''; } catch (e) { A.fail(e); }
        });
      },
    });
    const tabs = [['stats', 'Statistika'], ['plans', 'Narxlar'], ['pays', 'To‘lovlar'], ['users', 'Odamlar']];
    const body = { stats: statsTab, plans: plansTab, pays: paysTab, users: usersTab }[st.tab]();
    return `<header class="top">${A.backBtn()}<h2 class="t grow">Admin</h2>${st.tab === 'stats' ? `<button class="ib" data-a="refresh">${I('chart')}</button>` : ''}</header>
      <div class="wrap"><div class="chips">${tabs.map(([k, l]) => `<button class="chip ${st.tab === k ? 'on' : ''}" data-a="tabs" data-v="${k}">${l}</button>`).join('')}</div>${body}</div>`;
  }

  async function decide(el, action) {
    await A.busy(el, async () => {
      try {
        await A.api('POST', `/api/admin/payments/${el.dataset.id}`, { action });
        A.hapOk();
        A.toast(action === 'approve' ? 'Tasdiqlandi — foydalanuvchiga xabar ketdi' : 'Rad etildi');
        loadPays(pays.status);
      } catch (e) { A.fail(e); }
    });
  }

  function grantSheet(u) {
    if (!u) return;
    const plans = A.S.boot.plans;
    let planId = plans.find((p) => p.id !== 'free')?.id || 'free';
    const s = A.sheet(`<div class="sh"><span class="av lg">${initials(u.name)}</span><div><h2 class="t">${esc(u.name)}</h2><div class="mute small">${u.username ? '@' + esc(u.username) + ' · ' : ''}${u.id}</div></div><span class="sp"></span><button class="ib" data-a="close">${I('close')}</button></div>
      <div class="card" style="padding:4px 16px">
        <div class="prow" style="grid-template-columns:1fr auto"><span class="mute">Tarif</span><b>${esc(u.plan)}${u.until > Date.now() ? ` · ${fmtDate(u.until)} gacha` : ''}</b></div>
        <div class="prow" style="grid-template-columns:1fr auto"><span class="mute">Qo‘shilgan</span><b>${fmtDate(u.joinedAt)}</b></div>
        <div class="prow" style="grid-template-columns:1fr auto"><span class="mute">Loyihalar · AI bu oy</span><b>${u.projects} · ${u.aiUsed}</b></div>
      </div>
      <div class="field"><label class="eyebrow">Tarif berish</label><div class="chips wrapc">${plans.map((p) => `<button class="chip ${p.id === planId ? 'on' : ''}" data-a="pl" data-v="${p.id}">${esc(p.name)}</button>`).join('')}</div></div>
      <div class="field"><label class="eyebrow">Necha kun</label><input id="gdays" inputmode="numeric" value="30"></div>
      <button class="btn" style="margin-top:18px" data-a="grant">Berish</button>`, {
      close: () => A.closeSheet(s),
      pl(el) { planId = el.dataset.v; for (const c of el.parentElement.children) c.classList.toggle('on', c === el); },
      async grant(el) {
        await A.busy(el, async () => {
          try {
            await A.api('POST', `/api/admin/users/${u.id}/grant`, { planId, days: +s.el.querySelector('#gdays').value || 30 });
            A.hapOk();
            A.closeSheet(s);
            A.toast('Tarif berildi — foydalanuvchiga xabar ketdi');
            loadUsers(users.q, users.f);
          } catch (e) { A.fail(e); }
        });
      },
    });
  }

  return { render };
};
