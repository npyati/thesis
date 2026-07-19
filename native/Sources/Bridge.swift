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
