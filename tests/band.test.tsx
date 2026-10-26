import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, PromptEditInput, PromptEditResult, TurnCompleteInput } from 'claude-code'

const BAND = {
  plugin: 'pinpoint',
  component: 'AbovePrompt',
  requestId: 'band',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 20,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const FILES = 'src/ui/app-header.tsx\nsrc/ui/page-header.tsx\nsrc/ui/header-menu.tsx\nsrc/ui/copy-button.tsx\nsrc/ui/theme-switch.tsx\nsrc/submit/slug.ts\n'
const NAMES = 'src/submit/slug.ts:export function slugify(title: string) {\nsrc/submit/slug.ts:export const SLUG_MAX = 40\n'

// The engine beneath the mod, on Claude Desktop: a prompt box, git, and Haiku answering each read
// with the next of `replies` (the last one again once they run out).
function desktop(on: On, ...replies: string[]) {
  const clock = mock.clock(on)
  const world = { box: { text: '', cursor: 0 }, sent: '', fills: 0, prompts: [] as string[], duringRead: async () => {}, files: FILES }
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.surface', () => ({ value: 'desktop' }))
  on('session.surfaces', () => ({ value: ['desktop'] }))
  on('session.authorize', () => ({ value: null }))
  on('process.run', (_, e) =>
({
    value: { exitCode: 0, stdout: e.argv[1] === 'grep' ? NAMES : world.files, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('fs.write', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('prompt.read', () => ({ value: { ...world.box } }))
  on('prompt.edit', (_, e) => {
    const text = e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end)
    world.box = { text, cursor: e.start + e.inputText.length }
    return { ...world.box }
  })
  on('prompt.fill', (_, e) => {
    world.fills += 1
    world.box = { text: e.text, cursor: e.text.length }
    return { isFilled: true }
  })
  on('prompt.submit', (_, e) => {
    world.sent = e.text
    return { text: e.text }
  })
  on('model.complete', async (_, e) => {
    world.prompts.push(e.prompt)
    const during = world.duringRead
    world.duringRead = async () => {}
    await during()
    const text = replies.length > 1 ? (replies.shift() as string) : (replies[0] ?? 'NONE')
    const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
    return { value: text === 'FAIL' ? { isAnswered: false as const, reason: 'empty-reply' as const, usage } : { isAnswered: true as const, text, usage } }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  return { clock, world }
}

// The kit raises these like any event, though its typings list no call for them.
function edit($: Engine, e: Omit<PromptEditInput, 'origin'>): Promise<PromptEditResult> {
  const prompt = $.prompt as unknown as { edit: (input: PromptEditInput) => Promise<PromptEditResult> }
  return prompt.edit({ origin: { kind: 'composer' }, ...e })
}

function turnComplete($: Engine, answer: string): Promise<unknown> {
  const turn = $.turn as unknown as { complete: (input: Partial<TurnCompleteInput>) => Promise<unknown> }
  return turn.complete({ answer, durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
}

// The project is listed in the background after session.start; this lets that land first.
async function start($: Engine) {
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

async function typeDraft($: Engine, clock: { advance: (ms: number) => Promise<void> }, draft: string) {
  await start($)
  await edit($, { text: '', cursor: 0, start: 0, end: 0, inputText: draft })
  await clock.advance(700)
}

const HEADER_GUESSES = 'the header | src/ui/app-header.tsx | src/ui/page-header.tsx'

test('the caret in a highlighted phrase opens a drawer of its guesses, on every surface', async ($, on) => {
  const { clock } = desktop(on, HEADER_GUESSES)
  const draft = 'make the header less cramped'
  await typeDraft($, clock, draft)
  await edit($, { text: draft, cursor: draft.length, start: 7, end: 7, inputText: '' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Button', text: /Page header/ }))?.text).toBe('Page header')
    expect(await ui.find({ type: 'Text', text: /src\/ui\/page-header\.tsx/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a picked guess leaves the draft alone and lands as an @path in the message sent', async ($, on) => {
  const { clock, world } = desktop(on, HEADER_GUESSES)
  await typeDraft($, clock, 'make the header less cramped')

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'use:the header:src/ui/page-header.tsx' })
  await ui.unmount()
  await $.prompt.submit({ text: world.box.text, wait: false, origin: { kind: 'composer' } })

  expect(world.fills).toBe(0)
  expect(world.sent).toBe('make the header (@src/ui/page-header.tsx) less cramped')
})

test('only short noun phrases naming a part are shown: no question, no filler or property, at most five words', async ($, on) => {
  const question = 'what about the footer?'
  const long = 'the big blue wavy line up top'
  const reply = [question, 'the thing', 'the padding', 'the other options', 'more space between rows', long].map(p => `${p} | src/ui/app-header.tsx`).join('\n')
  const { clock } = desktop(on, reply)
  await typeDraft($, clock, `${question} fix the thing, the padding and the other options, more space between rows and ${long}`)

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /“/ })).toBeUndefined()
  await ui.unmount()
})

test('a part Haiku names twice in one reply gets one highlight, the longer phrase', async ($, on) => {
  const reply = 'the badges on each card | src/ui/app-header.tsx\neach card | src/ui/page-header.tsx'
  const { clock, world } = desktop(on, reply)
  await typeDraft($, clock, 'the badges on each card overlap')

  const r = await edit($, { text: world.box.text, cursor: world.box.text.length, start: world.box.text.length, end: world.box.text.length, inputText: '' })
  expect((r.decorations ?? []).map(d => world.box.text.slice(d.start, d.end))).toEqual(['the badges on each card'])
})

test('a guess Haiku lists twice shows once', async ($, on) => {
  const { clock } = desktop(on, 'the header | src/ui/app-header.tsx | src/ui/app-header.tsx | src/ui/page-header.tsx')
  await typeDraft($, clock, 'make the header less cramped')

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.findAll({ type: 'Button', text: /App header/ })).length).toBe(1)
  await ui.unmount()
})

async function typeMore($: Engine, clock: { advance: (ms: number) => Promise<void> }, box: { text: string }, more: string) {
  await edit($, { text: box.text, cursor: box.text.length, start: box.text.length, end: box.text.length, inputText: more })
  await clock.advance(700)
}

async function bandText($: Engine): Promise<string> {
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const texts = (await ui.findAll({ type: 'Text', text: /./ })).map(x => x.text).join(' ')
  const buttons = (await ui.findAll({ type: 'Button', text: /./ })).map(x => x.text).join(' ')
  await ui.unmount()
  return `${texts} ${buttons}`
}

test('a shown phrase stays while its words do, whatever later reads say', async ($, on) => {
  const { clock, world } = desktop(on, HEADER_GUESSES, 'NONE', 'NONE', 'NONE', 'NONE')
  await typeDraft($, clock, 'make the header less cramped')
  for (const more of [' please', ' now', ' thanks', ' ok']) await typeMore($, clock, world.box, more)

  expect(await bandText($)).toContain('the header')
})

test('a dismissed phrase goes and stays gone for the draft', async ($, on) => {
  const { clock, world } = desktop(on, HEADER_GUESSES)
  await typeDraft($, clock, 'make the header less cramped')
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'dismiss:the header' })
  await ui.unmount()
  await typeMore($, clock, world.box, ' please')

  expect(await bandText($)).not.toContain('the header')
})

test('a phrase found later gets a row below the others', async ($, on) => {
  const later = 'the footer | src/ui/page-header.tsx\nthe header | src/ui/app-header.tsx'
  const { clock, world } = desktop(on, HEADER_GUESSES, later)
  await typeDraft($, clock, 'the footer and the header are cramped')
  await typeMore($, clock, world.box, ' now')

  const text = await bandText($)
  expect(text.indexOf('the header')).toBeLessThan(text.indexOf('the footer'))
})

test('a phrase is cut back to its last real word, or dropped', async ($, on) => {
  const reply = 'the header area | src/ui/app-header.tsx\nthe padding in the thing | src/ui/page-header.tsx'
  const { clock, world } = desktop(on, reply)
  await typeDraft($, clock, 'fix the header area and the padding in the thing')

  const r = await edit($, { text: world.box.text, cursor: world.box.text.length, start: world.box.text.length, end: world.box.text.length, inputText: '' })
  expect((r.decorations ?? []).map(d => world.box.text.slice(d.start, d.end))).toEqual(['the header'])
})

test('a picked phrase stays however many reads leave it out', async ($, on) => {
  const { clock, world } = desktop(on, HEADER_GUESSES, 'NONE', 'NONE', 'NONE')
  await typeDraft($, clock, 'make the header less cramped')
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'use:the header:src/ui/app-header.tsx' })
  await ui.unmount()
  await typeMore($, clock, world.box, ' please')
  await typeMore($, clock, world.box, ' now')
  await typeMore($, clock, world.box, ' thanks')

  expect(await bandText($)).toContain('✓ App header')
})

test('a read waits until the word being typed is finished', async ($, on) => {
  const { clock, world } = desktop(on, HEADER_GUESSES)
  await start($)
  await edit($, { text: '', cursor: 0, start: 0, end: 0, inputText: 'make the header less cram' })
  await clock.advance(300)
  expect(world.prompts.length).toBe(0)
  await typeMore($, clock, world.box, 'ped ')
  expect(world.prompts.length).toBe(1)
})

test('every copy of a repeated phrase is highlighted', async ($, on) => {
  const { clock } = desktop(on, HEADER_GUESSES)
  const draft = 'move the header below the header'
  await typeDraft($, clock, draft)

  const r = await edit($, { text: draft, cursor: draft.length, start: draft.length, end: draft.length, inputText: '' })
  expect((r.decorations ?? []).map(d => draft.slice(d.start, d.end))).toEqual(['the header', 'the header'])
})

test('Haiku sees the files the last reply named, never the reply itself', async ($, on) => {
  const { clock, world } = desktop(on, 'NONE')
  await start($)
  await turnComplete($, 'Done. I tightened the padding in src/ui/app-header.tsx so the bar breathes.')
  await edit($, { text: '', cursor: 0, start: 0, end: 0, inputText: 'make the header less cramped' })
  await clock.advance(700)

  expect(world.prompts.at(-1)).toContain('Files the agent just worked on:\nsrc/ui/app-header.tsx')
  expect(world.prompts.at(-1)).not.toContain('breathes')
})

const marked = (r: PromptEditResult, text: string) => (r.decorations ?? []).map(d => text.slice(d.start, d.end))

test('a part the repo has a file for lights up once the next word is typed, before any read', async ($, on) => {
  desktop(on, HEADER_GUESSES)
  await start($)
  const r = await edit($, { text: '', cursor: 0, start: 0, end: 0, inputText: 'make the header less ' })

  expect(marked(r, 'make the header less ')).toEqual(['the header'])
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Button', text: /App header/ })).toBeDefined()
  await ui.unmount()
})

test('a word still being typed never lights up', async ($, on) => {
  desktop(on, HEADER_GUESSES)
  await start($)
  for (const draft of ['make the header', 'make the header ']) {
    const r = await edit($, { text: '', cursor: 0, start: 0, end: 0, inputText: draft })
    expect(marked(r, draft)).toEqual([])
    await $.prompt.submit({ text: draft, wait: false, origin: { kind: 'composer' } })
  }
})

test('a read that leaves out an instant phrase takes it down for the rest of the draft', async ($, on) => {
  const { clock, world } = desktop(on, 'NONE')
  await typeDraft($, clock, 'please make the header bold for now')
  await typeMore($, clock, world.box, ' too')

  const r = await edit($, { text: world.box.text, cursor: 0, start: 0, end: 0, inputText: '' })
  expect(marked(r, world.box.text)).toEqual([])
})

test("Haiku's guesses replace the instant ones", async ($, on) => {
  const { clock } = desktop(on, 'the header | src/ui/page-header.tsx')
  await typeDraft($, clock, 'make the header less cramped')

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.findAll({ type: 'Button', text: /header/ })).map(b => b.text)).toEqual(['Page header'])
  await ui.unmount()
})

test('a run of part words lights up whole, and its file ranks first', async ($, on) => {
  desktop(on, HEADER_GUESSES)
  await start($)
  const r = await edit($, { text: '', cursor: 0, start: 0, end: 0, inputText: 'the header menu is cut off' })

  expect(marked(r, 'the header menu is cut off')).toEqual(['the header menu'])
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.findAll({ type: 'Button', text: /header/i }))[0]?.text).toBe('Header menu')
  await ui.unmount()
})

test('a read that leaves out an instant phrase while its sentence is still going keeps it', async ($, on) => {
  const { clock, world } = desktop(on, 'NONE')
  await typeDraft($, clock, 'make the header on ')

  const r = await edit($, { text: world.box.text, cursor: 0, start: 0, end: 0, inputText: '' })
  expect(marked(r, world.box.text)).toEqual(['the header'])
})

test('a read naming less of an instant phrase keeps its words and takes the read\'s files', async ($, on) => {
  const { clock, world } = desktop(on, 'the header | src/ui/page-header.tsx')
  await typeDraft($, clock, 'the header menu is cut off')

  const r = await edit($, { text: world.box.text, cursor: 0, start: 0, end: 0, inputText: '' })
  expect(marked(r, world.box.text)).toEqual(['the header menu'])
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.findAll({ type: 'Button', text: /header/i })).map(b => b.text)).toEqual(['Page header'])
  await ui.unmount()
})

test('a read of an older draft never adds a second highlight over a newer one', async ($, on) => {
  const { clock, world } = desktop(on, 'the copy | src/ui/copy-button.tsx')
  world.duringRead = async () => {
    await edit($, { text: world.box.text, cursor: world.box.text.length, start: world.box.text.length, end: world.box.text.length, inputText: 'button needs ' })
  }
  await typeDraft($, clock, 'fix the copy ')

  const r = await edit($, { text: world.box.text, cursor: 0, start: 0, end: 0, inputText: '' })
  expect(marked(r, world.box.text)).toEqual(['the copy button'])
})

test('no guess looks chosen until it is picked', async ($, on) => {
  const { clock } = desktop(on, HEADER_GUESSES)
  await typeDraft($, clock, 'make the header less cramped')

  const filled = async (key?: string) => {
    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    if (key) await ui.press({ key })
    const out = (await ui.findAll({ type: 'Button', text: /header/ })).filter(b => b.props.variant === 'primary').map(b => b.text)
    await ui.unmount()
    return out
  }
  expect(await filled()).toEqual([])
  await filled('use:the header:src/ui/page-header.tsx')
  expect(await filled()).toEqual(['✓ Page header'])
})

test('a part word that the next word makes code, or a draft about code, never lights up instantly', async ($, on) => {
  desktop(on, HEADER_GUESSES)
  await start($)
  for (const draft of ['fix the header comment please', 'the header looks off in scripts/build.sh ', 'the header breaks the tests ']) {
    const r = await edit($, { text: '', cursor: 0, start: 0, end: 0, inputText: draft })
    expect(marked(r, draft)).toEqual([])
    await $.prompt.submit({ text: draft, wait: false, origin: { kind: 'composer' } })
  }
})

test('an instant phrase goes dark when the draft turns to code', async ($, on) => {
  desktop(on, HEADER_GUESSES)
  await start($)
  const first = await edit($, { text: '', cursor: 0, start: 0, end: 0, inputText: 'the header is ' })
  expect(marked(first, 'the header is ')).toEqual(['the header'])

  const r = await edit($, { text: 'the header is ', cursor: 14, start: 14, end: 14, inputText: 'set in app.tsx ' })
  expect(marked(r, 'the header is set in app.tsx ')).toEqual([])
})

test('clearing the box forgets its picks, as sending does', async ($, on) => {
  const { clock, world } = desktop(on, HEADER_GUESSES)
  await typeDraft($, clock, 'make the header less cramped')
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'use:the header:src/ui/page-header.tsx' })
  await ui.unmount()

  world.box = { text: '', cursor: 0 }
  await edit($, { text: '', cursor: 0, start: 0, end: 0, inputText: 'the header is too tall' })
  await clock.advance(700)
  await $.prompt.submit({ text: world.box.text, wait: false, origin: { kind: 'composer' } })
  expect(world.sent).toBe('the header is too tall')
})

test('a failed read is tried again on the next keystroke, even for the same draft', async ($, on) => {
  const { clock, world } = desktop(on, 'FAIL', HEADER_GUESSES)
  await typeDraft($, clock, 'make it less cramped please')
  await typeMore($, clock, world.box, ' ')

  expect(world.prompts.length).toBe(2)
})

test('a phrase Haiku names in other words or case is not taken down', async ($, on) => {
  const { clock, world } = desktop(on, 'the header | src/ui/page-header.tsx')
  await typeDraft($, clock, 'The header looks wrong to me')

  const r = await edit($, { text: world.box.text, cursor: 0, start: 0, end: 0, inputText: '' })
  expect(marked(r, world.box.text)).toEqual(['The header'])
})

test('a phrase with "it" in its name stays whole, and one ending in a property word is dropped', async ($, on) => {
  const { clock, world } = desktop(on, 'the how it works page | src/ui/page-header.tsx\nconstricted text width | src/ui/app-header.tsx')
  await typeDraft($, clock, 'remove the github link on the how it works page. remove constricted text width stuff')

  const r = await edit($, { text: world.box.text, cursor: 0, start: 0, end: 0, inputText: '' })
  expect(marked(r, world.box.text)).toEqual(['the how it works page'])
})

test('dismissing a phrase hides it in any case', async ($, on) => {
  desktop(on, 'NONE')
  await start($)
  await edit($, { text: '', cursor: 0, start: 0, end: 0, inputText: 'The header is ' })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'dismiss:The header' })
  await ui.unmount()

  const r = await edit($, { text: 'The header is ', cursor: 14, start: 14, end: 14, inputText: 'odd and the header is ' })
  expect(marked(r, 'The header is odd and the header is ')).toEqual([])
})

test('the instant match stops at punctuation and knows plurals in -es', async ($, on) => {
  desktop(on, 'NONE')
  await start($)
  const across = await edit($, { text: '', cursor: 0, start: 0, end: 0, inputText: 'can you fix that? Header still overlaps' })
  expect(marked(across, 'can you fix that? Header still overlaps')).toEqual([])
  await $.prompt.submit({ text: '', wait: false, origin: { kind: 'composer' } })

  const plural = await edit($, { text: '', cursor: 0, start: 0, end: 0, inputText: 'the switches are ' })
  expect(marked(plural, 'the switches are ')).toEqual(['the switches'])
})

test('a reply that explains itself counts only its lines in the asked-for shape', async ($, on) => {
  const { clock, world } = desktop(on, 'The phrase "the hero" is vague: it could be | anything.\nthe hero | src/ui/app-header.tsx')
  await typeDraft($, clock, 'make the hero look less squished on mobile')

  const r = await edit($, { text: world.box.text, cursor: 0, start: 0, end: 0, inputText: '' })
  expect(marked(r, world.box.text)).toEqual(['the hero'])
})

test('a part lights up while the next word is still being typed, once that word cannot be code', async ($, on) => {
  desktop(on, 'NONE')
  await start($)
  const lit = await edit($, { text: '', cursor: 0, start: 0, end: 0, inputText: 'discuss the copy button pl' })
  expect(marked(lit, 'discuss the copy button pl')).toEqual(['the copy button'])
  await $.prompt.submit({ text: '', wait: false, origin: { kind: 'composer' } })

  const dark = await edit($, { text: '', cursor: 0, start: 0, end: 0, inputText: 'fix the copy button co' })
  expect(marked(dark, 'fix the copy button co')).toEqual([])
})


test('a pick of a named thing sends its name and its file', async ($, on) => {
  const { clock, world } = desktop(on, 'the slug generator | src/submit/slug.ts#slugify | src/submit/slug.ts#makeSlug | src/submit/slug.ts')
  await typeDraft($, clock, 'add a test for the slug generator please')

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.findAll({ type: 'Button', text: /slug/i })).map(b => b.text)).toEqual(['slugify', 'Slug'])
  await ui.press({ key: 'use:the slug generator:src/submit/slug.ts#slugify' })
  await ui.unmount()
  await $.prompt.submit({ text: world.box.text, wait: false, origin: { kind: 'composer' } })

  expect(world.sent).toBe('add a test for the slug generator (`slugify` in @src/submit/slug.ts) please')
})

test('a project too large to send whole sends its folders and the files the draft ranks highest', async ($, on) => {
  const { clock, world } = desktop(on, 'NONE')
  world.files = `${Array.from({ length: 4000 }, (_, i) => `src/area-${i % 40}/unrelated-module-number-${i}.ts`).join('\n')}\n${FILES}`
  await typeDraft($, clock, 'add a test for the slug generator please')

  const sent = world.prompts.at(-1) ?? ''
  expect(sent).toContain("The project's folders:")
  expect(sent).toContain('src/submit/slug.ts: slugify, SLUG_MAX')
  expect(sent).not.toContain('unrelated-module-number-7.ts')
})

test('a phrase Haiku quotes, or runs on into a clause, is cut to the part', async ($, on) => {
  const { clock, world } = desktop(on, '"the hero badge we show on cards" | src/ui/app-header.tsx')
  await typeDraft($, clock, 'the hero badge we show on cards is wrong')

  const r = await edit($, { text: world.box.text, cursor: 0, start: 0, end: 0, inputText: '' })
  expect(marked(r, world.box.text)).toEqual(['the hero badge'])
})
