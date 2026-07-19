// Injected into the macOS wrapper's WKWebView at document start.
// Polyfills the File System Access API (which WebKit lacks) on top of the
// native bridge, so io.js/db.js run unmodified. Never loaded on the web.
(function () {
    'use strict';
    const bridge = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.thesis;
    if (!bridge) return;

    const call = (cmd, payload) => bridge.postMessage(Object.assign({ cmd: cmd }, payload || {}));

    // Mirrors FileSystemFileHandle closely enough for io.js. Instances survive
    // IndexedDB's structured clone as plain {kind, isNativePath, path, name}
    // records; db.js revives those via __thesisRehydrateHandle below.
    class NativeFileHandle {
        constructor(path, name) {
            this.kind = 'file';
            this.isNativePath = true;
            this.path = path;
            this.name = name;
        }
        async createWritable() {
            const path = this.path;
            const chunks = [];
            return {
                async write(data) { chunks.push(typeof data === 'string' ? data : String(data)); },
                async close() { await call('writeFile', { path: path, content: chunks.join('') }); },
                async abort() {},
            };
        }
        async getFile() {
            const res = await call('readFile', { path: this.path });
            return new File([res.content], res.name || this.name, { type: 'text/markdown' });
        }
        async queryPermission() { return 'granted'; }
        async requestPermission() { return 'granted'; }
        async isSameEntry(other) { return !!other && other.path === this.path; }
    }

    window.__thesisRehydrateHandle = (obj) =>
        obj && obj.isNativePath ? new NativeFileHandle(obj.path, obj.name) : obj;

    const abort = () => {
        const e = new Error('The user aborted a request.');
        e.name = 'AbortError';
        throw e;
    };

    window.showSaveFilePicker = async (opts) => {
        const res = await call('savePanel', { suggestedName: (opts && opts.suggestedName) || 'document.md' });
        if (!res || !res.path) abort();
        return new NativeFileHandle(res.path, res.name);
    };

    window.showOpenFilePicker = async () => {
        const res = await call('openPanel', {});
        if (!res || !res.path) abort();
        return [new NativeFileHandle(res.path, res.name)];
    };

    // Custom-scheme pages may not be secure contexts, which hides navigator.clipboard
    if (!navigator.clipboard) {
        try {
            Object.defineProperty(navigator, 'clipboard', {
                value: { writeText: (text) => call('copyText', { text: text }).then(() => undefined) },
                configurable: true,
            });
        } catch (e) { /* leave it */ }
    }

    // Report standalone display-mode so the Install App command says "already installed"
    const origMatchMedia = window.matchMedia.bind(window);
    window.matchMedia = (query) => {
        if (query && query.indexOf('display-mode: standalone') !== -1) {
            return {
                matches: true, media: query, onchange: null,
                addEventListener() {}, removeEventListener() {},
                addListener() {}, removeListener() {},
                dispatchEvent() { return false; },
            };
        }
        return origMatchMedia(query);
    };

    // Installed fonts: the sandboxed webview can't see ~/Library/Fonts, so the
    // host serves them as @font-face rules (/__fonts.css) and lists families here.
    window.__thesisInstalledFonts = () => call('listFonts').then((res) => (res && res.families) || []);

    window.addEventListener('DOMContentLoaded', () => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = '/__fonts.css';
        document.head.appendChild(link);
    });

    // Boot diagnostics → Console.app (log show --predicate 'process == "thesis"')
    window.addEventListener('DOMContentLoaded', () => {
        let ls = 'no';
        try { localStorage.setItem('__probe', '1'); localStorage.removeItem('__probe'); ls = 'yes'; } catch (e) {}
        call('log', {
            message: 'boot — secureContext=' + window.isSecureContext +
                ' localStorage=' + ls +
                ' indexedDB=' + (typeof indexedDB !== 'undefined' ? 'yes' : 'no') +
                ' blocks=' + document.querySelectorAll('.block').length,
        });
    });
})();
