# thesis

A minimalist text editor, designed for focus.

thesis works through the keyboard — you shouldn't need the mouse. Type `/` to open the command menu, then search, or arrow to what you want and press enter. Your writing saves automatically as you type, stays on your machine, and nothing is ever sent online.

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

## Your writing stays yours

The working draft autosaves to your browser's local storage, and you can open or create a real `.md` file on disk — thesis keeps it in sync as you write. There is no server, no account, and no analytics; nothing leaves your machine.

The sync works in both directions: if another app changes the connected file — an agent replying to comments, another editor — thesis picks the changes up when its window regains focus (or via `/` → *Reload File*), and leaving the window writes pending edits out immediately. If both sides changed at once, thesis asks which version wins rather than silently overwriting either.

## Running it

Plain HTML, CSS, and JavaScript — no build step, no dependencies. Serve the folder with any static server:

```sh
python3 -m http.server
```

then open `http://localhost:8000`. (A server is needed because the editor uses ES modules; opening `index.html` straight from disk won't work.) In a supporting browser it also installs as a standalone app.

## Mac app

[native/](native/) holds a small Swift wrapper that runs thesis in a frameless window of its own — real save dialogs, the Mac's installed fonts, no browser anywhere. See [native/README.md](native/README.md) for details.

```sh
cd native && ./build.sh && open build/thesis.app
```

---

This is a work in progress. Send me a note if you have ideas.
