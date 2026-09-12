# thesis — native macOS shell

A minimal Swift/AppKit wrapper that runs the web app (one directory up) in a
frameless `WKWebView` window: traffic lights floating over the canvas, no
browser chrome at all.

The web code is loaded as-is from the app bundle over a custom `thesis://`
scheme. The only native additions:

- **Sources/** — window + menu bar, custom-scheme file serving, and a message
  bridge exposing NSSavePanel/NSOpenPanel, file read/write, and the pasteboard.
- **shim/native-shim.js** — injected only in the wrapper; polyfills the File
  System Access API (`showSaveFilePicker` etc., which WebKit lacks) on top of
  the bridge, so `io.js`/`db.js` run unmodified. Export to Markdown/Word works
  via native download handling.

## Build

```sh
./build.sh          # → build/thesis.app
open build/thesis.app
```

Requires macOS 13 or later and the Xcode command-line tools
(`xcode-select --install`). No other dependencies.

The app is ad-hoc signed, which is all a locally built app needs to run —
notarization only matters if you distribute the built bundle to other
machines.

## Notes

- Storage (autosave, recent files) lives in the app's own WebKit data store,
  separate from any browser. Drafts don't migrate from Chrome automatically.
- File permissions are always "granted" natively, so a remembered file reloads
  immediately at launch (no permission-gesture dance like the web version).
- macOS may ask once for access to Documents/Desktop the first time a
  remembered file in those folders is reopened.
- Rebuild after changing any web file — the bundle is a snapshot.
- `AppIcon-1024.png` is generated, not hand-drawn. To regenerate it:
  `swift icon.swift stroke 1024 AppIcon-1024.png --margin 0.1` — the 0.1 margin
  is what leaves room for the shadow macOS expects around a 1024 master.
  `stroke-dark` is the same mark inverted onto a near-black tile.
