// Writes dist/LICENSES.txt: the licence of every package esbuild bundled into dist/.
import fs from 'node:fs'

const meta = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const dirs = new Set()
for (const file of Object.keys(meta.inputs)) {
  const m = /^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(file)
  if (m) dirs.add(m[1])
}
const notices = [...dirs].sort().map(dir => {
  const pkg = JSON.parse(fs.readFileSync(`${dir}/package.json`, 'utf8'))
  const file = fs.readdirSync(dir).find(f => /^licen[cs]e/i.test(f))
  const text = file ? fs.readFileSync(`${dir}/${file}`, 'utf8').trim() : `License: ${pkg.license}`
  return `${pkg.name}@${pkg.version} (${pkg.license})\n\n${text}`
})
fs.writeFileSync('dist/LICENSES.txt', `${notices.join(`\n\n${'-'.repeat(72)}\n\n`)}\n`)
