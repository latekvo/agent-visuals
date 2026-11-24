export type Segment =
  | { kind: 'md'; text: string }
  | { kind: 'math'; tex: string; source: string }
  | { kind: 'diagram'; code: string; source: string }

export type Piece =
  | { kind: 'text'; text: string; bold?: true; italic?: true; code?: true; href?: string }
  | { kind: 'math'; tex: string; source: string }

// `prefix` is the item's list marker as written, with its indent ('' for a paragraph).
export type FlowItem = { prefix: string; pieces: Piece[] }

export type Block = { kind: 'raw'; text: string } | { kind: 'flow'; items: FlowItem[] }

const OPENERS = new Map([
  ['$$', '$$'],
  ['\\[', '\\]'],
])

const FENCE = /^\s*(```|~~~)/
const MERMAID = /^\s*(```|~~~)\s*mermaid\s*$/i
const LIST_ITEM = /^(\s*(?:[-*+]|\d+[.)]) +)(.*)$/
// Blocks whose markup the flow layout does not draw: headings, quotes, tables, html, rules.
const NOT_FLOW = /^\s*(#|>|\||<|(?:[-*_=] *){3,}$)/

// Splits markdown into text, display-math and closed ```mermaid blocks, leaving
// other fenced code alone. A math block is a whole line `$$...$$` / `\[...\]`,
// or a line holding only the opener followed by lines up to one ending in the closer.
export function splitDisplay(text: string): Segment[] {
  const out: Segment[] = []
  const md: string[] = []
  const flush = () => {
    if (md.length) out.push({ kind: 'md', text: md.join('\n') })
    md.length = 0
  }
  const lines = text.split('\n')
  let fence: string | null = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const fenceMark = line.match(FENCE)?.[1]
    if (fenceMark && (fence === null || fence === fenceMark)) {
      const end = fence === null && MERMAID.test(line) ? closingFence(lines, i, fenceMark) : -1
      const code = lines.slice(i + 1, end).join('\n')
      if (end > 0 && code.trim()) {
        flush()
        out.push({ kind: 'diagram', code, source: lines.slice(i, end + 1).join('\n') })
        i = end
        continue
      }
      fence = fence === null ? fenceMark : null
      md.push(line)
      continue
    }
    const trimmed = line.trim()
    const open = fence === null ? [...OPENERS.keys()].find(o => trimmed.startsWith(o)) : undefined
    if (!open) {
      md.push(line)
      continue
    }
    const close = OPENERS.get(open)!
    const isOneLine = trimmed.length > open.length + close.length && trimmed.endsWith(close)
    if (trimmed !== open && !isOneLine) {
      md.push(line)
      continue
    }
    let body = trimmed.slice(open.length)
    let end = i
    // TeX forbids a blank line inside display math, so an unclosed opener ends there.
    while (!body.trimEnd().endsWith(close) && end + 1 < lines.length && lines[end + 1]!.trim())
      body += '\n' + lines[++end]
    if (!body.trimEnd().endsWith(close)) {
      md.push(line)
      continue
    }
    const tex = body.trimEnd().slice(0, -close.length).trim()
    if (!tex) {
      md.push(line)
      continue
    }
    flush()
    out.push({ kind: 'math', tex, source: lines.slice(i, end + 1).join('\n') })
    i = end
  }
  flush()
  return out
}

function closingFence(lines: string[], open: number, mark: string): number {
  for (let j = open + 1; j < lines.length; j++) {
    const t = lines[j]!.trim()
    if (t.startsWith(mark) && [...t].every(c => c === mark[0])) return j
  }
  return -1
}

const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c)
const isWordChar = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c)

// Inline math at `i`: `\(...\)`, or `$...$` by Pandoc's rule (no space inside
// either `$`, no digit right after the closing one), so prices stay text. Math
// never spans a backtick, so a `$` in a later code span can't close it.
function mathAt(src: string, i: number): { tex: string; end: number } | null {
  if (src.startsWith('\\(', i)) {
    const close = src.indexOf('\\)', i + 2)
    const tex = close < 0 ? '' : src.slice(i + 2, close).trim()
    return tex ? { tex, end: close + 2 } : null
  }
  if (src[i] !== '$' || src[i + 1] === '$' || src[i - 1] === '$' || isSpace(src[i + 1])) return null
  let j = i + 1
  while ((j = src.indexOf('$', j + 1)) > 0 && src[j - 1] === '\\');
  if (j < 0 || isSpace(src[j - 1]) || src[j + 1] === '$' || /\d/.test(src[j + 1] ?? '')) return null
  if (src.slice(i, j).includes('`')) return null
  return { tex: src.slice(i + 1, j), end: j + 1 }
}

function codeAt(src: string, i: number): { text: string; end: number } | null {
  const run = src.slice(i).match(/^`+/)![0]
  const close = src.indexOf(run, i + run.length)
  if (close < 0) return null
  return { text: src.slice(i + run.length, close).replace(/^ (.*) $/, '$1'), end: close + run.length }
}

export function hasInlineMath(src: string): boolean {
  return parseInline(src).some(p => p.kind === 'math')
}

// Text substituted into markdown: `|` would split a table cell, the rest start markup.
export function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_|[\]]/g, '\\$&')
}

// Replaces inline math with `fn(tex)` line by line, leaving code as written.
export function replaceInlineMath(md: string, fn: (tex: string) => string): string {
  let fence: string | null = null
  return md
    .split('\n')
    .map(line => {
      const fenceMark = line.match(FENCE)?.[1]
      if (fence === null && fenceMark) fence = fenceMark
      else if (fence !== null && fenceMark === fence) fence = null
      else if (fence === null) return replaceInLine(line, fn)
      return line
    })
    .join('\n')
}

function replaceInLine(src: string, fn: (tex: string) => string): string {
  let out = ''
  for (let i = 0; i < src.length; ) {
    if (src[i] === '`') {
      const code = codeAt(src, i)
      const end = code ? code.end : i + src.slice(i).match(/^`+/)![0].length
      out += src.slice(i, end)
      i = end
      continue
    }
    const math = mathAt(src, i)
    if (math) {
      out += fn(math.tex)
      i = math.end
      continue
    }
    const step = src[i] === '\\' ? 2 : 1
    out += src.slice(i, i + step)
    i += step
  }
  return out
}

// Parses one paragraph or list item's text into styled runs and inline math.
export function parseInline(src: string): Piece[] {
  const out: Piece[] = []
  let buf = ''
  let bold = false
  let italic = false
  const flush = () => {
    if (buf) out.push({ kind: 'text', text: buf, ...(bold && { bold: true }), ...(italic && { italic: true }) })
    buf = ''
  }
  for (let i = 0; i < src.length; ) {
    const c = src[i]!
    const math = mathAt(src, i)
    if (math) {
      flush()
      out.push({ kind: 'math', tex: math.tex, source: src.slice(i, math.end) })
      i = math.end
      continue
    }
    if (c === '\\' && i + 1 < src.length && /[!-/:-@[-`{-~]/.test(src[i + 1]!)) {
      buf += src[i + 1]
      i += 2
      continue
    }
    if (c === '`') {
      const code = codeAt(src, i)
      if (code) {
        flush()
        out.push({ kind: 'text', text: code.text, code: true })
        i = code.end
        continue
      }
    }
    if (c === '[') {
      const link = src.slice(i).match(/^\[([^\]]+)\]\(([^)\s]+)\)/)
      if (link) {
        flush()
        out.push({ kind: 'text', text: link[1]!, href: link[2]! })
        i += link[0].length
        continue
      }
    }
    if ((c === '*' || c === '_') && src[i + 1] === c) {
      const intraword = c === '_' && isWordChar(src[i - 1]) && isWordChar(src[i + 2])
      if (!intraword && (bold ? !isSpace(src[i - 1]) : !isSpace(src[i + 2]))) {
        flush()
        bold = !bold
        i += 2
        continue
      }
    } else if (c === '*' || c === '_') {
      const intraword = c === '_' && isWordChar(src[i - 1]) && isWordChar(src[i + 1])
      if (!intraword && (italic ? !isSpace(src[i - 1]) : !isSpace(src[i + 1]))) {
        flush()
        italic = !italic
        i++
        continue
      }
    }
    buf += c
    i++
  }
  flush()
  return out
}

// Splits a markdown segment into blank-line separated blocks: paragraphs and
// lists holding inline math become flow blocks the plugin lays out itself;
// everything else stays raw for the engine, consecutive raw blocks joined.
export function splitBlocks(md: string): Block[] {
  const chunks: { lines: string[]; isFence: boolean }[] = []
  let current: string[] = []
  let fence: string | null = null
  let isFence = false
  const close = () => {
    if (current.length) chunks.push({ lines: current, isFence })
    current = []
    isFence = false
  }
  for (const line of md.split('\n')) {
    const fenceMark = line.match(FENCE)?.[1]
    if (fence === null && fenceMark) {
      close()
      fence = fenceMark
      isFence = true
    } else if (fence !== null && fenceMark === fence) {
      current.push(line)
      fence = null
      close()
      continue
    }
    if (fence === null && !line.trim()) {
      close()
      current.push(line)
      close()
      continue
    }
    current.push(line)
  }
  close()

  const out: Block[] = []
  const raw = (text: string) => {
    const last = out[out.length - 1]
    if (last?.kind === 'raw') last.text += '\n' + text
    else out.push({ kind: 'raw', text })
  }
  for (const { lines, isFence } of chunks) {
    const text = lines.join('\n')
    const isFlow =
      !isFence && lines.some(l => l.trim()) && !lines.some(l => NOT_FLOW.test(l)) && hasInlineMath(text)
    if (!isFlow) {
      raw(text)
      continue
    }
    const items: { prefix: string; text: string }[] = []
    for (const line of lines) {
      const item = line.match(LIST_ITEM)
      const last = items[items.length - 1]
      if (item) items.push({ prefix: item[1]!, text: item[2]! })
      else if (last) last.text += ' ' + line.trim()
      else items.push({ prefix: '', text: line.trim() })
    }
    out.push({ kind: 'flow', items: items.map(it => ({ prefix: it.prefix, pieces: parseInline(it.text) })) })
  }
  return out
}
