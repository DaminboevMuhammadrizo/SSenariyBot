// Responses prepared once, kept compressed (brotli + gzip), sent with an ETag.
// A client that already has the same version gets 304 with an empty body.
import { createHash } from 'crypto';
import { brotliCompressSync, gzipSync, brotliDecompressSync, constants as Z } from 'zlib';
import type { Request, Response } from 'express';

export type Pack = { type: string; cache: string; etag: string | null; raw: Buffer | null; br: Buffer | null; gz: Buffer | null };

export const JSON_TYPE = 'application/json; charset=utf-8';
export const etagOf = (buf: string | Buffer) => `"${createHash('sha1').update(buf).digest('base64url').slice(0, 16)}"`;

/** quality 11 for static files (compressed once at start), lower for live data. */
export function pack(raw: Buffer, type = JSON_TYPE, cache = 'no-cache', etag: string | null = etagOf(raw), quality = 11): Pack {
  const text = /^(text|application\/(json|manifest)|image\/svg)/.test(type);
  const small = raw.length < 1024;
  return {
    type,
    cache,
    etag,
    raw: !text || small ? raw : null,
    br: text && !small ? brotliCompressSync(raw, { params: { [Z.BROTLI_PARAM_QUALITY]: quality, [Z.BROTLI_PARAM_SIZE_HINT]: raw.length } }) : null,
    gz: text && !small ? gzipSync(raw, { level: quality >= 11 ? 9 : 5 }) : null,
  };
}
export const packJson = (obj: unknown, etag?: string, quality = 5) => {
  const raw = Buffer.from(JSON.stringify(obj));
  return pack(raw, JSON_TYPE, 'no-cache', etag ?? etagOf(raw), quality);
};
export const packSize = (p: Pack) => (p.raw?.length || 0) + (p.br?.length || 0) + (p.gz?.length || 0) + 200;

export function sendPack(req: Request, res: Response, p: Pack) {
  res.setHeader('content-type', p.type);
  res.setHeader('cache-control', p.cache);
  res.setHeader('vary', 'accept-encoding');
  res.setHeader('x-content-type-options', 'nosniff');
  if (p.etag) {
    res.setHeader('etag', p.etag);
    if (req.headers['if-none-match'] === p.etag) return void res.status(304).end();
  }
  let body = p.raw;
  if (!body) {
    const ae = String(req.headers['accept-encoding'] || '');
    if (/\bbr\b/.test(ae)) (body = p.br), res.setHeader('content-encoding', 'br');
    else if (/\bgzip\b/.test(ae)) (body = p.gz), res.setHeader('content-encoding', 'gzip');
    else body = brotliDecompressSync(p.br!);
  }
  res.setHeader('content-length', body!.length);
  res.status(200).end(req.method === 'HEAD' ? undefined : body);
}

/** 304 when the client already holds this exact version (before any work is done). */
export const fresh = (req: Request, etag: string) => req.headers['if-none-match'] === etag;
