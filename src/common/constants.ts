export const PLATFORMS = ['instagram', 'telegram', 'tiktok', 'youtube', 'facebook', 'x', 'linkedin', 'other'];
export const KINDS = ['post', 'reels', 'story', 'carousel', 'video', 'shorts', 'article', 'live'];
export const STATUSES = ['idea', 'draft', 'review', 'ready', 'published'];
export const PLATFORM_NAME: Record<string, string> = {
  instagram: 'Instagram',
  telegram: 'Telegram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  facebook: 'Facebook',
  x: 'X',
  linkedin: 'LinkedIn',
  other: 'Boshqa',
};

/** Trimmed string of at most `max` characters ('' for anything that is not a string). */
export const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
export const int = (v: unknown, def = 0) => (Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : def);
