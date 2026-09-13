# thesis

A minimalist writing app, designed for focus.

thesis works through the keyboard — you shouldn't need the mouse. Type `/` to open the command menu, then search, or arrow to what you want and press enter. Your writing saves automatically as you type, stays on your machine, and nothing is sent online — unless you explicitly invite Claude to read a file ([see below](#claude-in-the-margin)).

## Ways to write

- **Stages** — Draft, Revise, and Polish set the editor up for each phase of writing: Draft is forward-only with focus, just to get words out; Revise unlocks editing and shows the whole document; Polish turns on spellcheck for the final pass.
- **Forward-only** — type like a typewriter, with no going back.
- **Blind** — write without seeing anything; a running word count keeps you company.
- **Ephemeral** — the oldest words dissolve as new ones arrive, leaving no record.
- **Retype** — redraft by retyping your old draft one paragraph at a time.
- **Focus** — fade the paragraphs around the one you're on (Fade), blur everything but the line you're writing (Fog), or keep the active line centered.

## Everything else

Headings, lists, and quotes, with markdown shortcuts (`-`, `1.`, `>`). Bold, italic, and strikethrough — type `xxxx` to strike the last word while drafting, then delete every struck word at once when you revise. Find, jump to heading, fonts, dark mode, page or canvas view, export to Markdown or Word. All of it lives in the `/` menu. There isn't much here, just what's necessary.

## Comments

Select text and press `⌘⌥M` (or `/` → *Add Comment*) to leave a margin note. Notes anchor to their quoted text and follow it as you edit; reply, edit, resolve, or delete from the card. Turn on *Quick Comment Mode* (`/` menu) and commenting gets even faster: select text and just start typing — the keystrokes become the note, and typing never replaces a selection. They're stored non-destructively at the end of the `.md` file as a single HTML-comment block — the prose is never touched, the file still renders cleanly anywhere, and the same notes open in any tool that speaks the format. Ephemeral documents take no comments; they leave no record.

## Claude in the margin

Optional, off by default, and per file. `/` → *Invite Claude* and a reader joins you in the margin: it reads when you've written enough to be worth reading, answers threads you address to `@claude`, and leaves notes as ordinary margin comments you can reply to or resolve. It never edits your prose unless a thread asks it to. `/` → *Claude Model* picks which model reads; *Claude Brief* tells it what you're trying to do.

It runs on your own machine, on your own tools:

- **[Claude Code](https://claude.com/claude-code)**, installed and signed in (run `claude` once). Passes go out under your own login — no API keys, no account here.
- **Node 18 or newer**, which runs the companion.

If either is missing, thesis says so when you invite a file rather than sitting there quietly doing nothing. Neither is needed for anything else in the app.

Consent is file-level and lives *in the file* — inviting writes a marker into the `.md` itself, so it travels with the document and nothing unmarked is ever read. Revoke with the same command. The reading pass has no tools at all: it cannot run a command, open another file, or reach the network. Invited files (and their comments) do go to Anthropic; nothing else does. [margin/README.md](margin/README.md) is the full account, including the narrow second pass that can check a fact and the `--no-lookups` flag that turns it off.

## Your writing stays yours

The working draft autosaves to the app's own local storage, and you can open or create a real `.md` file on disk — thesis keeps it in sync as you write. There is no server, no account, and no analytics, and the app itself talks to nothing. The one exception is a file you invite Claude to read, which is described above and off by default.

The sync works in both directions: if another app changes the connected file — an agent replying to comments, another editor — thesis picks the changes up when its window regains focus (or via `/` → *Reload File*), and leaving the window writes pending edits out immediately. If both sides changed at once, thesis asks which version wins rather than silently overwriting either.

## Running it

thesis is a Mac app: [native/](native/) holds a small Swift shell that runs the editor in a frameless window of its own — real save dialogs, the Mac's installed fonts, no browser anywhere. You build it yourself; there is no download.

You need **macOS 13 or later** and the **Xcode command-line tools** (`xcode-select --install`). Nothing else — no package manager, no dependencies to fetch.

```sh
git clone https://github.com/npyati/thesis.git
cd thesis/native && ./build.sh && open build/thesis.app
```

That produces `native/build/thesis.app`, which you can drag to /Applications. It's ad-hoc signed, which is all a locally built app needs; rebuild after changing any web file, since the bundle is a snapshot. See [native/README.md](native/README.md) for what the shell actually does.

The editor itself is plain HTML, CSS, and JavaScript — no build step, no dependencies — so for development it also runs in a browser: serve the folder with any static server (`python3 -m http.server`) and open `http://localhost:8000`. (A server is needed because the editor uses ES modules.) The browser build has no native save dialogs and cannot host the margin companion; run it from the command line instead ([margin/README.md](margin/README.md)).

## License

MIT — see [LICENSE](LICENSE).

---

This is a work in progress. Ideas and bug reports are welcome in [Issues](https://github.com/npyati/thesis/issues).
