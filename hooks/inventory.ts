// What Haiku chooses from: the project's source files and the names each one defines. A project
// whose list fits the budget is sent whole, once, and cached. A larger one is sent as its folder tree
// plus the entries that share words with the draft, ranked, the way Aider's repo map fits a budget.

const SOURCE = /\.(tsx?|jsx?|mjs|cjs|vue|svelte|astro|py|go|rs|rb|java|kt|swift|php|cs|c|cc|cpp|h|hpp)$/
const NOT_SOURCE =
  /(^|\/)(node_modules|vendor|third_party|dist|build|out|coverage|\.next|drizzle|migrations?|__tests__|__mocks__|tests?|fixtures?)\/|\.(test|spec|stories|gen|min|d)\.[a-z]+$/
// The lines that define a name, for `git grep -E`: exports in JS and TS, top-level definitions elsewhere.
export const DEFINES = '^(export |def |class |func |type |pub |module |interface |struct |enum |trait )'
const NAME =
  /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:pub(?:\([^)]*\))?\s+)?(?:function\*?|const|let|class|type|interface|enum|def|func|struct|trait|module|fn)\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/
const MAX_NAMES = 12
// Characters, about four to a token: a whole list up to about 24k tokens, a ranked one about 6k.
export const WHOLE_BUDGET = 96_000
export const RANKED_BUDGET = 24_000
const FOLDER_BUDGET = 12_000
const STOP = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'these', 'those', 'make', 'fix', 'add', 'can', 'you', 'please', 'should',
  'when', 'from', 'into', 'are', 'was', 'not', 'but', 'its', 'our', 'all', 'any', 'more', 'less', 'too', 'also', 'just',
  'like', 'look', 'looks', 'need', 'needs', 'some', 'there', 'they', 'them', 'then', 'what', 'why', 'how', 'does', 'have',
  'has', 'use', 'get', 'set', 'new', 'old', 'out', 'off', 'onto', 'over', 'under', 'about', 'lets', 'let', 'want', 'would',
  'index', 'src', 'lib', 'app', 'tsx', 'jsx',
])

export type Entry = { path: string; names: readonly string[]; base: ReadonlySet<string>; rest: ReadonlySet<string>; line: string }

export type Inventory = {
  entries: readonly Entry[]
  byPath: ReadonlyMap<string, Entry>
  // The whole list when it fits the budget, else empty and each read ranks its own.
  whole: string
  folders: string
}

export function sourceFiles(listed: string): string[] {
  return listed.split('\n').filter(f => SOURCE.test(f) && !NOT_SOURCE.test(f))
}

// `git grep -I -E DEFINES` prints "path:line"; each file keeps its first few names.
export function namesByPath(grepped: string, files: ReadonlySet<string>): Map<string, string[]> {
  const names = new Map<string, string[]>()
  for (const row of grepped.split('\n')) {
    const at = row.indexOf(':')
    const path = row.slice(0, at)
    const name = row.slice(at + 1).match(NAME)?.[1]
    if (at < 0 || !name || !files.has(path)) continue
    const own = names.get(path) ?? []
    if (own.length < MAX_NAMES && !own.includes(name)) names.set(path, [...own, name])
  }
  return names
}

export function buildInventory(files: readonly string[], names: ReadonlyMap<string, readonly string[]>, budget = WHOLE_BUDGET): Inventory {
  const entries = files.map((path): Entry => {
    const own = names.get(path) ?? []
    const parts = path.split('/')
    return {
      path,
      names: own,
      base: wordsOf(parts.at(-1)?.replace(/\.[^.]+$/, '') ?? ''),
      rest: wordsOf([...parts.slice(0, -1), ...own].join(' ')),
      line: own.length ? `${path}: ${own.join(', ')}` : path,
    }
  })
  const listed = entries.map(e => e.line).join('\n')
  const folders = [...new Set(files.map(f => f.split('/').slice(0, -1).join('/')).filter(Boolean))].sort()
  return {
    entries,
    byPath: new Map(entries.map(e => [e.path, e])),
    whole: listed.length <= budget ? listed : '',
    folders: fit(folders, FOLDER_BUDGET).join('\n'),
  }
}

// The entries a draft most likely means, best first, within the budget: two points for each draft
// word in the file's own name, one for each in its folders or names, four for a file the agent's last
// reply touched.
export function ranked(inv: Inventory, draft: string, recent: readonly string[], budget = RANKED_BUDGET): string {
  const said = wordsOf(draft)
  const score = (e: Entry) => {
    let n = recent.includes(e.path) ? 4 : 0
    for (const w of said) n += e.base.has(w) ? 2 : e.rest.has(w) ? 1 : 0
    return n
  }
  const scored = inv.entries.map(e => ({ e, n: score(e) })).filter(x => x.n > 0)
  scored.sort((a, b) => b.n - a.n || a.e.path.length - b.e.path.length)
  return fit(
    scored.map(x => x.e.line),
    budget,
  ).join('\n')
}

// Lowercase words of a path, identifier or sentence: "renderDrain", "render-drain" and "render
// drains" all give "render" and "drain".
export function wordsOf(text: string): Set<string> {
  const words = text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(w => w.length >= 3 && !STOP.has(w))
    .map(singular)
  return new Set(words)
}

export function singular(word: string): string {
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`
  if (/(?:ch|sh|x|ss|z)es$/.test(word)) return word.slice(0, -2)
  return word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word
}

function fit(lines: readonly string[], budget: number): string[] {
  const out: string[] = []
  let used = 0
  for (const line of lines) {
    if (used + line.length + 1 > budget) break
    out.push(line)
    used += line.length + 1
  }
  return out
}
