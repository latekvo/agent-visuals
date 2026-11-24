// Whitespace-separated `name value` pairs.
function pairs(list: string): Map<string, string> {
  const words = list.trim().split(/\s+/)
  const out = new Map<string, string>()
  for (let n = 0; n < words.length; n += 2) out.set(words[n]!, words[n + 1]!)
  return out
}

function zip(keys: string, values: string): Map<string, string> {
  const v = [...values]
  return new Map([...keys].map((k, n) => [k, v[n]!]))
}

const SYMBOLS = new Map([
  ...pairs(`
    alpha α beta β gamma γ delta δ epsilon ϵ varepsilon ε zeta ζ eta η theta θ vartheta ϑ iota ι kappa κ
    lambda λ mu μ nu ν xi ξ omicron ο pi π varpi ϖ rho ρ varrho ϱ sigma σ varsigma ς tau τ upsilon υ
    phi ϕ varphi φ chi χ psi ψ omega ω
    Gamma Γ Delta Δ Theta Θ Lambda Λ Xi Ξ Pi Π Sigma Σ Upsilon Υ Phi Φ Psi Ψ Omega Ω
    pm ± mp ∓ times × cdot · div ÷ ast ∗ star ⋆ circ ∘ bullet • oplus ⊕ otimes ⊗ setminus ∖
    leq ≤ le ≤ geq ≥ ge ≥ neq ≠ ne ≠ approx ≈ equiv ≡ sim ∼ simeq ≃ cong ≅ propto ∝ ll ≪ gg ≫
    lt < gt > leqslant ≤ geqslant ≥ perp ⊥ parallel ∥ mid | colon : bmod mod
    to → rightarrow → leftarrow ← gets ← leftrightarrow ↔ Rightarrow ⇒ implies ⇒ Leftarrow ⇐
    iff ⇔ Leftrightarrow ⇔ mapsto ↦ uparrow ↑ downarrow ↓
    in ∈ notin ∉ ni ∋ subset ⊂ subseteq ⊆ supset ⊃ supseteq ⊇ cup ∪ cap ∩ emptyset ∅ varnothing ∅
    forall ∀ exists ∃ neg ¬ lnot ¬ land ∧ wedge ∧ lor ∨ vee ∨
    infty ∞ partial ∂ nabla ∇ sum ∑ prod ∏ int ∫ iint ∬ oint ∮ ldots … dots … cdots ⋯ vdots ⋮ ddots ⋱
    langle ⟨ rangle ⟩ lfloor ⌊ rfloor ⌋ lceil ⌈ rceil ⌉ vert | lvert | rvert | Vert ‖ lVert ‖ rVert ‖ | ‖
    hbar ℏ ell ℓ Re ℜ Im ℑ aleph ℵ angle ∠ degree ° prime ′ dagger † therefore ∴ because ∵
  `),
  [',', ' '],
  [':', ' '],
  [';', ' '],
  ['>', ' '],
  [' ', ' '],
  ['!', ''],
  ['quad', ' '],
  ['qquad', ' '],
  ['\\', '; '],
  ['displaystyle', ''],
  ['textstyle', ''],
  ['limits', ''],
  ['nolimits', ''],
])

const SUP = zip(
  '0123456789+-=()abcdefghijklmnoprstuvwxyzABDEGHIJKLMNOPRTUVW∘′',
  '⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ᵃᵇᶜᵈᵉᶠᵍʰⁱʲᵏˡᵐⁿᵒᵖʳˢᵗᵘᵛʷˣʸᶻᴬᴮᴰᴱᴳᴴᴵᴶᴷᴸᴹᴺᴼᴾᴿᵀᵁⱽᵂ°′',
)
const SUB = zip('0123456789+-=()aehijklmnoprstuvx', '₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₕᵢⱼₖₗₘₙₒₚᵣₛₜᵤᵥₓ')
const ACCENTS = pairs(
  'hat \u0302 widehat \u0302 bar \u0304 overline \u0305 vec \u20d7 dot \u0307 ddot \u0308 tilde \u0303 widetilde \u0303',
)
// Already in Letterlike Symbols; the rest are at U+1D538 + (letter - A).
const BLACKBOARD = zip('CHNPQRZ', 'ℂℍℕℙℚℝℤ')
const ROOTS = new Map([
  ['', '√'],
  ['3', '∛'],
  ['4', '∜'],
])
const MARKS = new Set([...SUP.values(), ...SUB.values(), ...ACCENTS.values()])
const OPERATORS = '+-±∓×·÷/=<>≤≥≠≈≡∼≃≅∝≪≫→←↔⇒⇐⇔↦∈∉∋⊂⊆⊃⊇∪∩∧∨,'
const LETTERLIKE = /^[\u0370-\u03ff∂∇ℏℓℜℑℵ]$/

const FRAC = /^[dtc]?frac$/
const FONT = /^(math(cal|scr|bf|rm|it|sf|tt|frak)|text(rm|bf|it|sf|tt)?|operatorname|boldsymbol|bm|mbox)$/
const SIZED = /^(left|right|middle|[bB]igg?[lrm]?)$/

const wrap = (s: string, isBare: boolean) => (isBare ? s : `(${s})`)

// No whitespace or operator outside brackets: `2a`, `n²`, `f(x+1)`.
function isTerm(s: string): boolean {
  let depth = 0
  for (const c of s) {
    if ('([{⟨'.includes(c)) depth++
    else if (')]}⟩'.includes(c)) depth--
    else if (depth === 0 && (/\s/.test(c) || OPERATORS.includes(c))) return false
  }
  return true
}

function isEnclosed(s: string): boolean {
  let depth = 0
  for (let n = 0; n < s.length; n++) {
    depth +=
      s[n] === '(' ? 1
      : s[n] === ')' ? -1
      : 0
    if (depth === 0) return n > 0 && n === s.length - 1
  }
  return false
}

// One character or number, with any scripts and accents after it, or a whole `(...)`.
function isToken(s: string): boolean {
  const base = [...s]
  while (base.length > 1 && MARKS.has(base[base.length - 1]!)) base.pop()
  return base.length <= 1 || /^\d+(\.\d+)?$/.test(base.join('')) || isEnclosed(s)
}

function script(s: string, map: Map<string, string>, mark: string): string {
  if (!s) return ''
  const mapped = [...s.replace(/\s+/g, '')].map(c => map.get(c))
  if (mapped.every(c => c !== undefined)) return mapped.join('')
  return mark + wrap(s, isToken(s))
}

function blackboard(c: string): string {
  if (BLACKBOARD.has(c)) return BLACKBOARD.get(c)!
  return /^[A-Z]$/.test(c) ? String.fromCodePoint(0x1d538 + c.charCodeAt(0) - 65) : c
}

// Inline LaTeX math as one line of plain Unicode text, for places an image can't go.
export function texToUnicode(tex: string): string {
  let i = 0

  const skipSpace = () => {
    while (i < tex.length && /\s/.test(tex[i]!)) i++
  }

  // Reads up to `end`, or to the end of input when it never comes.
  const seq = (end?: string): string => {
    let out = ''
    while (i < tex.length) {
      const c = tex[i++]!
      if (c === end) break
      if (c === '{') out += seq('}')
      else if (c === '\\') {
        const piece = command()
        out += piece
        // TeX drops the space ending a control word, so `\Delta t` reads Δt.
        if (LETTERLIKE.test(piece)) i += /^\s*(?=[A-Za-z0-9({])/.exec(tex.slice(i))?.[0].length ?? 0
      } else if (c === '^') out += script(arg().trim(), SUP, '^')
      else if (c === '_') out += script(arg().trim(), SUB, '_')
      else if (c === '~') out += ' '
      else if (c !== '}') out += c
    }
    return out
  }

  const arg = (): string => {
    skipSpace()
    const c = tex[i]
    if (c === undefined || c === '}') return ''
    i++
    if (c === '{') return seq('}')
    if (c === '\\') return command()
    return c
  }

  const command = (): string => {
    const name = /^[a-zA-Z]+/.exec(tex.slice(i))?.[0] ?? tex[i] ?? ''
    i += name.length
    const symbol = SYMBOLS.get(name)
    if (symbol !== undefined) return symbol
    if (FRAC.test(name)) {
      const num = arg().trim()
      const den = arg().trim()
      const frac = `${wrap(num, isTerm(num))}/${wrap(den, isTerm(den))}`
      return wrap(frac, !isFactorNext())
    }
    if (name === 'sqrt') {
      skipSpace()
      let index = ''
      if (tex[i] === '[') {
        i++
        index = seq(']').trim()
      }
      const body = arg().trim()
      return (ROOTS.get(index) ?? `${script(index, SUP, '^')}√`) + wrap(body, isToken(body))
    }
    if (name === 'mathbb') return [...arg()].map(blackboard).join('')
    if (FONT.test(name)) return arg()
    if (SIZED.test(name)) {
      skipSpace()
      if (tex[i] !== '.') return arg()
      i++
      return ''
    }
    const accent = ACCENTS.get(name)
    if (accent !== undefined) {
      const base = arg().trim()
      return [...base].length === 1 ? base + accent : base
    }
    if (!/^[a-zA-Z]/.test(name) || tex[i] !== '{') return name
    const args: string[] = []
    while (tex[i] === '{') {
      i++
      args.push(seq('}').trim())
    }
    return `${name}(${args.join(', ')})`
  }

  // `\frac{1}{2}mv^2` must not read as 1/(2mv²).
  const isFactorNext = () => {
    const word = /^\\([a-zA-Z]+)/.exec(tex.slice(i))?.[1]
    if (word === undefined) return /^[A-Za-z0-9(]/.test(tex.slice(i))
    const symbol = SYMBOLS.get(word)
    return symbol === undefined ? !/^(right|middle|[bB]igg?r)$/.test(word) : LETTERLIKE.test(symbol)
  }

  try {
    // `a \\ b` reads a; b, not a ; b.
    return seq().replace(/\s+/g, ' ').replace(/ ;/g, ';').trim()
  } catch {
    // Nesting deep enough to overflow the stack.
    return tex.replace(/\s+/g, ' ').trim()
  }
}
