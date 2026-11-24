import { expect, test } from 'claude-code/testing'

import { escapeMarkdown, parseInline, replaceInlineMath, splitBlocks, splitDisplay } from '../hooks/parse'

const display = (t: string) =>
  splitDisplay(t).map(s => (s.kind === 'math' ? `M:${s.tex}` : s.kind === 'diagram' ? `D:${s.code}` : 'T'))
const inline = (t: string) =>
  parseInline(t).map(p => {
    if (p.kind === 'math') return `M:${p.tex}`
    const marks = [p.bold && 'b', p.italic && 'i', p.code && 'c', p.href && `@${p.href}`].filter(Boolean).join('')
    return marks ? `${marks}:${p.text}` : p.text
  })

test('display math: $$ and \\[ blocks, one-line and multi-line', async () => {
  expect(display('a\n$$\nx^2\n$$\nb')).toEqual(['T', 'M:x^2', 'T'])
  expect(display('$$e^{i\\pi}+1=0$$')).toEqual(['M:e^{i\\pi}+1=0'])
  expect(display('\\[\nA^{-1}\n\\]')).toEqual(['M:A^{-1}'])
})

test('display math: fences, stray openers, blank lines and empty blocks stay text', async () => {
  expect(display('~~~\n$$x$$\n~~~')).toEqual(['T'])
  expect(display('$$ costs here\nmore text\n$$y$$')).toEqual(['T', 'M:y'])
  expect(display('$$\nx\n\npara\n$$z$$')).toEqual(['T', 'M:z'])
  expect(display('$$$$')).toEqual(['T'])
})

test('diagrams: closed mermaid fences; unclosed, empty and other fences stay text', async () => {
  expect(display('a\n```mermaid\ngraph TD\n  A-->B\n```\nb')).toEqual(['T', 'D:graph TD\n  A-->B', 'T'])
  expect(display('~~~ Mermaid\npie\n~~~~')).toEqual(['D:pie'])
  expect(display('```mermaid\ngraph TD\nA-->B')).toEqual(['T'])
  expect(display('```mermaid\n\n```')).toEqual(['T'])
  expect(display('```js\nx\n```\n```mermaid\npie\n```')).toEqual(['T', 'D:pie'])
  // A fence with an info string never closes one (CommonMark).
  expect(display('```mermaid\npie\n```js\n```')).toEqual(['D:pie\n```js'])
})

test('inline math: $...$ and \\(...\\) between text', async () => {
  expect(inline('roots of $ax^2 + bx + c = 0$ when $a \\neq 0$.')).toEqual([
    'roots of ',
    'M:ax^2 + bx + c = 0',
    ' when ',
    'M:a \\neq 0',
    '.',
  ])
  expect(inline('so \\(x+1\\) holds')).toEqual(['so ', 'M:x+1', ' holds'])
})

test('inline math: prices, unclosed and escaped dollars stay text', async () => {
  expect(inline('costs $5 and $10')).toEqual(['costs $5 and $10'])
  expect(inline('from $5 to $x$')).toEqual(['from $5 to ', 'M:x'])
  expect(inline('$HOME is set')).toEqual(['$HOME is set'])
  expect(inline('\\$5 and \\$6')).toEqual(['$5 and $6'])
  expect(inline('$1$2')).toEqual(['$1$2'])
  expect(inline('a $ b$ c')).toEqual(['a $ b$ c'])
  expect(inline('like $5 and $10 stay text, as does `$x$` here')).toEqual([
    'like $5 and $10 stay text, as does ',
    'c:$x$',
    ' here',
  ])
})

test('inline markdown: code spans protect math, styles and links parse', async () => {
  expect(inline('`$x$` code')).toEqual(['c:$x$', ' code'])
  expect(inline('**bold** and *it* in snake_case_name')).toEqual([
    'b:bold',
    ' and ',
    'i:it',
    ' in snake_case_name',
  ])
  expect(inline('see [docs](https://e.com) now')).toEqual(['see ', '@https://e.com:docs', ' now'])
})

test('blocks: paragraphs and lists with inline math flow, the rest stays raw', async () => {
  const blocks = splitBlocks('Para with $x$.\n\nPlain para.')
  expect(blocks.map(b => b.kind)).toEqual(['flow', 'raw'])
  expect(blocks[1]!.kind === 'raw' && blocks[1]!.text.trim()).toBe('Plain para.')

  const [list] = splitBlocks('- one $x$\n- two\n  continued')
  expect(list!.kind === 'flow' && list!.items.map(it => it.prefix)).toEqual(['- ', '- '])
  expect(list!.kind === 'flow' && list!.items[1]!.pieces).toEqual([{ kind: 'text', text: 'two continued' }])

  expect(splitBlocks('# Title $x$').map(b => b.kind)).toEqual(['raw'])
  expect(splitBlocks('| a | $x$ |').map(b => b.kind)).toEqual(['raw'])
  expect(splitBlocks('```\n$x$\n```').map(b => b.kind)).toEqual(['raw'])
  expect(splitBlocks('a\n\nb')).toEqual([{ kind: 'raw', text: 'a\n\nb' }])
})

test('replaceInlineMath: replaces math outside code and fences only', async () => {
  const x = () => 'X'
  expect(replaceInlineMath('| $x^2$ | $5 |', x)).toBe('| X | $5 |')
  expect(replaceInlineMath('`$x$` and $y$', x)).toBe('`$x$` and X')
  expect(replaceInlineMath('```\n$x$\n```\n$y$', x)).toBe('```\n$x$\n```\nX')
})

test('escapeMarkdown: pipes, emphasis, code and link markers are escaped', async () => {
  expect(escapeMarkdown('|x| * a_b `c` [d]')).toBe('\\|x\\| \\* a\\_b \\`c\\` \\[d\\]')
  expect(escapeMarkdown('a\\b')).toBe('a\\\\b')
})
