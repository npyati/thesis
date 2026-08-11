// Native side of the JS bridge, plus navigation/download/UI delegates.
// JS calls window.webkit.messageHandlers.thesis.postMessage({cmd, ...}) and
// gets a Promise back (WKScriptMessageHandlerWithReply).

import Cocoa
import WebKit
import UniformTypeIdentifiers

final class NativeBridge: NSObject, WKScriptMessageHandlerWithReply,
                          WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {

    // Set in main.swift; backs the "listFonts" command (font menu)
    var fontFamiliesProvider: (() -> [String])?

    // ── Live file watching ──
    // The web app asks us to watch the currently-open file so outside changes
    // (the margin companion writing comments) arrive without a focus edge.
    // vnode-based (event-driven, no polling); editors and the companion write
    // atomically (write-temp-then-rename), which kills the watched inode, so
    // .delete/.rename re-arm the watch on the same path.
    private var watchSource: DispatchSourceFileSystemObject?
    private var watchPath: String?
    private weak var watchWebView: WKWebView?

    private func stopWatching() {
        watchSource?.cancel()
        watchSource = nil
        watchPath = nil
    }

    private func startWatching(_ path: String, webView: WKWebView?) {
        stopWatching()
        watchPath = path
        if let webView { watchWebView = webView }
        armWatch()
    }

    private func armWatch() {
        guard let path = watchPath else { return }
        let fd = open(path, O_EVTONLY)
        guard fd >= 0 else { return }
        let source = DispatchSource.makeFileSystemObjectSource(
            fileDescriptor: fd, eventMask: [.write, .extend, .delete, .rename], queue: .main)
        source.setEventHandler { [weak self, weak source] in
            guard let self, let source else { return }
            let flags = source.data
            if flags.contains(.delete) || flags.contains(.rename) {
                // Atomic replace: the inode died. Re-arm on the path — the new
                // file usually exists already; one short retry covers the gap.
                source.cancel()
                self.watchSource = nil
                if FileManager.default.fileExists(atPath: path) {
                    self.armWatch()
                    self.notifyFileChanged(path)
                } else {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { [weak self] in
                        guard let self, self.watchPath == path else { return }
                        self.armWatch()
                        self.notifyFileChanged(path)
                    }
                }
            } else {
                self.notifyFileChanged(path)
            }
        }
        source.setCancelHandler { close(fd) }
        source.resume()
        watchSource = source
    }

    private func notifyFileChanged(_ path: String) {
        guard let data = try? JSONSerialization.data(withJSONObject: [path]),
              let json = String(data: data, encoding: .utf8) else { return }
        watchWebView?.evaluateJavaScript(
            "window.__thesisFileDidChange && window.__thesisFileDidChange.apply(null, \(json))",
            completionHandler: nil)
    }

    // ── The margin companion, hosted by the app ──
    // When the open file is invited, the shell runs margin.js (bundled in
    // Resources) attached to that file. Its lifetime is bounded by ours: we
    // hold its stdin, and the child exits the moment that pipe closes — so a
    // crash here can't leave a reader running. Launched through a login shell
    // so the user's PATH (node, claude) applies, as it would in a terminal.
    private var marginProcess: Process?
    private var marginStdin: Pipe?
    private var marginFilePath: String?
    private var marginModel: String?

    private func shellQuoted(_ s: String) -> String {
        "'" + s.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }

    private func notifyMarginState(_ state: String) {
        DispatchQueue.main.async { [weak self] in
            self?.watchWebView?.evaluateJavaScript(
                "window.__thesisMarginState && window.__thesisMarginState('\(state)')",
                completionHandler: nil)
        }
    }

    func stopMarginProcess() {
        marginStdin?.fileHandleForWriting.closeFile()   // child exits on stdin close
        marginProcess?.terminate()                      // belt and braces
        marginProcess = nil
        marginStdin = nil
        marginFilePath = nil
        marginModel = nil
    }

    private func startMarginProcess(for filePath: String, model: String?) {
        // A model change is a different reader — restart rather than leave the
        // old companion attached.
        if let p = marginProcess, p.isRunning, marginFilePath == filePath, marginModel == model { return }
        stopMarginProcess()
        marginModel = model
        guard let marginJS = Bundle.main.resourceURL?
                .appendingPathComponent("margin/margin.js").path,
              FileManager.default.fileExists(atPath: marginJS) else {
            NSLog("thesis: margin.js not bundled — companion unavailable")
            return
        }
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/bin/zsh")
        var command = "exec node \(shellQuoted(marginJS)) --attach \(shellQuoted(filePath))"
        if let model, !model.isEmpty { command += " --model \(shellQuoted(model))" }
        proc.arguments = ["-lc", command]
        let stdin = Pipe()
        let output = Pipe()
        proc.standardInput = stdin
        proc.standardOutput = output
        proc.standardError = output
        output.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty, let text = String(data: data, encoding: .utf8) else { return }
            // State markers drive the palette's "Claude is reading…" line;
            // everything else goes to Console for debugging. One chunk can
            // carry several markers (checking → reading in the same read), so
            // the last one in the chunk is the state that actually holds.
            let markers = text.split(separator: "\n")
                .compactMap { line -> String? in
                    guard let r = line.range(of: "@@margin ") else { return nil }
                    let state = line[r.upperBound...].trimmingCharacters(in: .whitespaces)
                    return ["reading", "checking", "idle"].contains(state) ? state : nil
                }
            if let state = markers.last { self?.notifyMarginState(state) }
            let plain = text.split(separator: "\n")
                .filter { !$0.contains("@@margin") }
                .joined(separator: "\n")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if !plain.isEmpty { NSLog("thesis-margin: %@", plain) }
        }
        proc.terminationHandler = { [weak self] _ in
            output.fileHandleForReading.readabilityHandler = nil
            self?.notifyMarginState("idle")
            DispatchQueue.main.async {
                guard let self, self.marginProcess === proc else { return }
                self.marginProcess = nil
                self.marginStdin = nil
                self.marginFilePath = nil
            }
        }
        do {
            try proc.run()
            marginProcess = proc
            marginStdin = stdin
            marginFilePath = filePath
            NSLog("thesis: margin attached to %@", filePath)
        } catch {
            NSLog("thesis: failed to start margin: %@", error.localizedDescription)
        }
    }

    // Fired when the main frame finishes loading — Finder-opened files queue
    // behind this (main.swift)
    var onPageLoaded: (() -> Void)?

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        onPageLoaded?()
    }

    private var markdownTypes: [UTType] {
        var types = ["md", "markdown"].compactMap { UTType(filenameExtension: $0) }
        if types.isEmpty { types = [.plainText] }
        return types
    }

    // MARK: - Message bridge

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard let body = message.body as? [String: Any], let cmd = body["cmd"] as? String else {
            replyHandler(nil, "malformed message")
            return
        }

        switch cmd {
        case "savePanel":
            let panel = NSSavePanel()
            panel.allowedContentTypes = markdownTypes
            panel.allowsOtherFileTypes = true
            panel.canCreateDirectories = true
            panel.isExtensionHidden = false
            panel.nameFieldStringValue = body["suggestedName"] as? String ?? "document.md"
            if panel.runModal() == .OK, let url = panel.url {
                replyHandler(["path": url.path, "name": url.lastPathComponent], nil)
            } else {
                replyHandler([:], nil) // cancelled — JS turns this into AbortError
            }

        case "openPanel":
            let panel = NSOpenPanel()
            panel.allowedContentTypes = markdownTypes
            panel.allowsMultipleSelection = false
            panel.canChooseDirectories = false
            if panel.runModal() == .OK, let url = panel.urls.first {
                replyHandler(["path": url.path, "name": url.lastPathComponent], nil)
            } else {
                replyHandler([:], nil)
            }

        case "writeFile":
            guard let path = body["path"] as? String, let content = body["content"] as? String else {
                replyHandler(nil, "writeFile: missing path or content")
                return
            }
            do {
                try content.write(toFile: path, atomically: true, encoding: .utf8)
                replyHandler(["ok": true], nil)
            } catch {
                replyHandler(nil, "writeFile failed: \(error.localizedDescription)")
            }

        case "readFile":
            guard let path = body["path"] as? String else {
                replyHandler(nil, "readFile: missing path")
                return
            }
            do {
                let content = try String(contentsOfFile: path, encoding: .utf8)
                replyHandler(["content": content, "name": (path as NSString).lastPathComponent], nil)
            } catch {
                replyHandler(nil, "readFile failed: \(error.localizedDescription)")
            }

        case "copyText":
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(body["text"] as? String ?? "", forType: .string)
            replyHandler(["ok": true], nil)

        case "listFonts":
            replyHandler(["families": fontFamiliesProvider?() ?? []], nil)

        // The web app's fullscreen toggle. WKWebView's element fullscreen
        // reparents the content and leaves a stale layout viewport on exit
        // (resizes stop reflowing) — real window fullscreen instead.
        case "toggleFullscreen":
            (message.webView?.window ?? NSApp.mainWindow)?.toggleFullScreen(nil)
            replyHandler(["ok": true], nil)

        case "watchFile":
            guard let path = body["path"] as? String else {
                replyHandler(nil, "watchFile: missing path")
                return
            }
            startWatching(path, webView: message.webView)
            replyHandler(["ok": true], nil)

        case "unwatchFile":
            stopWatching()
            replyHandler(["ok": true], nil)

        case "startMargin":
            guard let path = body["path"] as? String else {
                replyHandler(nil, "startMargin: missing path")
                return
            }
            if let wv = message.webView { watchWebView = wv }
            startMarginProcess(for: path, model: body["model"] as? String)
            replyHandler(["ok": true], nil)

        case "stopMargin":
            stopMarginProcess()
            replyHandler(["ok": true], nil)

        case "log":
            NSLog("thesis-web: %@", body["message"] as? String ?? "")
            replyHandler(["ok": true], nil)

        default:
            replyHandler(nil, "unknown command: \(cmd)")
        }
    }

    // MARK: - Navigation: keep the app inside its scheme, hand everything else to the system

    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if navigationAction.shouldPerformDownload {
            decisionHandler(.download)
            return
        }
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }
        switch url.scheme {
        case "thesis", "about", "blob", "data":
            decisionHandler(.allow)
        default:
            NSWorkspace.shared.open(url) // http(s), mailto → default browser / mail
            decisionHandler(.cancel)
        }
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    // target=_blank etc. — open externally instead of spawning webviews
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url { NSWorkspace.shared.open(url) }
        return nil
    }

    // MARK: - Downloads (Export as Markdown / Word use blob URLs + <a download>)

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,
                  suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let panel = NSSavePanel()
        panel.canCreateDirectories = true
        panel.nameFieldStringValue = suggestedFilename
        if panel.runModal() == .OK, let url = panel.url {
            try? FileManager.default.removeItem(at: url) // WKDownload refuses to overwrite
            completionHandler(url)
        } else {
            completionHandler(nil)
        }
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        NSLog("thesis: download failed: %@", error.localizedDescription)
    }

    // MARK: - <input type="file"> (unused fallback path, supported anyway)

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        completionHandler(panel.runModal() == .OK ? panel.urls : nil)
    }
}
