# To-Do List

## High Priority
- [ ] Fix ephemeral word fading feature - currently disabled (was breaking typing - couldn't add spaces after 6th word)
- [ ] Fix modal search box - can't type in modal search boxes (new issue)
- [ ] Fix cursor disappearing in center mode - attempted fix with synchronous restoration, status unclear

## Lower Priority
- [ ] Fix cursor restoration after word limit modal (currently loses cursor position)

## Completed
- [x] Fix command modal positioning on empty lines - now uses getClientRects() for wrapped text
- [x] Fix select all and delete in ephemeral mode - fixed beforeinput handler to allow deletions with selection
- [x] Fix center mode not working after deleting all content - added spacer check in input handler
- [x] Fix center mode not working in new ephemeral documents - added spacer logic to createNewEphemeralDocument
- [x] Fix ephemeral word limit input visibility in light mode - added proper CSS styling
