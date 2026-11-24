import { expect, test } from 'claude-code/testing'

import { texToUnicode } from '../hooks/unicode'

// Raw template text, so TeX is written without doubled backslashes.
const u = (tex: TemplateStringsArray) => texToUnicode(tex.raw[0]!)

test('Greek letters, capitals and variants', async () => {
  expect(u`\alpha \beta \gamma \delta \pi \omega`).toBe('α β γ δ π ω')
  expect(u`\Gamma\Delta\Theta\Lambda\Xi\Pi\Sigma\Phi\Psi\Omega`).toBe('ΓΔΘΛΞΠΣΦΨΩ')
  expect(u`\epsilon \varepsilon \theta \vartheta \phi \varphi`).toBe('ϵ ε θ ϑ ϕ φ')
})

test('a letter-like symbol drops the space ending its name before an operand', async () => {
  expect(u`\Delta t \pi r^2 \partial f \nabla (fg) \lambda {x}`).toBe('Δt πr² ∂f ∇(fg) λx')
  expect(u`\alpha + \beta \gamma`).toBe('α + β γ')
  expect(u`\frac{\partial f}{\partial x}`).toBe('∂f/∂x')
  expect(u`x^\alpha y`).toBe('x^α y')
})

test('operators, relations, arrows and sets', async () => {
  expect(u`a \lt b \gt c`).toBe('a < b > c')
  expect(u`\pm \mp \times \cdot \div \leq \le \geq \ge \neq \ne \approx \equiv \sim \propto`).toBe(
    '± ∓ × · ÷ ≤ ≤ ≥ ≥ ≠ ≠ ≈ ≡ ∼ ∝',
  )
  expect(u`\infty \partial \nabla \sum \prod \int \oint`).toBe('∞ ∂ ∇ ∑ ∏ ∫ ∮')
  expect(u`\to \rightarrow \leftarrow \Rightarrow \Leftarrow \iff \Leftrightarrow \mapsto`).toBe('→ → ← ⇒ ⇐ ⇔ ⇔ ↦')
  expect(u`\in \notin \subset \subseteq \supset \cup \cap \emptyset \varnothing`).toBe('∈ ∉ ⊂ ⊆ ⊃ ∪ ∩ ∅ ∅')
  expect(u`\forall \exists \neg \land \lor`).toBe('∀ ∃ ¬ ∧ ∨')
  expect(u`\ldots \dots \cdots \circ \degree \hbar \ell`).toBe('… … ⋯ ∘ ° ℏ ℓ')
  expect(u`\langle\psi\rangle \|v\|`).toBe('⟨ψ⟩ ‖v‖')
})

test('mathbb maps to double-struck letters; other fonts keep their argument', async () => {
  expect(u`\mathbb{R} \mathbb{N} \mathbb{Z} \mathbb{Q} \mathbb{C} \mathbb{E}`).toBe('ℝ ℕ ℤ ℚ ℂ 𝔼')
  expect(u`\mathscr{F} \bm{w} \boldsymbol{u}`).toBe('F w u')
  expect(u`\mathcal{L} \mathbf{v} \mathrm{d}x \mathit{if} \textrm{ok} \operatorname{rank}(A)`).toBe(
    'L v dx if ok rank(A)',
  )
  expect(u`\text{for all } x`).toBe('for all x')
})

test('scripts use Unicode forms only when every character has one', async () => {
  expect(u`x^2`).toBe('x²')
  expect(u`x^{10}`).toBe('x¹⁰')
  expect(u`a_i`).toBe('aᵢ')
  expect(u`x_{n+1}`).toBe('xₙ₊₁')
  expect(u`x^{n + 1}`).toBe('xⁿ⁺¹')
  expect(u`x^q`).toBe('x^q')
  expect(u`e^{i\pi}`).toBe('e^(iπ)')
  expect(u`a_{i,j}`).toBe('a_(i,j)')
  expect(u`x^{(\pi)}`).toBe('x^(π)')
  expect(u`x^T A x`).toBe('xᵀ A x')
  expect(u`90^\circ`).toBe('90°')
  expect(u`f^\prime`).toBe('f′')
})

test('fractions parenthesize a side holding whitespace or an operator outside brackets', async () => {
  expect(u`\frac{a}{b}`).toBe('a/b')
  expect(u`\frac{a+b}{2}`).toBe('(a+b)/2')
  expect(u`\dfrac{1}{x - 1}`).toBe('1/(x - 1)')
  expect(u`\tfrac{-1}{2}`).toBe('(-1)/2')
  expect(u`\frac{dy}{dx}`).toBe('dy/dx')
  expect(u`\frac{f(x+1)}{2}`).toBe('f(x+1)/2')
  expect(u`\frac{\frac{a}{b}}{c}`).toBe('(a/b)/c')
  expect(u`\frac12`).toBe('1/2')
})

test('a fraction directly before a factor is parenthesized whole', async () => {
  expect(u`\frac{1}{2}mv^2`).toBe('(1/2)mv²')
  expect(u`\frac{a}{b}(c)`).toBe('(a/b)(c)')
  expect(u`\frac{1}{2}\pi`).toBe('(1/2)π')
  expect(u`\frac{1}{2}\sin x`).toBe('(1/2)sin x')
  expect(u`\frac{1}{2} x`).toBe('1/2 x')
  expect(u`\left(\frac{a}{b}\right)`).toBe('(a/b)')
  expect(u`\frac{a}{b}\cdot c`).toBe('a/b· c')
})

test('roots take a bare token, an index from a root sign or a superscript', async () => {
  expect(u`\sqrt{x}`).toBe('√x')
  expect(u`\sqrt{10}`).toBe('√10')
  expect(u`\sqrt{x+1}`).toBe('√(x+1)')
  expect(u`\sqrt{2x}`).toBe('√(2x)')
  expect(u`\sqrt{(a+b)}`).toBe('√(a+b)')
  expect(u`\sqrt{x_1}`).toBe('√x₁')
  expect(u`\sqrt[3]{x}`).toBe('∛x')
  expect(u`\sqrt[4]{x}`).toBe('∜x')
  expect(u`\sqrt[n]{x}`).toBe('ⁿ√x')
  expect(u`\sqrt[\pi]{x}`).toBe('^π√x')
})

test('sizing commands keep only their delimiter', async () => {
  expect(u`\left(\frac{a}{b}\right)^2`).toBe('(a/b)²')
  expect(u`\left\{x\right.`).toBe('{x')
  expect(u`\left. x \right|`).toBe('x |')
  expect(u`\bigl[x\bigr] \Big\langle y \Big\rangle \left\|v\right\|`).toBe('[x] ⟨ y ⟩ ‖v‖')
})

test('spacing commands become at most one space', async () => {
  expect(u`\int_0^1 x\,dx`).toBe('∫₀¹ x dx')
  expect(u`a\!b`).toBe('ab')
  expect(u`a\;b\:c\>d\ e~f`).toBe('a b c d e f')
  expect(u`a\quad b\qquad c`).toBe('a b c')
})

test('accents combine with a single-character base only', async () => {
  expect(u`\hat{x} \bar{y} \vec{v} \dot{q} \tilde{n} \hat\alpha`).toBe(
    'x\u0302 y\u0304 v\u20d7 q\u0307 n\u0303 α\u0302',
  )
  expect(u`\hat{AB} \widehat{y} \overline{z}`).toBe('AB y\u0302 z\u0305')
  expect(u`\sqrt{\hat{x}}`).toBe('√x\u0302')
})

test('braces, line breaks and whitespace', async () => {
  expect(u`\{x \mid x > 0\}`).toBe('{x | x > 0}')
  expect(u`{a}{b}c`).toBe('abc')
  expect(u`a \\ b\\c`).toBe('a; b; c')
  expect(texToUnicode('  a   +\n\t b  ')).toBe('a + b')
})

test('unknown commands keep their name, with braced arguments in parentheses', async () => {
  expect(u`\foo`).toBe('foo')
  expect(u`\binom{n}{k} \pmod{p} \boxed{ 42 }`).toBe('binom(n, k) pmod(p) boxed(42)')
  expect(u`\sin x + \log(y)`).toBe('sin x + log(y)')
  expect(u`\constructor \toString`).toBe('constructor toString')
  expect(u`50\%`).toBe('50%')
})

test('malformed input still returns best-effort text', async () => {
  expect(u`\frac{a}{`).toBe('a/')
  expect(u`\frac{a`).toBe('a/')
  expect(u`x^{2`).toBe('x²')
  expect(u`}a{`).toBe('a')
  expect(u`x^`).toBe('x')
  expect(u`\sqrt[3`).toBe('∛')
  expect(texToUnicode('\\')).toBe('')
  expect(texToUnicode('')).toBe('')
  const deep = `${'{'.repeat(100_000)}x`
  expect(texToUnicode(deep)).toBe(deep)
})

test('whole formulas', async () => {
  expect(u`ax^2 + bx + c = 0`).toBe('ax² + bx + c = 0')
  expect(u`e^{i\pi} + 1 = 0`).toBe('e^(iπ) + 1 = 0')
  expect(u`\frac{-b \pm \sqrt{b^2 - 4ac}}{2a}`).toBe('(-b ± √(b² - 4ac))/2a')
  expect(u`\sum_{n=1}^{\infty} \frac{1}{n^2}`).toBe('∑ₙ₌₁^∞ 1/n²')
  expect(u`\int_0^1 x\,dx`).toBe('∫₀¹ x dx')
  expect(u`\mathbb{R}^n`).toBe('ℝⁿ')
  expect(u`\hat{x}`).toBe('x\u0302')
  expect(u`\lim_{x \to 0} \frac{\sin x}{x} = 1`).toBe('lim_(x → 0) (sin x)/x = 1')
})
