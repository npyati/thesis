# To-Do List

## High Priority
- [x] Fix ephemeral mode flag persisting incorrectly — now cleared on file load, document load, and save
- [x] Fix ephemeral mode activating when loading documents from file — importFromMarkdown now resets flag
- [x] Fix cursor disappearing in center mode — uses retry approach with requestAnimationFrame

## Medium Priority
- [x] Fix cursor restoration after word limit modal — no longer shadows global savedSelection
- [x] If last thing I was working on when I closed the app was a file on disk, keep that as the save location when I reopen the app — file handle now survives restarts (permission is requested on the first click/keystroke instead of failing silently at load)

## Feature Ideas (backlog)
- [ ] Session word delta — show words written this session ("+412") next to the word count. No timers, no pace tracking; just the count.
- [ ] Retype mode — show the previous draft dimmed/read-only while retyping it fresh (typewriter-era revision technique). Exploring the concept first.

## Design principles (decided)
- No timing elements anywhere — clocks and countdowns create stress; word-count-based mechanics only (this is why ephemeral mode uses a word limit, and why time-based fading was rejected)
- Ephemeral means no record — no compost/recovery files for faded words; the point is writing without a trace

## Recently Completed
- [x] Stage presets: Draft (forward-only, focus, no spellcheck), Revise (unlocked), Polish (spellcheck on) — manual mode toggles clear the stage label
- [x] Reliable undo/redo (Cmd+Z / Cmd+Shift+Z) — snapshot-based, covers block operations native undo couldn't; blocked in forward-only mode
- [x] Find (Cmd+F) — highlights via CSS Custom Highlight API, Enter/arrows to step through matches
- [x] Open Recent — last 8 file handles stored in IndexedDB, reopen from the palette
- [x] Save-state indicator dot (synced / saving / detached) + alert when the file connection is lost
- [x] Print / save as PDF with a print stylesheet
- [x] Toggle Spellcheck command; pasted plain-text markdown converts to blocks
- [x] Files are now the permanent home for documents: removed the in-browser document library (save/load/delete modals, doc IDs, URL routing); localStorage keeps only the autosaved working draft
- [x] Inline formatting (bold/italic/strikethrough) now survives file save/load, Enter splits, Backspace merges, and copy — markdown conversion is lossless both directions
- [x] Markdown loaded from files is HTML-escaped (a crafted .md file could previously inject markup into the editor)
- [x] Center-mode spacers no longer leak into saved content
- [x] Saving an ephemeral document only makes it permanent if the save actually succeeds
- [x] Command palette no longer renders file names as HTML; corrupt localStorage entries no longer break startup or the palette
- [x] Service worker: offline fallback no longer errors on uncached requests; non-GET requests skipped; cache bumped to v3
- [x] Pinch-zoom re-enabled (accessibility)
- [x] Deleted the unused 6,613-line script.js monolith (superseded by js/ modules)
- [x] Full modular rewrite: split 6600-line script.js into 8 ES modules (state, blocks, modals, modes, formatting, io, db, utils)
- [x] Replaced deprecated document.execCommand with DOM range manipulation for bold/italic/strikethrough
- [x] Added HTML sanitization for content loaded from localStorage (XSS protection)
- [x] Debounced word count and focus mode updates for better performance
- [x] Added ARIA labels, roles, and focus trapping to all modals for accessibility
- [x] Extracted reusable modal system (openModal/closeModal/attachModalKeyboardNav) eliminating ~500 lines of duplication
- [x] Fixed service worker to use network-first strategy for HTML/JS (cache-first caused stale content)
- [x] Centralized global state into state.js module for traceable mutations
- [x] Added localStorage quota error handling
- [x] Fix modal search box typing and select-all cancellation - added safety checks to selectionchange handler
- [x] Fix command modal positioning on empty lines - now uses getClientRects() for wrapped text
- [x] Fix select all and delete in ephemeral mode - fixed beforeinput handler to allow deletions with selection
- [x] Fix center mode not working after deleting all content - added spacer check in input handler
- [x] Fix center mode not working in new ephemeral documents - added spacer logic to createNewEphemeralDocument
- [x] Fix ephemeral word limit input visibility in light mode - added proper CSS styling
