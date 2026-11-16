import { esc } from '../tg/tg.service';
import { money } from '../common/time';

export const MESSAGES = {
  welcome: (name: string) =>
    `<b>Ssenariychi</b> — SMM kontent rejasi Telegram ichida.\n\n` +
    `◻︎ Har bir loyiha uchun alohida kontent kalendar\n` +
    `◻︎ Post vaqtida eslatma\n` +
    `◻︎ Mijoz yoki jamoaga ko‘rsatish — 👍 / 👎 va izohlar\n` +
    `◻︎ AI yordamchi va jamoa uchun vazifalar\n\n` +
    `Salom, ${esc(name)}! Boshlash uchun pastdagi tugmani bosing.`,
  joinedTeam: '✅ Siz jamoaga qo‘shildingiz.',
  receiptAccepted: '🧾 Chek qabul qilindi. Admin tekshirgach obuna yoqiladi — odatda bir necha daqiqa.',
  supportSent: 'Xabaringiz yuborildi. Javob shu yerga keladi.',
  receiptToAdmin: (id: number, who: string, uid: number, what: string, period: string, amount: number) =>
    `🧾 <b>To‘lov #${id}</b>\n${who} · <code>${uid}</code>\n${what} · ${period === 'year' ? '1 yil' : '1 oy'}\n<b>${money(amount)}</b>`,
  supportHead: (who: string, uid: number) => `💬 ${who} · <code>${uid}</code>`,
  grantUsage: 'Format: /grant 123456789 pro_ai 30',
  stats: (s: any) =>
    `📊 <b>Statistika</b>\n\n` +
    `👥 Foydalanuvchilar: <b>${s.users.total}</b> (bugun +${s.users.newToday})\n` +
    `Faol: bugun ${s.users.dau} (${s.users.dauPct}%) · 7 kun ${s.users.wau} (${s.users.wauPct}%) · 30 kun ${s.users.mau} (${s.users.mauPct}%)\n\n` +
    `💳 Pullik: <b>${s.subs.paid}</b> (${s.subs.paidPct}%) · Jamoalar: ${s.subs.teams} (${s.subs.seats} o‘rin)\n` +
    `Daromad: bu oy <b>${money(s.revenue.month)}</b> · jami ${money(s.revenue.total)}\n` +
    `Kutilayotgan to‘lovlar: ${s.revenue.pending}\n\n` +
    `✦ AI: ${s.ai.requests} so‘rov · limitdan ${s.ai.quotaUsed}% ishlatildi · ${s.ai.users} kishi (${s.ai.adoption}%)\n` +
    `📝 Postlar: ${s.content.posts} · loyihalar: ${s.content.projects}`,
};
