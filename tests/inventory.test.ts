import { expect, test } from 'claude-code/testing'
import { buildInventory, namesByPath, ranked, sourceFiles, wordsOf } from '../hooks/inventory'

test('only source files are listed, never tests, builds or vendored code', () => {
  const listed = ['src/a.ts', 'src/a.test.ts', 'dist/a.js', 'vendor/x.go', 'README.md', 'app/models/user.rb', 'pkg/server.go', 'types.d.ts'].join('\n')
  expect(sourceFiles(listed)).toEqual(['src/a.ts', 'app/models/user.rb', 'pkg/server.go'])
})

test('each file keeps the names it defines, in any of the usual languages', () => {
  const grepped = [
    'src/a.ts:export async function renderDrain() {',
    'src/a.ts:export type Job = {',
    'app/user.py:def send_welcome(user):',
    'pkg/server.go:func (s *Server) ServeHTTP(w http.ResponseWriter) {',
    'crates/core/src/lib.rs:pub(crate) fn parse_config() {',
    'other/unlisted.ts:export const Nope = 1',
  ].join('\n')
  const names = namesByPath(grepped, new Set(['src/a.ts', 'app/user.py', 'pkg/server.go', 'crates/core/src/lib.rs']))
  expect(Object.fromEntries(names)).toEqual({
    'src/a.ts': ['renderDrain', 'Job'],
    'app/user.py': ['send_welcome'],
    'pkg/server.go': ['ServeHTTP'],
    'crates/core/src/lib.rs': ['parse_config'],
  })
})

test('a project over the budget ranks the files whose words the draft uses first', () => {
  const files = ['src/server/render-drain.ts', 'src/render/runner.ts', 'src/ui/app-header.tsx', 'src/review/queue.ts']
  const inv = buildInventory(files, new Map([['src/review/queue.ts', ['drainReviewQueue']]]), 10)
  expect(inv.whole).toBe('')
  expect(ranked(inv, 'what does the render drain do when a job times out?', []).split('\n')).toEqual([
    'src/server/render-drain.ts',
    'src/review/queue.ts: drainReviewQueue',
    'src/render/runner.ts',
  ])
  expect(ranked(inv, 'tidy this up', ['src/ui/app-header.tsx'])).toBe('src/ui/app-header.tsx')
})

test('words match across spellings of a name', () => {
  expect([...wordsOf('renderDrain render-drain the render drains')]).toEqual(['render', 'drain'])
})

test("a draft's words in a file's own name outrank the same words in its folders", () => {
  const inv = buildInventory(['src/queue/drain/x.ts', 'src/background/jobs/queue-drain.ts'], new Map(), 10)
  expect(ranked(inv, 'the queue drain stalls', []).split('\n')[0]).toBe('src/background/jobs/queue-drain.ts')
})
