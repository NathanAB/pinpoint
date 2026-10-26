# pinpoint

A Claude Code mod that helps you say exactly which part of your project you mean.

You type "add a test for the slug generator". Before you send it, "the slug generator" lights up in the prompt box, and a row above the box lists what it most likely means: `slugify`, `Slug`. Pick one and the message goes out as "add a test for the slug generator (`slugify` in @src/submit/slug.ts)", so the agent starts in the right place instead of searching.

It works for any part of a project you'd name loosely: a page or component ("the header"), a feature, an endpoint or route, a job or script, a data type or table, or a concept the code gives a name ("the render drain", "the rate limit").

## How it works

- **When a session starts**, it lists your project in the background: the source files `git ls-files` knows (tests, builds and vendored code left out), and the names each file defines (exports in JS and TS, top-level definitions in Python, Go, Rust, Ruby and others).
- **At each word boundary**, Haiku reads your draft with that list and replies with the vague phrases and up to three targets each: a file, or one named thing in it. Thinking is off, so a read takes one to two seconds.
- **Common UI words light up instantly.** "the header", "the install buttons" and similar part names that match a component file light up as soon as you start the next word, before Haiku has read anything. They stay dark when the next word makes it code ("the header comment"). Haiku's read then confirms them, or takes them down.
- **A shown phrase stays put** while its words are in the draft. Later reads can only grow it ("the search" to "the search box"). Rows keep the order they first showed in.
- **Picking** a guess marks the phrase green. Nothing in your draft changes until you send, when each pick lands after its phrase as `(@path)` or ``(`Name` in @path)``.
- **Click into a highlighted phrase** to open a drawer with the full paths. **✕** dismisses a phrase for the rest of the draft. Clearing the box (Esc) starts over, as sending does.

It leaves alone questions about the agent itself, project-wide tooling ("the tests", "the README", "CI"), generic words ("the function", "the bug"), and anything you already named exactly (an @path, a file name, or a name as the code spells it).

## Large projects

A project whose list fits about 24k tokens is sent whole, once, and cached. A larger one is sent as its folder tree plus the files and names that share words with your draft, ranked within a 6k-token budget, the way [Aider's repo map](https://aider.chat/docs/repomap.html) fits a budget. On a 1,000-file project the list builds in about half a second and ranking takes under a millisecond a read.

## Install

pinpoint is waiting for review on [statuslin.es](https://statuslin.es/mods), which will list the install command once it's approved. To try it before then, clone this repo and start Claude Code with it:

```bash
claude --plugin-dir path/to/pinpoint
```

Works in the terminal and in Claude Desktop. Reads use your signed-in Claude Code account, and fall back to the engine's own model call when that isn't available.

## Privacy

Each read sends Haiku your draft, your project's file paths, the names those files define, and the paths the agent's last reply mentioned. File contents never leave your machine.

## Known limits

- In Claude Desktop, a phrase only Haiku found shows in the row above the box right away, but is underlined in the box on your next keystroke: Desktop repaints the box's highlights only when it changes.
- When the same phrase appears twice in one draft, a pick lands after the first one.

## License

MIT
