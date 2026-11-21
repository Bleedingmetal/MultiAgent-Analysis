# Agent Evaluation style guide

How every screen in this app should look, read and behave. It follows the tasteskill app-screen
rules (`.claude/skills/design-taste-frontend/references/app-screens.md`) and the calls we have made on
this app. Run `node .claude/skills/design-taste-frontend/scripts/inspect.mjs --app` before shipping a
screen.

## 1. The idea

Calm, Apple-like screens. Each screen answers one question, and its biggest element is the answer.
Everything else is quieter, or it goes.

- **Glance, then click for more.** At a glance, someone who has never seen the app understands every
  word on screen. Anything deeper (definitions, breakdowns, raw numbers, traces) is one obvious click
  away: the row opens its run, the number opens its breakdown. Never put information on screen that
  needs decoding ("7 errored, 3 of 10 graded"); say it plainly ("7 of 10 questions didn't run") or
  move it behind the click.
- **One question per screen.** Overview: which architecture wins? A run: how did it do? Name the
  question before building, and size the answer to lead.
- **Low density.** If something isn't needed to answer the question or take the next step, it moves
  to a tooltip, a side panel or "See more". When in doubt, cut it.
- **Flow, not boxes.** Attention runs top-left to bottom-right: answer, evidence, detail. Group with
  space and one hairline, not a card inside a card inside a card.

## 2. Words

**No subtitles.** A grey line under a label, value or name is a tell of generated UI. It stays only if
it carries information the reader acts on and can't get anywhere else on the screen.

| Keep | Cut |
| --- | --- |
| A projection while running: "about $1.63 when done" | A formula: "cost ÷ correct answers" |
| The p95 next to an average: "slowest tenth 3m 37s" | A restatement: "All-Pass: 6 of 11" under "All criteria met 55%" |
| A 95% range under a rate | A definition: "of answers with a program" |
| An error count, only when it isn't 0 | Reassurance: "every conversation reached the grader" |

- **Definitions go in tooltips** (hover on the label) or in "How this works", never on the page.
- **Name things by what they are, in plain words.** "Accepts either", not "disputed label", when
  the dataset gives more than one valid answer. "Partial credit", not "score".
- **Headings are nouns**, in sentence case. No greetings, no taglines.
- **No subtitles under page or section titles.**
- **Sentences on screen:** one at most per block, and it states a finding ("Single agent leads; the
  intervals overlap, so the order is not settled"), not what the block is.

## 3. Rows and lists

- **One primary line** (the name) and **at most one quiet secondary line.**
- The secondary line is the architecture and its model, plus a plain reason if the row isn't ranked.
  Examples: `Single agent · claude-haiku-5-5`, or
  `Prompt chain · claude-haiku-5-5 · not ranked, 2 of 15 questions didn't run`. No internal words
  like "baseline" or "partial".
- **No stacked pills.** One status mark per row (the ✓/✗ dot, or one word). Pills are for a state
  that needs attention, not for labels.
- **No dotted underlines** to hint at tooltips. The tooltip shows on hover, and `cursor-help` is
  enough.
- **Long text truncates to one line** with an ellipsis and the full text in `title`. Chips and pills
  never wrap.

## 4. Numbers

- **Figures use Plex Mono** (`font-data`), right-aligned in columns, with fixed decimals per column.
- **The answer figure leads:** 44px on a run's headline, 26–32px in a strip, labels at 12–14px grey.
  Nothing else on the screen is as big.
- **Decimals:** headline rates 1 decimal (64.7%), secondary rates 0 (55%), money to 2 significant
  figures past the first non-zero ($0.0005, $0.098, $1.87).
- **Units are a grey suffix**, not a separate line.
- **FAB headlines are Partial Credit.** Every other benchmark leads with pass rate. Never show both
  as equals; the secondary one sits beside the headline, smaller.

## 5. Colour

Tokens live in `frontend/app/globals.css`. Use tokens, not hex values, in new code.

| Role | Token | Use |
| --- | --- | --- |
| Ink | `mm-dark` #001735 | Text and values |
| Quiet | `muted-foreground` | Labels and secondary text |
| Accent | `mm-charge` #0265ff | The leading bar, links, one primary button. Nowhere else. |
| Pass | `mm-green` (text #2f7a1f) | Pass marks only |
| Fail | `mm-orange` (text #b34800) | Fail marks only |
| Neutral data | `muted-foreground` at 45% | Every bar that isn't the lead |

- **One accent per chart:** the leader in `mm-charge`, everything else grey. No rainbow, no colour
  per configuration.
- **Status tints are pale backgrounds with dark text of the same hue.** No saturated chips with
  white text.
- **Yellow is reserved for a real warning** (a repaired question, a corrected answer key). It is not
  for labels.
- **Every screen works in light and dark.** Check both before shipping.

## 6. Surfaces and layout

- **Panels:** white (`--card`) on the blue-grey ground, one soft radius (16px), no border and no
  shadow. Nested radii step down 16 → 10 → pill. Never a card in a card in a card.
- **Widths line up.** Everything in a column shares one left edge and one right edge. A card
  narrower than the text under it is a bug.
- **No orphans.** A grid of N items picks its column count from N: 1 is a strip, 2 a pair, 3 across,
  4 as 2×2 or 4 across. Never 3 + 1.
- **Hairlines (1px, `border`) separate rows.** No zebra stripes and no header bands.

## 7. Interaction

- **Everything clickable shows a hand cursor** (`cursor-pointer`) and a hover state.
- **Focus rings are visible:** `focus-visible:ring-2` in `mm-charge`/40.
- **Motion is short (≤ 0.5s), eased and purposeful:** bars grow, panels slide. Respect
  `prefers-reduced-motion`.
- **Toggles show their state** (`aria-pressed`). Buttons say what they do ("Run again", not "Submit").

## 8. Before shipping a screen

1. What is this screen's one question, and is its answer the biggest thing on it?
2. Read every grey line. Would anyone act on it? If not, delete it.
3. Does any row have more than one secondary line, or more than one pill?
4. Do all widths line up, and is there no orphan in any grid?
5. Is every clickable element a hand cursor?
6. Is the accent on one thing per chart or section?
7. Does it work in dark mode and at phone width?
8. Does `inspect.mjs --app` pass?
