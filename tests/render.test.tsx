import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { texToUnicode } from '../hooks/unicode'

const PLUGIN = 'agent-visuals'
// A 1x1 transparent PNG.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const TEXT = 'Roots of $ax^2$ here.\n\n$$\nx = 1\n$$\n\nDone.'

// `refuse` answers diagrams as beautiful-mermaid does a type it lacks.
function renderer(on: On, exitCode: number, refuse = false) {
  const calls: string[] = []
  on('process.run', (_, e) => {
    calls.push(e.init?.stdin ?? '')
    const { items } = JSON.parse(e.init?.stdin ?? '{}') as { items: { display?: boolean; mermaid?: string }[] }
    const results = items.map(it =>
      it.mermaid !== undefined && refuse ? { error: 'Invalid mermaid header' } : { png: PNG, cols: 3, rows: it.display === false ? 1 : 2 },
    )
    return {
      value: {
        exitCode,
        stdout: exitCode ? '' : JSON.stringify({ cell: { w: 16, h: 34 }, results }),
        stderr: exitCode ? 'boom' : '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })
  return calls
}

// A renderer whose first run waits for `release`.
function gatedRenderer(on: On) {
  let release!: () => void
  const gate = new Promise<void>(r => (release = r))
  const calls: string[] = []
  on('process.run', async (_, e) => {
    calls.push(e.init?.stdin ?? '')
    if (calls.length === 1) await gate
    const { items } = JSON.parse(e.init?.stdin ?? '{}') as { items: unknown[] }
    const results = items.map(() => ({ png: PNG, cols: 3, rows: 1 }))
    return {
      value: {
        exitCode: 0,
        stdout: JSON.stringify({ cell: { w: 16, h: 34 }, results }),
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })
  return { calls, release: () => release() }
}

// What reaches the hooks beneath this plugin's.
function engineTexts(on: On) {
  const texts: string[] = []
  on('ui.render', { component: 'AssistantMessage' }, (_, e, next) => {
    texts.push(e.props.text)
    return next(e)
  })
  return texts
}

const mount = ($: Engine, text: string) =>
  $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text, isFirstOfReply: true },
    viewport: { columns: 80, rows: 40 },
  })

test('inline and display math draw as images, the paragraph with the reply bullet', async ($, on) => {
  const calls = renderer(on, 0)
  const ui = await mount($, TEXT)
  expect(await ui.findAll({ type: 'Image' })).toHaveLength(2)
  expect(await ui.findAll({ type: 'Text', text: '⏺' })).toHaveLength(1)
  expect(await ui.find({ type: 'Text', text: 'Roots' })).toBeDefined()
  expect(JSON.parse(calls[0]!).items).toEqual([
    { tex: 'ax^2', display: false },
    { tex: 'x = 1', display: true },
  ])
  await ui.unmount()
})

test('a failed renderer draws inline math as Unicode text and is not rerun', async ($, on) => {
  const calls = renderer(on, 1)
  on('ui.log', () => ({ value: undefined }))
  const ui = await mount($, 'Fail $q^2$ case.')
  expect(await ui.findAll({ type: 'Image' })).toHaveLength(0)
  expect(await ui.find({ type: 'Text', text: texToUnicode('q^2') })).toBeDefined()
  await ui.unmount()
  await (await mount($, 'Fail $q^2$ case.')).unmount()
  expect(calls).toHaveLength(1)
})

test('a reply is drawn whole here, its markdown parts never handed to the hooks beneath', async ($, on) => {
  renderer(on, 0)
  const texts = engineTexts(on)
  const ui = await mount($, `${TEXT}\n\n# Heading\n\nLast.`)
  expect(await ui.find({ type: 'Markdown', text: /^\s*Done\.\n\n# Heading\n\nLast\.$/ })).toBeDefined()
  expect(texts).toEqual([])
  await ui.unmount()
})

const FENCE = '```mermaid\ngraph TD\n  A-->B\n```'
const DIAGRAM = `Flow:\n\n${FENCE}\n\nEnd.`

test('overlapping draws of the same formulas share one render', async ($, on) => {
  const { calls, release } = gatedRenderer(on)
  const ui = await mount($, 'Plain.')
  const first = ui.redraw({ text: TEXT, isFirstOfReply: true })
  const second = ui.redraw({ text: `${TEXT}\n\nMore.`, isFirstOfReply: true })
  release()
  await Promise.all([first, second])
  expect(calls).toHaveLength(1)
  expect(await ui.find({ type: 'Markdown', text: /More\.$/ })).toBeDefined()
  expect(await ui.findAll({ type: 'Image' })).toHaveLength(2)
  await ui.unmount()
})

test('a formula the cache dropped renders again', async ($, on) => {
  const calls = renderer(on, 0)
  const many = Array.from({ length: 201 }, (_, i) => `$x_{${i}}$`).join(' ')
  const ui = await mount($, many)
  await ui.redraw({ text: 'Again $x_{0}$.', isFirstOfReply: true })
  expect(calls).toHaveLength(2)
  expect(JSON.parse(calls[1]!).items).toEqual([{ tex: 'x_{0}', display: false }])
  expect(await ui.findAll({ type: 'Image' })).toHaveLength(1)
  await ui.unmount()
})

// Lets the work the plugin started settle: the kit's types lack timers, its runtime has them.
const settle = () =>
  new Promise<void>(r => (globalThis as unknown as { setTimeout: (f: () => void, ms: number) => void }).setTimeout(r, 0))

// A prompt drawn at 80 columns, then a reply streamed in `pieces`, settling after each.
async function streamReply($: Engine, on: On, pieces: string[], agentId?: string) {
  on('turn.step', async function* (_, e) {
    for (const text of pieces) {
      yield { kind: 'text' as const, index: 0, text }
      await settle()
    }
    return { turnId: e.turnId, index: e.index, answer: pieces.join(''), toolUses: [], stopReason: 'end_turn' as const, usage: null }
  })
  const prompt = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'UserMessage',
    props: { text: 'Roots?', origin: { kind: 'composer' }, isExpanded: false },
    viewport: { columns: 80, rows: 40 },
  })
  await prompt.unmount()
  let streamed = ''
  for await (const c of $.turn.step({ turnId: 't', index: 0, model: 'm', messageCount: 1, agentId })) {
    if (c.kind === 'text') streamed += c.text
  }
  expect(streamed).toBe(pieces.join(''))
}

const PIECES = ['Roots of $ax', '^2$ here.\n\n$$\nx = 1\n', '$$\n\nDone.']

test('a streaming reply renders each block once it closes, and the finished reply draws from those', async ($, on) => {
  const calls = renderer(on, 0)
  await streamReply($, on, PIECES)
  expect(calls.map(c => JSON.parse(c))).toEqual([
    { maxCols: 76, items: [{ tex: 'ax^2', display: false }] },
    { maxCols: 76, items: [{ tex: 'x = 1', display: true }] },
  ])
  const ui = await mount($, TEXT)
  expect(calls).toHaveLength(2)
  expect(await ui.findAll({ type: 'Image' })).toHaveLength(2)
  await ui.unmount()
})

test('blocks closing while a streaming render runs render together once it ends', async ($, on) => {
  const { calls, release } = gatedRenderer(on)
  await streamReply($, on, ['A $a$', ' B $b$', ' C $c$.'])
  release()
  await settle()
  expect(calls.map(c => JSON.parse(c).items.map((f: { tex: string }) => f.tex))).toEqual([['a'], ['b', 'c']])
  const ui = await mount($, 'A $a$ B $b$ C $c$.')
  expect(calls).toHaveLength(2)
  expect(await ui.findAll({ type: 'Image' })).toHaveLength(3)
  await ui.unmount()
})

test("a subagent's streaming text renders nothing", async ($, on) => {
  const calls = renderer(on, 0)
  await streamReply($, on, PIECES, 'agent-1')
  const ui = await mount($, TEXT)
  expect(calls).toHaveLength(1)
  await ui.unmount()
})

test('a mermaid block draws as an image', async ($, on) => {
  const calls = renderer(on, 0)
  const texts = engineTexts(on)
  const ui = await mount($, DIAGRAM)
  expect(await ui.findAll({ type: 'Image' })).toHaveLength(1)
  expect(JSON.parse(calls[0]!).items).toEqual([{ mermaid: 'graph TD\n  A-->B' }])
  expect(await ui.find({ type: 'Markdown', text: 'Flow:' })).toBeDefined()
  expect(await ui.find({ type: 'Markdown', text: /^\s*End\.$/ })).toBeDefined()
  expect(texts).toEqual([])
  await ui.unmount()
})

test('a diagram the renderer refuses stays a code block', async ($, on) => {
  renderer(on, 0, true)
  const ui = await mount($, DIAGRAM)
  expect(await ui.findAll({ type: 'Image' })).toHaveLength(0)
  expect(await ui.find({ type: 'Markdown', text: FENCE })).toBeDefined()
  await ui.unmount()
})

const COMPOSE = { model: 'm', promptModel: 'm', tools: [], outputStyle: null, traits: [] }

test('the prompt is added for the terminal only', async ($, on) => {
  on('prompt.compose', () => ({ sections: [] }))
  const ids = async (surfaces: ('terminal' | 'desktop')[]) =>
    (await $.prompt.compose({ ...COMPOSE, surfaces })).sections.map(s => s.id)
  expect(await ids(['terminal'])).toEqual(['agent-visuals'])
  expect(await ids(['desktop'])).toEqual([])
})
