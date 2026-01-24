# To-Do List

## High Priority
- [ ] Fix ephemeral mode flag persisting incorrectly - should only be active in ephemeral documents, not regular documents
- [ ] Fix ephemeral mode activating when loading documents from file - should never be on for loaded documents
- [ ] Fix cursor disappearing in center mode - attempted fix with synchronous restoration, status unclear

## Medium Priority
- [ ] Redesign ephemeral word fading to use time-based approach - words should start fading when written and vanish after ~1 minute
- [ ] Fix cursor restoration after word limit modal - currently loses cursor position

If last thing I was working on when I closed the app was a saved file, either in browser memory or on disk, keep that as the save location when I reopen the app


## Feature Ideas
- [ ] Add writing stage indicator system - color coding or visual indicator for different writing phases (outlining, drafting, fleshing out, editing, polishing, final pass) to help maintain focus on current stage

## Recently Completed
- [x] Fix modal search box typing and select-all cancellation - added safety checks to selectionchange handler
- [x] Fix command modal positioning on empty lines - now uses getClientRects() for wrapped text
- [x] Fix select all and delete in ephemeral mode - fixed beforeinput handler to allow deletions with selection
- [x] Fix center mode not working after deleting all content - added spacer check in input handler
- [x] Fix center mode not working in new ephemeral documents - added spacer logic to createNewEphemeralDocument
- [x] Fix ephemeral word limit input visibility in light mode - added proper CSS styling