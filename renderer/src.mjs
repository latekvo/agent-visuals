// Bundled into dist/ by `npm run build`; the plugin runs dist/render.mjs.
// stdin: {"maxCols": n, "items": [{"tex": "...", "display": bool}, ...]}
// stdout: {"cell": {w, h, from}, "results": [{png, cols, rows} | {tooTall: true} | {error}]}
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mathjax } from 'mathjax-full/js/mathjax.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js';
import { initWasm, Resvg } from '@resvg/resvg-wasm';

const { maxCols, items } = JSON.parse(fs.readFileSync(0, 'utf8'));
const fg = process.env.AGENT_VISUALS_FG || '#ffffff';

// Cell size in pixels from the controlling terminal's TIOCGWINSZ.
function cellSize() {
  try {
    const out = execFileSync('python3', ['-c', `
import fcntl, termios, struct, os
fd = os.open('/dev/tty', os.O_RDONLY)
r, c, x, y = struct.unpack('HHHH', fcntl.ioctl(fd, termios.TIOCGWINSZ, b'\\0' * 8))
print(x // c if c and x else 0, y // r if r and y else 0)`], { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] });
    const [w, h] = out.trim().split(' ').map(Number);
    if (w > 0 && h > 0) return { w, h, from: 'tty' };
  } catch {}
  return { w: 16, h: 34, from: 'default' };
}

const cell = cellSize();
await initWasm(fs.readFileSync(new URL('./resvg.wasm', import.meta.url)));
const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const doc = mathjax.document('', {
  InputJax: new TeX({ packages: AllPackages, formatError: (_, err) => { throw err; } }),
  OutputJax: new SVG({ fontCache: 'local' }),
});

// Where a monospace font's baseline sits in its cell, from the top.
const BASELINE = 0.77;
// Inline math smaller than this fraction of its natural size is unreadable.
const MIN_INLINE_SCALE = 0.8;

function render({ tex, display }) {
  let svg = adaptor.innerHTML(doc.convert(tex, { display }));
  const ex = (name) => parseFloat(svg.match(new RegExp(`${name}="([\\d.]+)ex"`))[1]);
  const wEx = ex('width'), hEx = ex('height');
  const dEx = -parseFloat(svg.match(/vertical-align: ?(-?[\d.]+)ex/)?.[1] ?? '0');
  // Sized to match a monospace font's x-height, which runs large.
  let exPx = cell.h * (display ? 0.42 : 0.4);
  if (wEx * exPx > maxCols * cell.w) exPx = (maxCols * cell.w) / wEx;
  if (!display && hEx * exPx > cell.h) {
    const fit = cell.h / (hEx * exPx);
    if (fit < MIN_INLINE_SCALE) return { tooTall: true };
    exPx *= fit;
  }
  const w = wEx * exPx, h = hEx * exPx;
  const cols = Math.min(maxCols, Math.ceil(w / cell.w));
  const rows = display ? Math.min(255, Math.max(1, Math.ceil(h / cell.h))) : 1;
  const W = cols * cell.w, H = rows * cell.h;
  const y = display ? (H - h) / 2 : Math.min(H - h, Math.max(0, BASELINE * H - (h - dEx * exPx)));
  svg = svg
    .replace(/width="[\d.]+ex"/, `width="${w}" x="0"`)
    .replace(/height="[\d.]+ex"/, `height="${h}" y="${y}"`)
    .replaceAll('currentColor', fg);
  const outer = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}">${svg}</svg>`;
  return { png: Buffer.from(new Resvg(outer).render().asPng()).toString('base64'), cols, rows };
}

const results = items.map((item) => {
  try { return render(item); } catch (err) { return { error: String(err?.message ?? err) }; }
});
process.stdout.write(JSON.stringify({ cell, results }));
