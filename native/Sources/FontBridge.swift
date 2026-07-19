// The sandboxed WebContent process can't read user-installed fonts
// (~/Library/Fonts), so font-family names silently fall back. The host app
// *can* read them — so we scan the font directories, generate @font-face CSS
// served over thesis:// (see SchemeHandler), and expose the family list to
// the font menu. Installed fonts become ordinary web fonts.

import Foundation
import CoreText

final class FontBridge {
    private(set) var files: [URL] = []
    private(set) var css: String = ""
    private(set) var families: [String] = []
    private var scanned = false

    // Everything runs on the main thread (scheme handler + message bridge),
    // so a plain flag is enough. Scan is deferred off the launch path.
    func ensureScanned() {
        guard !scanned else { return }
        scanned = true
        scan()
    }

    func mimeType(forFileID id: Int) -> String {
        files[id].pathExtension.lowercased() == "otf" ? "font/otf" : "font/ttf"
    }

    private func scan() {
        let dirs = [
            FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Fonts"),
            URL(fileURLWithPath: "/Library/Fonts"),
        ]

        var rules: [String] = []
        var familySet = Set<String>()
        var seenFace = Set<String>()

        for dir in dirs {
            guard let enumerator = FileManager.default.enumerator(at: dir, includingPropertiesForKeys: nil) else { continue }
            for case let url as URL in enumerator {
                let ext = url.pathExtension.lowercased()
                // .ttc/.dfont excluded: CSS can't address a face inside a collection
                guard ext == "ttf" || ext == "otf" else { continue }
                guard let descriptors = CTFontManagerCreateFontDescriptorsFromURL(url as CFURL) as? [CTFontDescriptor] else { continue }

                let fileID = files.count
                var fileUsed = false
                for descriptor in descriptors {
                    guard let family = CTFontDescriptorCopyAttribute(descriptor, kCTFontFamilyNameAttribute) as? String else { continue }
                    var weight = 400
                    var italic = false
                    if let traits = CTFontDescriptorCopyAttribute(descriptor, kCTFontTraitsAttribute) as? [CFString: Any] {
                        if let w = traits[kCTFontWeightTrait] as? NSNumber { weight = Self.cssWeight(w.doubleValue) }
                        if let sym = traits[kCTFontSymbolicTrait] as? NSNumber {
                            italic = sym.uint32Value & CTFontSymbolicTraits.traitItalic.rawValue != 0
                        }
                    }

                    let key = "\(family.lowercased())|\(weight)|\(italic)"
                    guard !seenFace.contains(key) else { continue }
                    seenFace.insert(key)

                    let quoted = family.replacingOccurrences(of: "\"", with: "\\\"")
                    rules.append("@font-face { font-family: \"\(quoted)\"; src: url(\"/__fonts/\(fileID)\"); font-weight: \(weight); font-style: \(italic ? "italic" : "normal"); font-display: swap; }")
                    familySet.insert(family)
                    fileUsed = true
                }
                if fileUsed { files.append(url) }
            }
        }

        css = rules.joined(separator: "\n")
        families = familySet.sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }
        NSLog("thesis: fonts — %d faces from %d files, %d families", rules.count, files.count, families.count)
    }

    // CoreText weight trait (-1…1) → CSS font-weight.
    // Reference points: ultraLight -0.8, thin -0.6, light -0.4, regular 0,
    // medium 0.23, semibold 0.3, bold 0.4, heavy 0.56, black 0.62.
    private static func cssWeight(_ trait: Double) -> Int {
        switch trait {
        case ..<(-0.7): return 100
        case ..<(-0.5): return 200
        case ..<(-0.2): return 300
        case ..<(0.11): return 400
        case ..<(0.26): return 500
        case ..<(0.35): return 600
        case ..<(0.48): return 700
        case ..<(0.59): return 800
        default: return 900
        }
    }
}
