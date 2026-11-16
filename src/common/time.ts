import { conf } from './config';

export const DAY = 86_400_000;

/** Day key (YYYY-MM-DD) in the business time zone (Tashkent by default). */
export const dayKey = (t: number = Date.now()) => new Date(t + conf().tzOffsetMin * 60_000).toISOString().slice(0, 10);
export const monthKey = (t: number = Date.now()) => dayKey(t).slice(0, 7);
/** Start of a business-time day as a Date. */
export const dayStart = (key: string) => new Date(Date.parse(`${key}T00:00:00Z`) - conf().tzOffsetMin * 60_000);
export const fmtDate = (t: number | Date) => dayKey(+t).split('-').reverse().join('.');
export const fmtTime = (t: number | Date) => new Date(+t + conf().tzOffsetMin * 60_000).toISOString().slice(11, 16);
export const money = (n: number) => `${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} so‘m`;
export const ms = (d: Date | null | undefined) => (d ? d.getTime() : 0);
