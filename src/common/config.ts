// .env values in one typed object. ConfigModule.forRoot() (app.module) loads .env into process.env
// before any provider is created, so reading process.env lazily here is safe.
const list = (v?: string) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);

let cached: ReturnType<typeof read> | null = null;
function read() {
  const e = process.env;
  const admins = list(e.ADMIN_TELEGRAM_ID || e.ADMIN_ID).map(Number).filter(Boolean);
  return {
    token: e.TELEGRAM_BOT_TOKEN || '',
    botUsername: (e.BOT_USERNAME || '').replace(/^@/, ''),
    webappUrl: (e.WEBAPP_URL || '').replace(/\/?$/, '/'),
    webhookDomain: (e.WEBHOOK_DOMAIN || '').replace(/\/$/, ''),
    webhookPath: e.WEBHOOK_PATH || '/webhook',
    webhookSecret: e.WEBHOOK_SECRET || '',
    admins,
    adminChat: Number(e.ADMIN_GROUP_ID || admins[0] || 0),
    storageChat: e.STORAGE_CHAT_ID || '', // daily pg_dump copy goes here (optional)
    paymentToken: e.PAYMENT_PROVIDER_TOKEN || '', // Click/Payme token from @BotFather; empty = card + receipt
    geminiKey: e.GEMINI_API_KEY || '',
    geminiModel: e.GEMINI_MODEL || 'gemini-2.5-flash',
    port: Number(e.PORT || 4002),
    cacheMb: Number(e.CACHE_MAX_MB || 64),
    rssSoftMb: Number(e.RSS_SOFT_MB || 350),
    tzOffsetMin: Number(e.TZ_OFFSET_MIN ?? 300), // Tashkent, UTC+5
    devAuth: e.DEV_AUTH === '1' && e.NODE_ENV !== 'production',
    databaseUrl: e.DATABASE_URL || '',
  };
}
export const conf = () => (cached ||= read());
export const isAdmin = (id: number | bigint) => conf().admins.includes(Number(id));
