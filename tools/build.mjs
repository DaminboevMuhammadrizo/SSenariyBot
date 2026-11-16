// Builds public/ (what the server sends) from web/src/:
//   public/index.html            first screen: skeleton + icon sprite + inlined minified CSS and core JS
//   public/c/<chunk>.<hash>.js   team and admin screens, loaded on demand
//   public/sw.js                 service worker with this build's version and file list
//   public/favicon.svg, logo.svg, manifest.webmanifest
// Usage: node tools/build.mjs   (npm run build:web)
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { brotliCompressSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(ROOT, 'web/src');
const OUT = resolve(ROOT, 'public');
const hash = (s, n = 10) => createHash('sha1').update(s).digest('hex').slice(0, n);

const esbuild = await import('esbuild').catch(() => {
  console.error('esbuild is missing: run `npm install`');
  process.exit(1);
});
const min = async (file, loader, format) =>
  (await esbuild.transform(readFileSync(resolve(SRC, file), 'utf8'), { loader, minify: true, target: 'es2020', format, legalComments: 'none' })).code;

mkdirSync(resolve(OUT, 'c'), { recursive: true });
// chunks of older builds stay a while: an app open during a deploy can still load the ones it knows
const keep = new Set();
const chunkFiles = {};
for (const name of ['team', 'admin']) {
  const code = await min(`${name}.js`, 'js', 'esm');
  chunkFiles[name] = `c/${name}.${hash(code, 8)}.js`;
  keep.add(chunkFiles[name].slice(2));
  writeFileSync(resolve(OUT, chunkFiles[name]), code);
}
const old = readdirSync(resolve(OUT, 'c')).filter((f) => !keep.has(f));
if (old.length > 8) for (const f of old.slice(0, old.length - 8)) rmSync(resolve(OUT, 'c', f));

const css = await min('style.css', 'css');
const core = (await min('core.js', 'js')).replace('__CHUNKS__', JSON.stringify(chunkFiles)).replace(/<\/(script)/gi, '<\\/$1');
if (core.includes('__CHUNKS__') || !core.includes(chunkFiles.team)) throw new Error('chunk map was not inlined');
const sprite = readFileSync(resolve(SRC, 'sprite.svg'), 'utf8').replace(/<!--.*?-->/gs, '').replace(/\n\s*/g, '');
const html = readFileSync(resolve(SRC, 'index.html'), 'utf8')
  .replace(/<!--(?!SPRITE)(?!\s*\/?\w).*?-->\n?/gs, '')
  .replace(/\n\s*/g, '')
  .replace('<!--SPRITE-->', () => sprite)
  .replace('/*CSS*/', () => css.trim())
  .replace('/*CORE*/', () => core.trim());
writeFileSync(resolve(OUT, 'index.html'), html);

for (const f of ['logo.svg', 'icon-192.png', 'manifest.webmanifest']) copyFileSync(resolve(SRC, f), resolve(OUT, f));
copyFileSync(resolve(SRC, 'logo.svg'), resolve(OUT, 'favicon.svg'));

const shell = ['./', 'favicon.svg', ...Object.values(chunkFiles)];
const version = hash(html + Object.values(chunkFiles).join());
const sw = (await esbuild.transform(readFileSync(resolve(SRC, 'sw.js'), 'utf8'), { minify: true, target: 'es2020' })).code
  .replace('__VERSION__', version)
  .replace('__SHELL__', JSON.stringify(shell));
writeFileSync(resolve(OUT, 'sw.js'), sw);

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const br = (s) => brotliCompressSync(Buffer.from(s)).length;
console.log(
  `built ${version}\n  index.html ${kb(html.length)} (brotli ${kb(br(html))})` +
    Object.entries(chunkFiles).map(([n, f]) => ` · ${n} ${kb(br(readFileSync(resolve(OUT, f))))}`).join(''),
);
