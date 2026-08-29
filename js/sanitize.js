// Lightweight HTML sanitizer for content loaded from localStorage / external sources.
// Allows only safe formatting tags — strips scripts, event handlers, and dangerous elements.

const ALLOWED_TAGS = new Set([
    'div', 'span', 'p', 'br', 'b', 'strong', 'i', 'em', 'strike', 's',
    'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'blockquote',
]);

// Saved content never carries ids, styles, or spacers (marks and spacers are
// stripped before every persist) — anything wearing them is not ours.
const ALLOWED_ATTRS = new Set([
    'class', 'contenteditable', 'data-type', 'data-level',
]);

// Attributes that are always stripped (event handlers, dangerous)
const DANGEROUS_ATTR_PREFIX = /^on/i;

export function sanitizeHTML(html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    sanitizeNode(template.content);
    return template.innerHTML;
}

function sanitizeNode(node) {
    const toRemove = [];

    for (const child of node.childNodes) {
        if (child.nodeType === Node.ELEMENT_NODE) {
            const tag = child.tagName.toLowerCase();

            if (!ALLOWED_TAGS.has(tag)) {
                // Keep text content but remove the element
                toRemove.push(child);
                continue;
            }

            // Strip dangerous attributes
            const attrs = Array.from(child.attributes);
            for (const attr of attrs) {
                if (DANGEROUS_ATTR_PREFIX.test(attr.name) || !ALLOWED_ATTRS.has(attr.name)) {
                    child.removeAttribute(attr.name);
                }
            }

            // Recurse into children
            sanitizeNode(child);
        }
    }

    // Replace disallowed elements with their text content
    for (const el of toRemove) {
        const text = document.createTextNode(el.textContent);
        node.replaceChild(text, el);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Paste
// ──────────────────────────────────────────────────────────────────────────
// A paste arrives wearing the look of wherever it came from — serif faces,
// pixel sizes, blue underlined links, Google Docs' <span> scaffolding. thesis
// has exactly three inline forms (bold, italic, strike — see inlineMarkdown in
// io.js) and its own typography. So we keep what the formatting *means* and
// throw away every instruction about how it should look: the words arrive in
// the document's voice, still bold where they were bold.

const ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
const escapeText = (s) => s.replace(/[&<>]/g, (c) => ESCAPE[c]);

const NEVER = new Set(['SCRIPT', 'STYLE', 'HEAD', 'META', 'LINK', 'TITLE', 'NOSCRIPT']);

const BLOCKISH = new Set([
    'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'UL', 'OL',
    'LI', 'SECTION', 'ARTICLE', 'MAIN', 'HEADER', 'FOOTER', 'FIGURE', 'PRE',
    'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'DL', 'DT', 'DD',
]);

const HEADING = { H1: 'heading1', H2: 'heading2', H3: 'heading3', H4: 'heading3', H5: 'heading3', H6: 'heading3' };

// Which of thesis's three marks this element asserts. null means "says
// nothing, inherit" — the distinction matters, because word processors turn
// formatting *off* with CSS as often as they turn it on.
function marksOf(el) {
    const tag = el.tagName;
    let strong = null, em = null, strike = null;

    if (tag === 'B' || tag === 'STRONG') strong = true;
    if (tag === 'I' || tag === 'EM') em = true;
    if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') strike = true;

    const style = el.getAttribute('style') || '';
    if (style) {
        // Google Docs wraps an entire copied document in
        // <b style="font-weight:normal">. Honouring the tag and ignoring the
        // CSS would bold the whole paste.
        const fw = /font-weight\s*:\s*([^;]+)/i.exec(style);
        if (fw) {
            const v = fw[1].trim().toLowerCase();
            const n = parseInt(v, 10);
            if (v === 'bold' || v === 'bolder' || (Number.isFinite(n) && n >= 600)) strong = true;
            else if (v === 'normal' || v === 'lighter' || Number.isFinite(n)) strong = false;
        }
        const fs = /font-style\s*:\s*([^;]+)/i.exec(style);
        if (fs) {
            const v = fs[1].trim().toLowerCase();
            em = (v === 'italic' || v === 'oblique');
        }
        // Word and Docs mark struck text with text-decoration on a span
        const td = /text-decoration(?:-line)?\s*:\s*([^;]+)/i.exec(style);
        if (td) strike = /line-through/i.test(td[1]);
    }
    return { strong, em, strike };
}

// Inline HTML in thesis's own vocabulary. Everything unrecognised is unwrapped
// to its text — including <a>, whose URL the markdown serializer has no case
// for; keeping the anchor would show a link in the editor that the saved .md
// does not contain.
function inlineFromPaste(node, active = { strong: false, em: false, strike: false }) {
    let out = '';
    for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) { out += escapeText(child.textContent); continue; }
        if (child.nodeType !== Node.ELEMENT_NODE) continue;

        const tag = child.tagName;
        if (NEVER.has(tag)) continue;
        if (tag === 'BR') { out += '<br>'; continue; }

        const m = marksOf(child);
        const next = {
            strong: m.strong === null ? active.strong : m.strong,
            em: m.em === null ? active.em : m.em,
            strike: m.strike === null ? active.strike : m.strike,
        };

        let piece = inlineFromPaste(child, next);
        if (!piece) continue;
        if (next.strike && !active.strike) piece = `<strike>${piece}</strike>`;
        if (next.em && !active.em) piece = `<em>${piece}</em>`;
        if (next.strong && !active.strong) piece = `<strong>${piece}</strong>`;
        out += piece;
    }
    return out;
}

const isBlank = (html) => !html.replace(/<br\s*\/?>/gi, '').replace(/&nbsp;/gi, ' ').trim();

// A list, one item per block, nested lists one level deeper. An item's own
// text is read without the sublists hanging off it, or it arrives twice.
function collectList(listEl, out, level) {
    const type = listEl.tagName === 'UL' ? 'bullet' : 'numbered';
    for (const li of listEl.children) {
        if (li.tagName !== 'LI') continue;

        const shallow = document.createElement('div');
        for (const n of li.childNodes) {
            if (n.nodeType === Node.ELEMENT_NODE && (n.tagName === 'UL' || n.tagName === 'OL')) continue;
            shallow.appendChild(n.cloneNode(true));
        }
        const html = inlineFromPaste(shallow);
        if (!isBlank(html)) out.push({ type, level, html: html.trim() });

        for (const n of li.children) {
            if (n.tagName === 'UL' || n.tagName === 'OL') collectList(n, out, level + 1);
        }
    }
}

// Turn a pasted fragment into thesis blocks: {type, level, html}
function collectBlocks(node, out, level) {
    let pending = '';
    const flush = () => {
        if (!isBlank(pending)) out.push({ type: 'text', level, html: pending.trim() });
        pending = '';
    };

    for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) { pending += escapeText(child.textContent); continue; }
        if (child.nodeType !== Node.ELEMENT_NODE) continue;

        const tag = child.tagName;
        if (NEVER.has(tag)) continue;

        if (tag === 'UL' || tag === 'OL') { flush(); collectList(child, out, level); continue; }

        if (HEADING[tag]) {
            flush();
            const html = inlineFromPaste(child);
            if (!isBlank(html)) out.push({ type: HEADING[tag], level: 0, html: html.trim() });
            continue;
        }

        if (tag === 'BLOCKQUOTE') {
            flush();
            const html = inlineFromPaste(child);
            if (!isBlank(html)) out.push({ type: 'quote', level: 0, html: html.trim() });
            continue;
        }

        if (BLOCKISH.has(tag)) {
            flush();
            // A wrapper (Docs and Word nest divs deeply) recurses; a leaf
            // paragraph becomes one block.
            const wraps = Array.from(child.children).some((c) => BLOCKISH.has(c.tagName));
            if (wraps) { collectBlocks(child, out, level); continue; }
            const html = inlineFromPaste(child);
            if (!isBlank(html)) out.push({ type: 'text', level, html: html.trim() });
            continue;
        }

        // Inline element sitting at block level — accumulate it into the
        // paragraph being built. Wrapping it in a throwaway parent lets
        // inlineFromPaste apply its own marks from a clean slate.
        const holder = document.createElement('div');
        holder.appendChild(child.cloneNode(true));
        pending += inlineFromPaste(holder);
    }
    flush();
}

// Public: pasted HTML → thesis blocks carrying only meaning-bearing formatting
export function blocksFromPastedHTML(html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    const out = [];
    collectBlocks(template.content, out, 0);
    return out;
}
