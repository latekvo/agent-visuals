import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { texToUnicode } from '../hooks/unicode'

const PLUGIN = 'agent-visuals'
// A 1x1 transparent PNG.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const TEXT = 'Roots of $ax^2$ here.\n\n$$\nx = 1\n$$\n\nDone.'

function renderer(on: On, exitCode: number) {
  const calls: string[] = []
  on('process.run', (_, e) => {
    calls.push(e.init?.stdin ?? '')
    const { items } = JSON.parse(e.init?.stdin ?? '{}') as { items: { display: boolean }[] }
    const results = items.map(it => ({ png: PNG, cols: 3, rows: it.display ? 2 : 1 }))
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

const COMPOSE = { model: 'm', promptModel: 'm', tools: [], outputStyle: null, traits: [] }

test('the math prompt is added for the terminal only', async ($, on) => {
  on('prompt.compose', () => ({ sections: [] }))
  const ids = async (surfaces: ('terminal' | 'desktop')[]) =>
    (await $.prompt.compose({ ...COMPOSE, surfaces })).sections.map(s => s.id)
  expect(await ids(['terminal'])).toEqual(['agent-visuals:math'])
  expect(await ids(['desktop'])).toEqual([])
})
