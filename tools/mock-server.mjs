// UI preview without the backend and database: serves public/ and answers /api/* with sample data kept
// in memory (adding, editing, voting, comments, tasks work until restart). Only for looking at the design.
//   npm run preview   →  http://localhost:4310/?dev=1
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUB = resolve(dirname(fileURLToPath(import.meta.url)), '../public');
const PORT = Number(process.env.PORT || 4310);
const ME = 1;
const H = 36e5;
const D = 864e5;
const day = (o) => { const d = new Date(Date.now() + o * D); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// ---------------------------------------------------------------- sample data
const people = { 1: 'Aziza Karimova', 2: 'Javlon (mijoz)', 3: 'Sardor Aliyev', 4: 'Madina Yusupova' };
const projects = [
  { id: 1, name: 'Lola Coffee', icon: 'coffee', color: '#b4533c', role: 'owner', team: false, archived: false, members: [{ id: 2, role: 'viewer', name: people[2] }] },
  { id: 2, name: 'Nur Fitness', icon: 'gym', color: null, role: 'owner', team: false, archived: false, members: [] },
  { id: 3, name: 'Moda Uz', icon: 'shirt', color: '#2f6f73', role: 'owner', team: true, archived: false, members: [] },
  { id: 4, name: 'Kitob Olami', icon: 'book', color: null, role: 'viewer', team: false, archived: false, members: [] },
];
let seq = 100;
const P = (projectId, o, time, platform, kind, status, title, body = '', extra = {}) => ({
  id: ++seq, projectId, date: day(o), time, platform, kind, status, title, body, notes: '', remindAt: null, author: ME, updatedAt: Date.now(), up: [], down: [], comments: 0, ...extra,
});
const posts = [
  P(1, 0, '10:00', 'instagram', 'reels', 'ready', 'Kuzgi menyu — 3 ta yangi ichimlik', 'Hook: Kuz keldi, issiq ichimliklar vaqti ☕️\n\nYangi menyu: tarvuzli latte, olcha-kakao va zanjabil choy.\n\nBugun 14:00 gacha — ikkinchi ichimlik 50% chegirma!', { remindAt: Date.now() + H, up: [2, 4], comments: 1 }),
  P(1, 0, '18:30', 'telegram', 'post', 'draft', 'Barista bilan intervyu', '', { down: [2] }),
  P(1, 2, '12:00', 'instagram', 'carousel', 'idea', 'Latte art: 5 qadam'),
  P(1, 4, '', 'tiktok', 'video', 'review', 'Kun tartibi — ertalab 7:00'),
  P(1, 6, '09:00', 'instagram', 'story', 'idea', 'So‘rovnoma: qaysi ichimlik?'),
  P(1, -3, '09:00', 'instagram', 'story', 'published', 'Hafta aksiyasi', '', { up: [4] }),
  P(1, -1, '19:00', 'instagram', 'reels', 'published', 'Yangi filial ochilishi'),
  P(2, 1, '07:00', 'instagram', 'reels', 'ready', 'Ertalabki mashq — 10 daqiqa'),
  P(2, 3, '20:00', 'youtube', 'shorts', 'draft', 'Oqsil kokteyli retsepti'),
  P(3, 3, '13:00', 'instagram', 'carousel', 'draft', 'Kuz kolleksiyasi lookbook'),
  P(4, 0, '11:00', 'telegram', 'post', 'ready', 'Oy kitobi: “O‘tkan kunlar”'),
];
const comments = { [posts[0].id]: [{ id: 1, uid: 2, name: people[2], text: 'Zo‘r chiqibdi, faqat narxni kattaroq qiling', at: Date.now() - 50 * 6e4 }] };
const plans = [
  { id: 'free', name: 'Bepul', month: 0, year: 0, ai: false, aiQuota: 0, maxProjects: 1, maxPosts: 30, active: true, sort: 0 },
  { id: 'pro', name: 'Pro', month: 13000, year: 100000, ai: false, aiQuota: 0, maxProjects: 0, maxPosts: 0, active: true, sort: 1 },
  { id: 'pro_ai', name: 'Pro + AI', month: 26000, year: 134000, ai: true, aiQuota: 300, maxProjects: 0, maxPosts: 0, active: true, sort: 2 },
];
const teamPricing = { seatMonth: 13000, seatYear: 100000, bulkFrom: 30, bulkMonth: 10000, bulkYear: 77000, minSeats: 2, maxSeats: 500, ai: 1, aiQuota: 200 };
let card = { number: '8600 1234 5678 9012', holder: 'TARTIB MCHJ', note: '' };
const ent = { plan: { id: 'pro_ai', name: 'Pro + AI', until: Date.now() + 20 * D }, ai: true, aiQuota: 300, aiUsed: 47, maxProjects: 0, maxPosts: 0, team: { id: 1, name: 'Zamon Agency', role: 'owner', seats: 8, until: Date.now() + 25 * D, active: true } };
const members = [
  { id: 1, role: 'owner', name: people[1], username: 'aziza', lastSeen: Date.now() - 6e4, a7: 64, a30: 210, days30: 24, spark: [3, 5, 8, 2, 0, 6, 9, 12, 4, 7, 10, 6, 8, 11] },
  { id: 3, role: 'manager', name: people[3], username: 'sardor', lastSeen: Date.now() - H, a7: 31, a30: 120, days30: 18, spark: [1, 0, 4, 6, 2, 0, 0, 5, 8, 3, 2, 4, 6, 1] },
  { id: 4, role: 'member', name: people[4], username: null, lastSeen: Date.now() - 26 * H, a7: 12, a30: 70, days30: 11, spark: [0, 2, 3, 0, 0, 1, 4, 2, 0, 0, 3, 1, 0, 2] },
];
const tasks = [
  { id: 1, projectId: 3, title: 'Reels montaj — kuz kolleksiyasi', descr: 'Musiqa: trenddagi, 15 soniya', assignee: 4, createdBy: 1, deadline: Date.now() + 5 * H, status: 'open', note: '', doneAt: 0 },
  { id: 2, projectId: null, title: 'Story dizayn — aksiya', descr: '', assignee: 4, createdBy: 1, deadline: Date.now() - H, status: 'open', note: '', doneAt: 0 },
  { id: 3, projectId: null, title: 'Dekabr kontent rejasi', descr: '', assignee: 3, createdBy: 1, deadline: Date.now() + D, status: 'done', note: 'Tayyor, Notion’da', doneAt: Date.now() - 2 * H },
  { id: 4, projectId: null, title: 'Mijoz bilan uchrashuv hisoboti', descr: '', assignee: 3, createdBy: 1, deadline: Date.now() - 2 * D, status: 'approved', note: '', doneAt: Date.now() - 3 * D, approvedAt: Date.now() - 2 * D },
];
const payments = [
  { id: 41, uid: 5, name: 'Dilnoza Rashidova', username: 'dilnoza_smm', kind: 'plan', planId: 'pro_ai', planName: 'Pro + AI', period: 'month', seats: 0, amount: 26000, status: 'pending', method: 'card', at: Date.now() - 20 * 6e4, receipt: true },
  { id: 42, uid: 6, name: 'Bobur Agency', username: null, kind: 'team', planId: null, planName: null, period: 'year', seats: 12, teamName: 'Bobur Agency', amount: 1200000, status: 'pending', method: 'card', at: Date.now() - 2 * H, receipt: true },
];

// ---------------------------------------------------------------- builders
const projectSummary = (p) => {
  const list = posts.filter((x) => x.projectId === p.id);
  const next = list.filter((x) => x.date >= day(0) && x.status !== 'published').map((x) => x.date).sort()[0] || null;
  return { id: p.id, name: p.name, icon: p.icon, color: p.color, role: p.role, team: p.team, archived: p.archived, rev: 1, posts: list.length, ready: list.filter((x) => ['ready', 'published'].includes(x.status)).length, next };
};
const boot = () => ({
  me: { id: ME, name: people[ME], username: 'aziza', admin: true, prefs: {} },
  ent, plans: plans.filter((p) => p.active), team: teamPricing, pay: 'card', ai: true, bot: 'tartib_bot',
  projects: projects.map(projectSummary),
});
const project = (p) => ({
  id: p.id, rev: Date.now(), name: p.name, icon: p.icon, color: p.color, archived: p.archived, team: p.team ? 1 : null,
  owner: { id: ME, name: people[ME] }, members: p.members, people, shared: true,
  posts: posts.filter((x) => x.projectId === p.id).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).map((x) => ({ ...x, comments: (comments[x.id] || []).length })),
});
const team = () => ({
  team: { id: 1, name: ent.team.name, seats: 8, until: ent.team.until, active: true, role: 'owner', owner: ME, invite: 'https://t.me/tartib_bot?startapp=t_demo' },
  days: Array.from({ length: 14 }, (_, i) => day(i - 13)),
  members: members.map((m) => {
    const mine = tasks.filter((t) => t.assignee === m.id);
    const fin = mine.filter((t) => t.status !== 'open');
    return { ...m, tasks: { open: mine.filter((t) => t.status === 'open').length, done: mine.filter((t) => t.status === 'done').length, approved: mine.filter((t) => t.status === 'approved').length, overdue: mine.filter((t) => t.status === 'open' && t.deadline < Date.now()).length, ontime: fin.filter((t) => t.doneAt <= t.deadline).length, finished: fin.length } };
  }),
  tasks, projects: projects.filter((p) => p.team).map((p) => ({ id: p.id, name: p.name })),
});
function stats() {
  const series = Array.from({ length: 14 }, (_, i) => ({ day: day(i - 13), dau: 180 + Math.round(Math.sin(i) * 60 + i * 8), actions: 900 + i * 40, ai: 150 + Math.round(Math.cos(i) * 80 + i * 10), joined: 8 + (i * 7) % 20 }));
  return {
    at: Date.now(),
    users: { total: 1240, blocked: 12, newToday: 18, new7: 140, new30: 610, dau: 312, wau: 702, mau: 980, dauPct: 25.2, wauPct: 56.6, mauPct: 79, stickiness: 31.8 },
    subs: { paid: 186, paidPct: 15, free: 1054, freePct: 85, plans: [{ id: 'free', name: 'Bepul', n: 1054, pct: 85 }, { id: 'pro', name: 'Pro', n: 121, pct: 9.8 }, { id: 'pro_ai', name: 'Pro + AI', n: 65, pct: 5.2 }], teams: 7, seats: 96, teamMembers: 81, seatFill: 84.4 },
    revenue: { total: 18420000, count: 512, month: 3120000, monthCount: 96, avg: 35977, pending: payments.filter((p) => p.status === 'pending').length, conversion: 18.3, byKind: [{ kind: 'team', plan: 'Jamoa', period: 'month', n: 5, sum: 1170000 }, { kind: 'plan', plan: 'Pro + AI', period: 'month', n: 40, sum: 1040000 }, { kind: 'plan', plan: 'Pro', period: 'year', n: 9, sum: 900000 }] },
    ai: { enabled: true, model: 'gemini-2.5-flash', requests: 4210, success: 98.6, cachedPct: 11.2, tokensIn: 1820000, tokensOut: 3410000, allTimeRequests: 22100, allTimeTokens: 30100000, users: 121, eligible: 146, adoption: 82.9, usersPct: 9.8, used: 5120, quota: 35400, quotaUsed: 14.5, byKind: [{ kind: 'caption', req: 2400, pct: 57 }, { kind: 'plan', req: 900, pct: 21.4 }, { kind: 'improve', req: 610, pct: 14.5 }, { kind: 'hashtags', req: 300, pct: 7.1 }] },
    content: { projects: 2100, activeProjects: 1830, sharedProjects: 640, posts: 48200, posts7: 3100, perUser: 38.9, byStatus: [{ status: 'published', n: 21000, pct: 43.6 }, { status: 'draft', n: 10200, pct: 21.2 }, { status: 'ready', n: 9000, pct: 18.7 }, { status: 'idea', n: 8000, pct: 16.6 }], byPlatform: [{ platform: 'instagram', n: 30100, pct: 62.4 }, { platform: 'telegram', n: 12000, pct: 24.9 }, { platform: 'tiktok', n: 6100, pct: 12.7 }], up: 5400, down: 610, approval: 89.9, comments: 7200, tasks: 930, tasksByStatus: [{ status: 'approved', n: 700, pct: 75.3 }, { status: 'open', n: 180, pct: 19.4 }, { status: 'done', n: 50, pct: 5.4 }], overdue: 22, onTime: 86.2 },
    series,
    system: { rssMb: 118, heapMb: 42, dbMb: 64.2, cache: { entries: 210, mb: 12.4, maxMb: 64, hitRate: 0.93 }, uptimeH: 71.2, node: process.version },
  };
}
const aiText = {
  caption: 'Kuz keldi — issiq ichimliklar vaqti ☕️\n\nYangi menyuda 3 ta ta’m: tarvuzli latte, olcha-kakao va zanjabil choy. Har biri — mahalliy mevalardan.\n\nBugun 14:00 gacha ikkinchi ichimlik 50% arzon. Do‘stingizni belgilang 👇',
  improve: 'Kuz o‘z ta’mini olib keldi 🍂 Yangi menyumizni birinchi bo‘lib tatib ko‘ring — bugun ikkinchi ichimlik yarim narxda!',
  hashtags: '#tashkent #coffee #qahva #latte #kofe #toshkent #uzbekistan #coffeetime #kuz #autumn #menu #barista',
};

// ---------------------------------------------------------------- server
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const read = (req) => new Promise((r) => { let s = ''; req.on('data', (c) => (s += c)); req.on('end', () => { try { r(JSON.parse(s || '{}')); } catch { r({}); } }); });

createServer(async (req, res) => {
  const [path, qs] = req.url.split('?');
  const json = (o, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (!path.startsWith('/api/')) {
    const f = join(PUB, path === '/' ? 'index.html' : path);
    if (!f.startsWith(PUB) || !existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'text/plain', 'cache-control': 'no-store' });
    return res.end(readFileSync(f));
  }
  const b = req.method === 'GET' ? {} : await read(req);
  const m = (re) => path.match(re);
  let k;
  await new Promise((r) => setTimeout(r, 120)); // a little network delay, as in real life

  if (path === '/api/boot') return json(boot());
  if (path === '/api/me') return json({ ok: true });
  if (path === '/api/projects' && req.method === 'POST') {
    const p = { id: ++seq, name: b.name, icon: b.icon || 'spark', color: b.color || null, role: 'owner', team: !!b.team, archived: false, members: [] };
    projects.unshift(p);
    return json({ id: p.id });
  }
  if ((k = m(/^\/api\/projects\/(\d+)$/))) {
    const p = projects.find((x) => x.id === +k[1]);
    if (!p) return json({ error: 'Loyiha topilmadi' }, 404);
    if (req.method === 'GET') return json(project(p));
    if (req.method === 'PATCH') { Object.assign(p, b); return json({ ok: true }); }
    if (req.method === 'DELETE') { projects.splice(projects.indexOf(p), 1); return json({ ok: true }); }
  }
  if ((k = m(/^\/api\/projects\/(\d+)\/share$/))) return json({ code: 'j_demo', link: 'https://t.me/tartib_bot?startapp=j_demo' });
  if ((k = m(/^\/api\/projects\/(\d+)\/members\/(\d+)$/))) {
    const p = projects.find((x) => x.id === +k[1]);
    if (req.method === 'PATCH') p.members.find((x) => x.id === +k[2]).role = b.role;
    else p.members = p.members.filter((x) => x.id !== +k[2]);
    return json({ ok: true });
  }
  if ((k = m(/^\/api\/projects\/(\d+)\/posts$/))) { posts.push({ ...P(+k[1], 0, '', '', '', '', ''), ...b }); return json({ id: seq }); }
  if ((k = m(/^\/api\/projects\/(\d+)\/posts\/bulk$/))) { for (const x of b.posts || []) posts.push({ ...P(+k[1], 0, '', '', '', '', ''), ...x }); return json({ added: (b.posts || []).length }); }
  if ((k = m(/^\/api\/posts\/(\d+)$/))) {
    const i = posts.findIndex((x) => x.id === +k[1]);
    if (req.method === 'PATCH') Object.assign(posts[i], b);
    else posts.splice(i, 1);
    return json({ ok: true });
  }
  if ((k = m(/^\/api\/posts\/(\d+)\/vote$/))) {
    const x = posts.find((p) => p.id === +k[1]);
    x.up = x.up.filter((u) => u !== ME);
    x.down = x.down.filter((u) => u !== ME);
    if (b.v > 0) x.up.push(ME);
    if (b.v < 0) x.down.push(ME);
    return json({ ok: true });
  }
  if ((k = m(/^\/api\/posts\/(\d+)\/comments$/))) {
    const list = (comments[k[1]] ||= []);
    if (req.method === 'POST') list.push({ id: ++seq, uid: ME, name: people[ME], text: b.text, at: Date.now() });
    return json({ comments: list });
  }
  if ((k = m(/^\/api\/comments\/(\d+)$/))) { for (const l of Object.values(comments)) { const i = l.findIndex((c) => c.id === +k[1]); if (i >= 0) l.splice(i, 1); } return json({ ok: true }); }
  if (path === '/api/ai') {
    await new Promise((r) => setTimeout(r, 1200));
    ent.aiUsed += b.kind === 'plan' ? 3 : 1;
    if (b.kind === 'plan') {
      const ideas = ['Mijoz hikoyasi', 'Sahna ortidan', '3 ta foydali maslahat', 'Mahsulot yaqindan', 'So‘rovnoma', 'Jamoa bilan tanishuv', 'Haftalik aksiya', 'Ko‘p beriladigan savollar'];
      const n = Math.round(((b.perWeek || 5) * (b.days || 7)) / 7);
      const kinds = ['reels', 'carousel', 'story', 'post'];
      const start = new Date(`${b.start || day(0)}T00:00:00`);
      return json({ used: ent.aiUsed, quota: 300, posts: Array.from({ length: n }, (_, i) => {
        const d = new Date(start.getTime() + Math.floor((i * (b.days || 7)) / n) * D);
        return { date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, time: ['10:00', '13:00', '19:30'][i % 3], platform: (b.platforms || ['instagram'])[i % (b.platforms?.length || 1)], kind: kinds[i % 4], status: 'idea', title: ideas[i % ideas.length], body: 'Kuchli birinchi qator. Asosiy fikr 2–3 gapda. Oxirida chaqiriq: izohda yozing yoki do‘stingizni belgilang.' };
      }) });
    }
    return json({ text: aiText[b.kind] || '', used: ent.aiUsed, quota: 300 });
  }
  if (path === '/api/pay') return json({ id: 77, method: 'card', amount: 26000, card, bot: 'tartib_bot' });
  if (path === '/api/payments') return json({ payments: [] });
  if (path === '/api/team') return json(team());
  if (path === '/api/team/invite') return json({ link: 'https://t.me/tartib_bot?startapp=t_demo', code: 't_demo' });
  if (path === '/api/team/tasks') { tasks.unshift({ id: ++seq, status: 'open', note: '', doneAt: 0, createdBy: ME, ...b }); return json({ id: seq }); }
  if ((k = m(/^\/api\/tasks\/(\d+)$/))) {
    const t = tasks.find((x) => x.id === +k[1]);
    if (req.method === 'DELETE') tasks.splice(tasks.indexOf(t), 1);
    else if (b.action === 'done') Object.assign(t, { status: 'done', doneAt: Date.now(), note: b.note || '' });
    else if (b.action === 'approve') Object.assign(t, { status: 'approved', approvedAt: Date.now() });
    else if (b.action === 'reject' || b.action === 'reopen') Object.assign(t, { status: 'open', doneAt: 0, note: b.note || '' });
    return json({ ok: true });
  }
  if (path.startsWith('/api/team')) return json({ ok: true });
  if (path === '/api/admin/stats') return json(stats());
  if (path === '/api/admin/plans') return json({ plans, team: teamPricing, card, payment: 'card' });
  if ((k = m(/^\/api\/admin\/plans\/([\w-]+)$/))) {
    const i = plans.findIndex((p) => p.id === k[1]);
    if (req.method === 'DELETE') plans.splice(i, 1);
    else {
      const v = { id: k[1], name: b.name, month: +b.month || 0, year: +b.year || 0, ai: !!b.ai, aiQuota: +b.aiQuota || 0, maxProjects: +b.maxProjects || 0, maxPosts: +b.maxPosts || 0, active: b.active !== false, sort: +b.sort || plans.length };
      i >= 0 ? (plans[i] = v) : plans.push(v);
    }
    return json({ plans });
  }
  if (path === '/api/admin/settings') { if (b.team) Object.assign(teamPricing, b.team); if (b.card) card = { ...card, ...b.card }; return json({ team: teamPricing, card }); }
  if (path === '/api/admin/payments') { const s = new URLSearchParams(qs).get('status') || 'pending'; return json({ payments: payments.filter((p) => s === 'all' || p.status === s) }); }
  if ((k = m(/^\/api\/admin\/payments\/(\d+)$/))) { payments.find((p) => p.id === +k[1]).status = b.action === 'approve' ? 'paid' : 'rejected'; return json({ ok: true }); }
  if (path === '/api/admin/users') return json({ next: null, users: Object.entries(people).map(([id, name], i) => ({ id: +id, name, username: null, joinedAt: Date.now() - i * 9 * D, lastSeen: Date.now() - i * 3 * H, blocked: false, plan: i ? 'free' : 'pro_ai', until: i ? 0 : ent.plan.until, aiUsed: i ? 0 : 47, projects: 4 - i })) });
  if (path.startsWith('/api/admin/')) return json({ ok: true, queued: 1240, plan: b.planId, until: Date.now() + 30 * D });
  json({ error: 'not found' }, 404);
}).listen(PORT, () => console.log(`Tartib UI preview: http://localhost:${PORT}/?dev=1   (sample data, nothing is saved)`));
