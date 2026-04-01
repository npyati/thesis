# To-Do List

## High Priority
- [x] Fix ephemeral mode flag persisting incorrectly — now cleared on file load, document load, and save
- [x] Fix ephemeral mode activating when loading documents from file — importFromMarkdown now resets flag
- [x] Fix cursor disappearing in center mode — uses retry approach with requestAnimationFrame

## Medium Priority
- [ ] Redesign ephemeral word fading to use time-based approach - words should start fading when written and vanish after ~1 minute
- [x] Fix cursor restoration after word limit modal — no longer shadows global savedSelection

If last thing I was working on when I closed the app was a saved file, either in browser memory or on disk, keep that as the save location when I reopen the app


## Feature Ideas
- [ ] Add writing stage indicator system - color coding or visual indicator for different writing phases (outlining, drafting, fleshing out, editing, polishing, final pass) to help maintain focus on current stage

## Recently Completed
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
