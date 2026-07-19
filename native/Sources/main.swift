// thesis — native macOS shell
// A frameless window hosting the web app in a WKWebView.
// The web code is untouched; native-shim.js bridges file open/save to NSOpenPanel/NSSavePanel.

import Cocoa
import WebKit

// With .fullSizeContentView the webview covers the (transparent) titlebar and
// swallows its mouse events, leaving nothing to drag the window by. Treat the
// top strip as a titlebar: drag to move, double-click to zoom.
final class DraggableWebView: WKWebView {
    private let dragStripHeight: CGFloat = 28

    override func mouseDown(with event: NSEvent) {
        if let window, !window.styleMask.contains(.fullScreen) {
            let contentHeight = window.contentView?.bounds.height ?? 0
            if event.locationInWindow.y >= contentHeight - dragStripHeight {
                if event.clickCount == 2 {
                    window.performZoom(nil)
                } else {
                    window.performDrag(with: event)
                }
                return
            }
        }
        super.mouseDown(with: event)
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    let bridge = NativeBridge()
    var titleObservation: NSKeyValueObservation?

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()

        let config = WKWebViewConfiguration()
        let webRoot = Bundle.main.resourceURL!.appendingPathComponent("web", isDirectory: true)
        let fonts = FontBridge()
        bridge.fontFamiliesProvider = { fonts.ensureScanned(); return fonts.families }
        config.setURLSchemeHandler(SchemeHandler(root: webRoot, fonts: fonts), forURLScheme: "thesis")
        config.preferences.isElementFullscreenEnabled = true
        // No system ghost-text completions while writing (Chrome doesn't have them)
        if #available(macOS 14.0, *) { config.allowsInlinePredictions = false }

        let ucc = config.userContentController
        if let shimURL = Bundle.main.url(forResource: "native-shim", withExtension: "js"),
           let shim = try? String(contentsOf: shimURL, encoding: .utf8) {
            ucc.addUserScript(WKUserScript(source: shim, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        ucc.addScriptMessageHandler(bridge, contentWorld: .page, name: "thesis")

        webView = DraggableWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = bridge
        webView.uiDelegate = bridge
        webView.allowsMagnification = true
        webView.underPageBackgroundColor = .windowBackgroundColor
        if #available(macOS 13.3, *) { webView.isInspectable = true }

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1000, height: 720),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered, defer: false
        )
        window.isReleasedWhenClosed = false
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.titlebarSeparatorStyle = .none
        window.tabbingMode = .disallowed
        window.minSize = NSSize(width: 480, height: 360)
        window.title = "thesis"
        window.center()
        window.setFrameAutosaveName("thesis.main")
        window.contentView = webView

        // Keep the (invisible) window title in sync for Mission Control / the app switcher
        titleObservation = webView.observe(\.title, options: [.new]) { [weak self] wv, _ in
            if let title = wv.title, !title.isEmpty { self?.window.title = title }
        }

        webView.load(URLRequest(url: URL(string: "thesis://app/index.html")!))
        window.makeKeyAndOrderFront(nil)
        window.makeFirstResponder(webView)
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool { true }

    // Minimal menu bar: the Edit menu is what makes ⌘C/⌘V/⌘Z work inside the webview.
    private func buildMenu() {
        let main = NSMenu()

        let appItem = NSMenuItem(); main.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About thesis", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Hide thesis", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let hideOthers = NSMenuItem(title: "Hide Others", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(hideOthers)
        appMenu.addItem(withTitle: "Show All", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit thesis", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu

        let fileItem = NSMenuItem(); main.addItem(fileItem)
        let fileMenu = NSMenu(title: "File")
        fileMenu.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        fileItem.submenu = fileMenu

        let editItem = NSMenuItem(); main.addItem(editItem)
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        let redo = NSMenuItem(title: "Redo", action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        editMenu.addItem(redo)
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editMenu.addItem(.separator())

        // WebKit applies the system's autocorrect/smart-substitution settings to
        // contenteditable; these standard toggles let the user turn them off.
        let spellingMenu = NSMenu(title: "Spelling")
        spellingMenu.addItem(withTitle: "Check Spelling While Typing", action: Selector(("toggleContinuousSpellChecking:")), keyEquivalent: "")
        spellingMenu.addItem(withTitle: "Correct Spelling Automatically", action: Selector(("toggleAutomaticSpellingCorrection:")), keyEquivalent: "")
        let spellingItem = NSMenuItem(title: "Spelling", action: nil, keyEquivalent: "")
        editMenu.addItem(spellingItem)
        editMenu.setSubmenu(spellingMenu, for: spellingItem)

        let subsMenu = NSMenu(title: "Substitutions")
        subsMenu.addItem(withTitle: "Smart Quotes", action: Selector(("toggleAutomaticQuoteSubstitution:")), keyEquivalent: "")
        subsMenu.addItem(withTitle: "Smart Dashes", action: Selector(("toggleAutomaticDashSubstitution:")), keyEquivalent: "")
        subsMenu.addItem(withTitle: "Text Replacement", action: Selector(("toggleAutomaticTextReplacement:")), keyEquivalent: "")
        let subsItem = NSMenuItem(title: "Substitutions", action: nil, keyEquivalent: "")
        editMenu.addItem(subsItem)
        editMenu.setSubmenu(subsMenu, for: subsItem)

        editItem.submenu = editMenu

        let viewItem = NSMenuItem(); main.addItem(viewItem)
        let viewMenu = NSMenu(title: "View")
        let fullscreen = NSMenuItem(title: "Enter Full Screen", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        fullscreen.keyEquivalentModifierMask = [.command, .control]
        viewMenu.addItem(fullscreen)
        viewItem.submenu = viewMenu

        let windowItem = NSMenuItem(); main.addItem(windowItem)
        let windowMenu = NSMenu(title: "Window")
        windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        windowItem.submenu = windowMenu
        NSApp.windowsMenu = windowMenu

        NSApp.mainMenu = main
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
