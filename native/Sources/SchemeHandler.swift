// Serves the bundled web files over thesis://app/… so ES modules load
// with a real origin (file:// would trip over CORS for module imports).

import WebKit

final class SchemeHandler: NSObject, WKURLSchemeHandler {
    private let root: URL
    private let fonts: FontBridge

    init(root: URL, fonts: FontBridge) {
        self.root = root.standardizedFileURL
        self.fonts = fonts
    }

    private static let mimeTypes: [String: String] = [
        "html": "text/html",
        "css": "text/css",
        "js": "text/javascript",
        "json": "application/json",
        "webmanifest": "application/manifest+json",
        "png": "image/png",
        "ico": "image/x-icon",
        "svg": "image/svg+xml",
        "woff2": "font/woff2",
        "md": "text/markdown",
        "txt": "text/plain",
    ]

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else { return }
        var relative = url.path
        if relative.isEmpty || relative == "/" { relative = "/index.html" }

        // Installed-font bridge (see FontBridge.swift)
        if relative == "/__fonts.css" {
            fonts.ensureScanned()
            respond(urlSchemeTask, url: url, status: 200, data: Data(fonts.css.utf8), mime: "text/css")
            return
        }
        if relative.hasPrefix("/__fonts/") {
            fonts.ensureScanned()
            if let id = Int(relative.dropFirst("/__fonts/".count)), fonts.files.indices.contains(id),
               let data = FileManager.default.contents(atPath: fonts.files[id].path) {
                respond(urlSchemeTask, url: url, status: 200, data: data, mime: fonts.mimeType(forFileID: id))
            } else {
                respond(urlSchemeTask, url: url, status: 404, data: Data(), mime: "text/plain")
            }
            return
        }

        let fileURL = root.appendingPathComponent(String(relative.dropFirst())).standardizedFileURL
        guard fileURL.path.hasPrefix(root.path + "/"),
              let data = FileManager.default.contents(atPath: fileURL.path) else {
            respond(urlSchemeTask, url: url, status: 404, data: Data(), mime: "text/plain")
            return
        }
        let mime = Self.mimeTypes[fileURL.pathExtension.lowercased()] ?? "application/octet-stream"
        respond(urlSchemeTask, url: url, status: 200, data: data, mime: mime)
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}

    private func respond(_ task: WKURLSchemeTask, url: URL, status: Int, data: Data, mime: String) {
        let response = HTTPURLResponse(
            url: url, statusCode: status, httpVersion: "HTTP/1.1",
            headerFields: [
                "Content-Type": mime,
                "Content-Length": String(data.count),
                "Cache-Control": "no-cache",
            ]
        )!
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }
}
