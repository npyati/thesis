# margin

A reader in the margin. When an **invited** file settles with enough new
writing — or you address Claude in a comment thread — it runs one reading
pass through Claude CLI and writes any notes back into the file's comment
block. thesis shows them the moment the file changes, even while the window
stays focused.

**You normally never run this by hand.** thesis.app hosts it: when the open
file is invited (`/` → Invite Claude), the shell attaches a companion to that
file; revoke, close the file, or quit and it's gone. The companion holds a
pipe from the app and exits the instant it closes, so it cannot outlive the
app — not even a crash leaves a reader running.

The command-line forms exist for the web version of thesis and for reading a
whole folder at once:

```
node margin.js ~/writing/cases              # watch a folder
node margin.js --once ~/writing/piece.md    # one explicit pass, then exit
node margin.js --attach ~/writing/piece.md  # what thesis.app runs internally
```

Flags: `--threshold 100` (changed words that make a sweep worth it),
`--model <m>`, `--verbose`, `--dry-run`, `--no-lookups` (never reach the web).

## Consent

File-level, explicit, and stored in the file itself: thesis's **Invite
Claude** command writes a `thesis:margin` block, so consent travels with the
document when it moves between folders. The companion reads nothing unmarked,
and only invited files are ever sent to Anthropic (under your own Claude Code
login — no keys, no accounts). Revoke with the same command, or kill the
process; `--once` on a specific file is itself the invitation.

The reading pass has no tools whatsoever — it cannot read a file, run a
command, or reach the network. The one thing that can reach the network is the
lookup pass (below), and it never sees the document: it receives the reader's
questions and nothing else. Your prose does not leave the machine except to
Anthropic, as before. A question does disclose what the piece is *about* — if
that is one disclosure too many, `--no-lookups` turns the second tier off and
the companion goes back to being sealed.

## Checking a fact

A pass that meets a claim it can't settle from the text — a figure, a date, a
quotation, an attribution — may ask for it to be checked instead of guessing.
Those questions (at most three, and most passes ask none) go out to a second
pass that has web search and fetch and **does not have the document**. What it
finds comes back, the piece is read again with the answers in hand, and any
note that results is still a note in the margin voice: the question, now
carrying its evidence and a link. A fact that checks out produces silence, not
a "confirmed" reply.

The cost is real — a checked pass runs the reader twice — which is why the bar
is a load-bearing claim you actually doubt, not curiosity.

## When it reads

No timers, no schedules. Passes are triggered by content:

- **You wrote enough.** thesis writes the file ~1s after you pause; the
  companion diffs against the last pass and reads once the changed words cross
  the threshold. Sitting and looking at the app counts — no need to switch
  away.
- **You asked.** A thread where you spoke last and Claude is involved (his
  note, or your `@claude`) is answered on the next write event, regardless of
  the threshold. Threads left waiting while the companion was off are answered
  when it starts.
- **First read.** Inviting a file is itself the seam; the first pass reads
  everything.

The only clockwork is a short debounce on file events — hygiene inside the
watcher, not a schedule.

## What a pass may do

Everything follows [PROTOCOL.md](PROTOCOL.md): answer first, comment only what
clears the necessity bar, never edit prose unbidden. Mechanical slips arrive
as comments carrying a preloaded `fix` — thesis shows a **Fix** button; the
press is the bidding. Explicit requests ("tighten this") are edited, described
in a reply, and resolved. Everything is re-validated against the file as it is
at write time; anything the writer typed past is dropped, never guessed at.

## Files it keeps

- `~/.thesis-margin/memory.md` — how you like to be read, handed to every pass
  on every file. Yours to edit; Claude reads it but never writes it.
- `~/.thesis-margin/state.json` — last-pass snapshots for the diff.
- Per-file memory needs no file of its own: it *is* the comment history,
  riding in the document.
