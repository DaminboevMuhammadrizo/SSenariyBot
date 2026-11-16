// The Mini App's static files (built by tools/build.mjs into public/): read once at start,
// compressed once (brotli q11 + gzip), served from RAM — a request is a Map lookup and a socket write.
//   /                 app shell (skeleton + inlined CSS/JS)   no-cache + ETag → 304
//   /sw.js            service worker                           no-cache
//   /c/*.js           hashed lazy chunks                       1 year, immutable
//   /favicon.svg ...  icons                                    1 week
import { Injectable, Logger, NestMiddleware, OnModuleInit } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { extname, join } from 'path';
import { Pack, pack, sendPack } from '../common/http';

const PUB = join(process.cwd(), 'public');
const YEAR = 'public, max-age=31536000, immutable';
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

@Injectable()
export class WebService implements OnModuleInit {
  private readonly logger = new Logger('Web');
  readonly files = new Map<string, Pack>();

  onModuleInit() {
    if (!existsSync(join(PUB, 'index.html'))) return this.logger.warn('public/ bo‘sh: `npm run build:web` ni ishga tushiring');
    const add = (url: string, file: string, cache: string) => this.files.set(url, pack(readFileSync(file), TYPES[extname(file)] || 'application/octet-stream', cache));
    add('/', join(PUB, 'index.html'), 'no-cache');
    add('/sw.js', join(PUB, 'sw.js'), 'no-cache');
    for (const f of ['favicon.svg', 'logo.svg', 'manifest.webmanifest']) if (existsSync(join(PUB, f))) add(`/${f}`, join(PUB, f), 'public, max-age=604800');
    for (const dir of ['c', 'icons'])
      if (existsSync(join(PUB, dir))) for (const n of readdirSync(join(PUB, dir))) add(`/${dir}/${n}`, join(PUB, dir, n), dir === 'c' ? YEAR : 'public, max-age=604800');
    this.logger.log(`${this.files.size} files in RAM`);
  }
}

@Injectable()
export class WebMiddleware implements NestMiddleware {
  constructor(private web: WebService) {}

  use(req: Request, res: Response, next: NextFunction) {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || req.path.startsWith('/api/') || req.path === '/webhook') return next();
    const hit = this.web.files.get(req.path === '/index.html' ? '/' : req.path);
    if (hit) return sendPack(req, res, hit);
    // any other in-app path (a reload on a sub-path) gets the shell
    if (String(req.headers.accept || '').includes('text/html') && this.web.files.has('/')) return sendPack(req, res, this.web.files.get('/')!);
    next();
  }
}
