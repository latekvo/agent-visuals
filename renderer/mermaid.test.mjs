import assert from 'node:assert/strict';
import fs from 'node:fs';
import { before, test } from 'node:test';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import { mermaidSvg } from './mermaid.mjs';

const ZOOM = 4;
const colors = { fg: '#ffffff', bg: '#282c34' };

before(() => initWasm(fs.readFileSync(new URL('./node_modules/@resvg/resvg-wasm/index_bg.wasm', import.meta.url))));

function pixels(svg) {
  const img = new Resvg(svg, { fitTo: { mode: 'zoom', value: ZOOM }, background: colors.bg }).render();
  return { w: img.width, data: img.pixels };
}

// Each marked end of a line or polyline: its point and the unit vector pointing out of the line.
function markedEnds(svg) {
  const ends = [];
  for (const [el] of svg.matchAll(/<(?:line|polyline)\b[^>]*\smarker-(?:start|end)="[^>]*>/g)) {
    const a = (n) => el.match(new RegExp(`\\s${n}="([^"]*)"`))?.[1];
    const pts = a('points')
      ? a('points').trim().split(/\s+/).map((p) => p.split(',').map(Number))
      : [[+a('x1'), +a('y1')], [+a('x2'), +a('y2')]];
    for (const [end, [p, q]] of [['start', [pts[0], pts[1]]], ['end', [pts.at(-1), pts.at(-2)]]]) {
      if (!a(`marker-${end}`)) continue;
      const len = Math.hypot(p[0] - q[0], p[1] - q[1]);
      ends.push({ end, el, p, u: [(p[0] - q[0]) / len, (p[1] - q[1]) / len] });
    }
  }
  return ends;
}

// A marker turned the wrong way lies past its line's end, often under a node, or points back along
// the line, so each must be visible, centered on the line short of its end, and narrowest at the end.
function assertMarkersOnTheirLines(code) {
  const svg = mermaidSvg(code, colors);
  const withMarkers = pixels(svg);
  const without = pixels(svg.replace(/\smarker-(?:start|end)="[^"]*"/g, ''));
  const ends = markedEnds(svg);
  assert.ok(ends.length > 0);
  for (const { end, el, p, u } of ends) {
    // Marker pixels as SVG units along the line past its end, and across it.
    const px = [];
    const R = 14 * ZOOM;
    for (let y = Math.floor(p[1] * ZOOM - R); y <= p[1] * ZOOM + R; y++) {
      for (let x = Math.floor(p[0] * ZOOM - R); x <= p[0] * ZOOM + R; x++) {
        if (x < 0 || y < 0 || x >= withMarkers.w || (x - p[0] * ZOOM) ** 2 + (y - p[1] * ZOOM) ** 2 > R * R) continue;
        const i = (y * withMarkers.w + x) * 4;
        let d = 0;
        for (let c = 0; c < 3; c++) d += Math.abs(withMarkers.data[i + c] - without.data[i + c]);
        const [dx, dy] = [(x + 0.5) / ZOOM - p[0], (y + 0.5) / ZOOM - p[1]];
        if (d > 48) px.push({ along: dx * u[0] + dy * u[1], across: dy * u[0] - dx * u[1] });
      }
    }
    const where = `marker-${end} of ${el}`;
    assert.ok(px.length >= 8 * ZOOM * ZOOM, `${where}: ${px.length} marker pixels`);
    const mean = (k) => px.reduce((s, q) => s + q[k], 0) / px.length;
    assert.ok(mean('along') < -1, `${where}: centered ${mean('along').toFixed(2)} past the line's end`);
    assert.ok(Math.abs(mean('across')) < 1, `${where}: centered ${mean('across').toFixed(2)} off the line`);
    const spread = (qs) => Math.max(...qs.map((q) => Math.abs(q.across)));
    const tip = spread(px.filter((q) => q.along > -2.5)), widest = spread(px);
    assert.ok(tip < 0.7 * widest, `${where}: ${tip.toFixed(2)} wide at the end, ${widest.toFixed(2)} at most`);
  }
}

test('sequence arrowheads point along their messages, right to left and back to the sender too', () => {
  assertMarkersOnTheirLines('sequenceDiagram\n  Alice->>Bob: there\n  Bob-->>Alice: back\n  Bob-)Alice: async\n  Bob->>Bob: self');
});

test('flowchart arrowheads point at their nodes at both ends, in every direction and in linkStyle colors', () => {
  for (const dir of ['LR', 'RL', 'TD', 'BT']) {
    const graph = `flowchart ${dir}\n  A --> B\n  B <--> C\n  C <-.- D`;
    assertMarkersOnTheirLines(graph);
    assertMarkersOnTheirLines(`${graph}\n  linkStyle default stroke:#2563eb`);
  }
});

test('class relationship markers sit at whichever end the arrow names', () => {
  assertMarkersOnTheirLines([
    'classDiagram',
    '  Animal <|-- Duck',
    '  Duck --|> Bird',
    '  Fish *-- Fin',
    '  Gill --* Fish',
    '  Duck o-- Egg',
    '  Nest --o Duck',
    '  Duck --> Fish',
    '  Shape <|.. Circle',
  ].join('\n'));
});
