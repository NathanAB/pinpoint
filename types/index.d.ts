export type Guess = { name: string; path: string; symbol?: string }

export type Phrase = { text: string; guesses: readonly Guess[]; isInstant?: boolean }
