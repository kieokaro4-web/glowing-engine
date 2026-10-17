// Directus docs crawler. The docs site is a Nuxt app: the visible "next page"
// link at the bottom of each page is hydrated from a `_payload.json` blob whose
// `*-surround` entry holds [prev, next]. This script dereferences that payload,
// saves each page's raw markdown, then follows the next anchor.
//
// Usage: bun scripts/docs-crawl.ts <start-path> [--max N] [--outdir DIR]
//   start-path e.g. /docs/guides/realtime/authentication   (default)
//   N defaults to 8; DIR defaults to ./docs-cache
import { mkdir } from 'node:fs/promises'

const args = process.argv.slice(2)
const start = args[0] ?? '/docs/configuration/realtime'
const max = Number(args.includes('--max') ? args[args.indexOf('--max') + 1] : 8)
const outdir = args.includes('--outdir') ? args[args.indexOf('--outdir') + 1] : 'docs-cache'
await mkdir(outdir, { recursive: true })

let path = start
for (let i = 0; i < max && path; i++) {
  const html = await (await fetch('https://directus.com' + path)).text()
  const src = html.match(/data-src="(\/docs\/[^"]+_payload\.json[^"]*)"/)?.[1]
  if (!src) { console.error('no payload for', path); break }
  const A = await (await fetch('https://directus.com' + src)).json()
  const deref = (v: unknown, depth = 0): unknown => {
    if (typeof v !== 'number' || v >= A.length) return v
    if (depth > 4) return '#deep'
    const raw = A[v]
    if (raw === null || typeof raw !== 'object') return raw
    if (Array.isArray(raw)) {
      const items = typeof raw[0] === 'string' && /^[A-Z@]/.test(raw[0]) ? raw.slice(1) : raw
      return items.map((x) => deref(x, depth + 1))
    }
    const out: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(raw)) out[k] = deref(val, depth + 1)
    return out
  }
  let map = deref(A[0].data)
  if (Array.isArray(map)) map = map[0]
  const key = path.replace(/^\/docs/, '')
  const page = (map as Record<string, any>)?.[key]
  const surround = (map as Record<string, any>)?.[key + '-surround']
  if (!page) { console.error('no page entry for', key); break }
  const rawbody = typeof page.rawbody === 'string' ? page.rawbody : ''
  const file = `${outdir}/${key.replace(/^\//, '').replace(/\//g, '__')}.md`
  await Bun.write(file, `# ${page.title ?? key}\nURL: https://directus.com${path}\n\n${rawbody.replace(/^---[\s\S]*?---/, '')}`)
  const next = Array.isArray(surround) && surround[1]?.path && surround[1].path !== key ? surround[1] : null
  console.log(`saved ${key} (${rawbody.length} chars) -> next: ${next?.path ?? 'none'}`)
  path = next ? '/docs' + next.path : ''
}
