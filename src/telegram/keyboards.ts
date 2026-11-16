import { appButton } from '../tg/tg.service';

export const openAppKeyboard = (text = 'Tartibni ochish', query = '') => ({ reply_markup: { inline_keyboard: [[appButton(text, query)]] } });

export const paymentDecisionKeyboard = (id: number) => ({
  inline_keyboard: [
    [
      { text: '✅ Tasdiqlash', callback_data: `pay:ok:${id}` },
      { text: '❌ Rad etish', callback_data: `pay:no:${id}` },
    ],
  ],
});

export const USER_COMMANDS = [{ command: 'start', description: 'Tartibni ochish' }];
export const ADMIN_COMMANDS = [
  { command: 'start', description: 'Tartibni ochish' },
  { command: 'admin', description: 'Admin panel' },
  { command: 'stats', description: 'Qisqa statistika' },
  { command: 'backup', description: 'Bazadan nusxa' },
  { command: 'grant', description: 'Tarif berish: id tarif kun' },
];
