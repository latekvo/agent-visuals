import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import { escapeMarkdown, type FlowItem, type Piece, replaceInlineMath, splitBlocks, splitDisplay } from './parse'
import { texToUnicode } from './unicode'

type Rendered = { png: string; cols: number; rows: number } | { tooTall: true } | { error: string }
type Item = { tex: string; display: boolean } | { mermaid: string }

const PROMPT = [
  'This terminal draws LaTeX and Mermaid in your replies as images. Write a formula that stands alone as display math:',
  '`$$` on its own line, the LaTeX, then `$$` on its own line. Write math inside a sentence as `$...$`.',
  'Prefer LaTeX over ASCII or Unicode approximations of formulas, and keep math meant to render out of code spans.',
  'Where a diagram explains a flow, sequence, state machine or structure better than prose, write it as a',
  '```mermaid code block instead of ASCII art.',
].join(' ')

// Claude Code's own reply bullet and inline-code color.
const BULLET = '⏺'
const CODE_COLOR = '#afd7ff'

const cache = new Map<string, Rendered>()
// Renders in flight, which a draw awaits instead of starting its own.
const pending = new Map<string, Promise<void>>()
// The transcript's width at the last prompt: streaming renders are sized for it.
let promptColumns: number | undefined

const maxColsFor = (columns: number) => Math.min(255, Math.max(10, columns - 2) - 2)
const keyFor = (maxCols: number, f: Item) =>
  'mermaid' in f ? `G${maxCols}\0${f.mermaid}` : `${f.display ? 'D' : 'I'}${maxCols}\0${f.tex}`

function parse(text: string) {
  const segments = splitDisplay(text).map(s =>
    s.kind === 'md' ? { ...s, blocks: splitBlocks(s.text) } : s,
  )
  const items = segments.flatMap((s): Item[] =>
    s.kind === 'math'
      ? [{ tex: s.tex, display: true }]
      : s.kind === 'diagram'
        ? [{ mermaid: s.code }]
        : s.blocks.flatMap(b =>
          b.kind === 'flow'
            ? b.items.flatMap(it => it.pieces.flatMap(p => (p.kind === 'math' ? [{ tex: p.tex, display: false }] : [])))
            : [],
        ),
  )
  return { segments, items }
}

// Starts a render of each item neither cached nor in flight; resolves once every item is cached.
function ensure($: EngineInterface, maxCols: number, items: Item[]): Promise<unknown> | undefined {
  const key = (f: Item) => keyFor(maxCols, f)
  const missing = [
    ...new Map(items.filter(f => !cache.has(key(f)) && !pending.has(key(f))).map(f => [key(f), f])).values(),
  ]
  if (missing.length) {
    const done = (async () => {
      const run = await $.process
        .run(['node', `${$.plugin.root}/renderer/dist/render.mjs`], {
          stdin: JSON.stringify({ maxCols, items: missing }),
          timeoutMs: 10_000,
        })
        .catch((err: unknown) => String(err))
      let results: Rendered[] = []
      try {
        if (typeof run === 'string') throw new Error(run)
        if (run.exitCode !== 0) throw new Error(`exit ${run.exitCode}: ${run.stderr.slice(0, 500)}`)
        results = (JSON.parse(run.stdout) as { results: Rendered[] }).results
      } catch (err) {
        // Failures are cached too, so a broken renderer isn't rerun on every redraw.
        $.ui.log(`agent-visuals: renderer failed, showing source as text: ${String(err)}`)
      }
      missing.forEach((f, i) => cache.set(key(f), results[i] ?? { error: 'not rendered' }))
      // Oldest first: Map iterates in insertion order.
      for (const old of cache.keys()) {
        if (cache.size <= 200) break
        cache.delete(old)
      }
    })().finally(() => missing.forEach(f => pending.delete(key(f))))
    missing.forEach(f => pending.set(key(f), done))
  }
  const inFlight = new Set(items.flatMap(f => pending.get(key(f)) ?? []))
  return inFlight.size ? Promise.all(inFlight) : undefined
}

export const register: Register = on => {
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!e.surfaces.includes('terminal')) return composed
    return { sections: [...composed.sections, { id: 'agent-visuals', text: PROMPT, scope: 'session' }] }
  })

  on('ui.render', { component: 'UserMessage' }, ($, e, next) => {
    if (e.surface === 'terminal') promptColumns = e.viewport?.columns
    return next(e)
  })

  // Formulas and diagrams render as their blocks close in the streaming text,
  // so the finished reply draws without waiting on the renderer. One render at
  // a time, as its startup dominates: blocks closing meanwhile render after it.
  on('turn.step', async function* ($, e, next) {
    const texts: string[] = []
    let closed: Item[] = []
    let busy = false
    const renderClosed = (maxCols: number) => {
      const ready = busy ? undefined : ensure($, maxCols, closed)
      if (!ready) return
      busy = true
      void ready.finally(() => {
        busy = false
        renderClosed(maxCols)
      })
    }
    for await (const chunk of next(e)) {
      yield chunk
      if (chunk.kind !== 'text' || e.agentId !== undefined || promptColumns === undefined) continue
      texts[chunk.index] = (texts[chunk.index] ?? '') + chunk.text
      closed = parse(texts[chunk.index]!).items
      renderClosed(maxColsFor(promptColumns))
    }
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.isSummary) return next(e)
    const { segments, items } = parse(e.props.text)
    const hasRawMath = segments.some(
      s => s.kind === 'md' && s.blocks.some(b => b.kind === 'raw' && replaceInlineMath(b.text, () => '') !== b.text),
    )
    if (!items.length && !hasRawMath) return next(e)

    // Assistant text sits two columns in from the reply bullet.
    const width = Math.max(10, (e.viewport?.columns ?? 80) - 2)
    const maxCols = maxColsFor(e.viewport?.columns ?? 80)
    const ready = ensure($, maxCols, items)
    if (ready) {
      await ready
      if (next.signal.aborted) return next(e)
    }
    const image = (f: Item) => {
      const r = cache.get(keyFor(maxCols, f))
      return r && 'png' in r ? r : null
    }

    const { Box, Text, Image, Link, Markdown } = $.ui.resolve(e)
    let isFirst = e.props.isFirstOfReply
    let n = 0
    // Each block beside a two-column gutter, which holds the bullet opening a reply.
    const block = (drawn: RenderChildren) => {
      const bullet = isFirst
      isFirst = false
      return (
        <Box key={`k${n++}`} flexDirection="row" marginTop={1}>
          <Box width={2}>{bullet && <Text color="text">{BULLET}</Text>}</Box>
          {drawn}
        </Box>
      )
    }

    const word = (parts: Piece[], trailingSpace: boolean) => (
      <Box key={`w${n++}`} flexDirection="row">
        {parts.map(p => {
          if (p.kind === 'math') {
            const img = image({ tex: p.tex, display: false })
            return img ? (
              <Image key={`i${n++}`} source={{ png: img.png }} columns={img.cols} rows={1} alt={p.source} />
            ) : (
              <Text key={`t${n++}`}>{texToUnicode(p.tex)}</Text>
            )
          }
          const style = {
            ...(p.bold && { weight: 'bold' as const }),
            ...(p.italic && { italic: true }),
            ...(p.code && { color: CODE_COLOR }),
          }
          return p.href ? (
            <Link key={`l${n++}`} href={p.href} label={p.text} />
          ) : (
            <Text key={`t${n++}`} {...style}>
              {p.text}
            </Text>
          )
        })}
        {trailingSpace && <Text key={`s${n++}`}> </Text>}
      </Box>
    )

    // Words are flex children so wrapping keeps each formula whole and in line.
    const flowRow = (item: FlowItem, lead: string, cols: number) => {
      const words: RenderChildren[] = []
      let parts: Piece[] = []
      for (const p of item.pieces) {
        if (p.kind === 'math') {
          parts.push(p)
          continue
        }
        const chunks = p.text.split(/(\s+)/)
        chunks.forEach((chunk, i) => {
          if (i % 2 === 1) {
            if (parts.length) words.push(word(parts, true))
            parts = []
          } else if (chunk) parts.push({ ...p, text: chunk })
        })
      }
      if (parts.length) words.push(word(parts, false))
      return (
        <Box key={`r${n++}`} flexDirection="row">
          <Text>{lead}</Text>
          <Box flexDirection="row" flexWrap="wrap" width={cols - lead.length}>
            {words}
          </Box>
        </Box>
      )
    }

    const markdown = (text: string) => (
      <Box width={width}>
        <Markdown text={text} />
      </Box>
    )

    const parts: RenderChildren[] = []
    for (const s of segments) {
      if (s.kind !== 'md') {
        const img = image(s.kind === 'math' ? { tex: s.tex, display: true } : { mermaid: s.code })
        parts.push(
          block(
            img ? (
              <Image
                source={{ png: img.png }}
                columns={img.cols}
                rows={img.rows}
                alt={s.kind === 'math' ? s.tex : s.code}
              />
            ) : (
              markdown(s.source)
            ),
          ),
        )
        continue
      }
      for (const b of s.blocks) {
        if (b.kind === 'raw') {
          const text = replaceInlineMath(b.text, tex => escapeMarkdown(texToUnicode(tex)))
          if (text.trim()) parts.push(block(markdown(text)))
          continue
        }
        parts.push(block(<Box flexDirection="column">{b.items.map(item => flowRow(item, item.prefix, width))}</Box>))
      }
    }
    // Drawn whole here, without next(): a hook beneath expects a row once, not once per part.
    return <Box flexDirection="column">{parts}</Box>
  })
}
