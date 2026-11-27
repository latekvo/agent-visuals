// Mermaid source to an SVG resvg can draw. beautiful-mermaid colors everything
// through CSS variables and color-mix(), which resvg paints black, so both are
// evaluated here into plain colors.
import { renderMermaidSVG } from 'beautiful-mermaid';

function parseColor(s) {
  s = s.trim().toLowerCase();
  if (s === 'transparent') return [0, 0, 0, 0];
  let m = s.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length <= 4) h = [...h].map((c) => c + c).join('');
    const n = (i) => parseInt(h.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
  }
  m = s.match(/^rgba?\(([^)]*)\)$/);
  if (m) {
    const [r, g, b, a = 1] = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return [r, g, b, a];
  }
  throw new Error(`unsupported color: ${s}`);
}

function formatColor([r, g, b, a]) {
  const c = [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))));
  if (a >= 1) return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
  return `rgba(${c.join(',')},${+a.toFixed(3)})`;
}

// CSS Color 5 color-mix() in srgb: premultiplied-alpha interpolation.
function colorMix(args) {
  const stops = args.slice(1).map((a) => {
    const m = a.trim().match(/^(.*?)(?:\s+([\d.]+)%)?$/s);
    return { c: parseColor(m[1]), p: m[2] === undefined ? undefined : +m[2] };
  });
  let [p1, p2] = [stops[0].p, stops[1].p];
  if (p1 === undefined && p2 === undefined) p1 = p2 = 50;
  else if (p1 === undefined) p1 = 100 - p2;
  else if (p2 === undefined) p2 = 100 - p1;
  const sum = p1 + p2, alphaMult = Math.min(sum, 100) / 100;
  const [w1, w2] = [p1 / sum, p2 / sum], [c1, c2] = [stops[0].c, stops[1].c];
  const a = c1[3] * w1 + c2[3] * w2;
  if (a === 0) return [0, 0, 0, 0];
  const ch = (i) => (c1[i] * c1[3] * w1 + c2[i] * c2[3] * w2) / a;
  return [ch(0), ch(1), ch(2), a * alphaMult];
}

function closeParen(s, open) {
  for (let i = open, d = 0; i < s.length; i++) {
    if (s[i] === '(') d++;
    else if (s[i] === ')' && --d === 0) return i;
  }
  throw new Error(`unbalanced parens: ${s}`);
}

function splitTopLevel(s) {
  const out = [];
  let d = 0, start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') d++;
    else if (s[i] === ')') d--;
    else if (s[i] === ',' && d === 0) { out.push(s.slice(start, i)); start = i + 1; }
  }
  return [...out, s.slice(start)];
}

function resolveCss(s, vars, depth = 0) {
  if (depth > 32) throw new Error('CSS variable cycle');
  let out = '', i = 0, m;
  const re = /(var|color-mix)\(/g;
  while ((m = re.exec(s))) {
    const open = m.index + m[1].length, close = closeParen(s, open);
    const args = splitTopLevel(s.slice(open + 1, close));
    let val;
    if (m[1] === 'var') {
      const name = args[0].trim();
      if (vars.has(name)) val = resolveCss(vars.get(name), vars, depth + 1);
      else if (args.length > 1) val = resolveCss(args.slice(1).join(',').trim(), vars, depth + 1);
      else throw new Error(`unresolved CSS variable ${name}`);
    } else {
      val = formatColor(colorMix(args.map((a) => resolveCss(a, vars, depth + 1))));
    }
    out += s.slice(i, m.index) + val;
    i = re.lastIndex = close + 1;
  }
  return out + s.slice(i);
}

// resvg draws orient="auto-start-reverse" unrotated. On a marker-end it means auto; on a
// marker-start, auto on a copy turned 180° about its center.
function orientMarkers(svg) {
  const reversed = new Set();
  return svg
    // beautiful-mermaid 1.1.3 reverses its start arrowhead twice and anchors its diamonds by the
    // wrong tip, hiding both inside the node.
    .replace(/(<marker id="arrowhead-start[^"]*"[^>]*orient=")auto-start-reverse"/g, '$1auto"')
    .replace(/(<marker id="cls-(?:composition|aggregation)"[^>]*refX=")0"/g, '$112"')
    .replace(/<marker\b([^>]*)\sorient="auto-start-reverse"([^>]*)>([\s\S]*?)<\/marker>/g, (_, pre, post, body) => {
      const attrs = pre + post;
      const [id, w, h, x, y] = ['id', 'markerWidth', 'markerHeight', 'refX', 'refY']
        .map((n) => attrs.match(new RegExp(`\\s${n}="([^"]*)"`))[1]);
      reversed.add(id);
      const rest = attrs.replace(/\s(?:id|refX|refY)="[^"]*"/g, '');
      return `<marker${attrs} orient="auto">${body}</marker>`
        + `<marker id="${id}-reversed"${rest} refX="${w - x}" refY="${h - y}" orient="auto">`
        + `<g transform="rotate(180 ${w / 2} ${h / 2})">${body}</g></marker>`;
    })
    .replace(/(\smarker-start="url\(#)([^)]+)\)"/g, (m, a, id) => (reversed.has(id) ? `${a}${id}-reversed)"` : m));
}

const DECL = /(--[\w-]+)\s*:\s*([^;"}]+?)\s*(?=;|"|}|$)/g;

export function mermaidSvg(code, { fg, bg }) {
  const svg = orientMarkers(renderMermaidSVG(code, { fg, bg, transparent: true }));
  const vars = new Map();
  const rootStyle = svg.match(/^<svg\b[^>]*?\sstyle="([^"]*)"/)?.[1] ?? '';
  const styles = [...svg.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
  for (const s of [rootStyle, ...styles]) for (const [, k, v] of s.matchAll(DECL)) vars.set(k, v);
  return svg
    // The root style holds only custom properties, which resvg doesn't paint.
    .replace(/^(<svg\b[^>]*?)\sstyle="[^"]*"/, '$1')
    // The @import's URL holds a `;`, so it goes before the declarations.
    .replace(/<style>([\s\S]*?)<\/style>/g, (_, css) => `<style>${resolveCss(
      css.replace(/@import\s+url\([^)]*\)\s*;?/g, '').replace(/--[\w-]+\s*:[^;}]*;?/g, ''), vars)}</style>`)
    // Presentation attributes only: label text may itself contain "var(".
    .replace(/(\s(?:fill|stroke|style|stop-color|color)=")([^"]*\b(?:var|color-mix)\([^"]*)"/g,
      (_, a, v) => `${a}${resolveCss(v, vars)}"`);
}
