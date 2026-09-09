// Paragraph and sentence numbers — reference marks in the margin and the text.
//
// Both are VIEW-ONLY: they render in a pointer-transparent overlay floated
// over the editor, so the editable DOM and the saved file are never touched.
// Paragraph numbers count each non-empty, non-heading block in the left
// gutter. Sentence numbers run continuously through the piece — the stable
// analogue of line numbers, anchored to sentences rather than visual lines,
// so they don't shift when the window or the type size changes.
//
// The overlay is clipped to the editor's box and mirrors its scroll with one
// transform (the comment cards' trick). Everything re-derives from the live
// DOM on a debounced MutationObserver — no bookkeeping to go stale.

import state from './state.js';
import { getEditor } from './blocks.js';
import { debounce } from './utils.js';

const GUTTER = 64;        // how far the overlay extends left of the editor box
const PARA_GAP = 26;      // paragraph number's right edge, left of the block
const SENT_GAP = 2;       // sentence number's right edge, left of its sentence

let overlay = null;       // fixed, clipped to the editor's box
let layer = null;         // transformed with scroll; chips live here

const active = () => state.paragraphNumbers || state.sentenceNumbers;

function ensureOverlay() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.id = 'number-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    layer = document.createElement('div');
    layer.id = 'number-layer';
    overlay.appendChild(layer);
    document.body.appendChild(overlay);
}

// ──────────────────────────────────
// Sentence segmentation
// ──────────────────────────────────
// Segmenters over-split around abbreviations ("Dr. Smith") and closing
// quotes ('"Really?" she asked.'). Rejoin conservatively: a break is bogus
// when the next piece starts lowercase, or the last word before the period
// is a title/initial that promises a name after it. Erring toward fewer,
// longer sentences keeps the numbers stabler.
const ABBREV = /(?:\b(?:mr|mrs|ms|dr|prof|st|jr|sr|vs|fig)|\b[a-z])\.["'”’)\]]*\s*$/i;
function mergeMisSplits(segs) {
    const out = [];
    for (const s of segs) {
        const prev = out[out.length - 1];
        const startsLower = /^[\s"'“‘(\[]*[a-z]/.test(s.segment);
        if (prev && (startsLower || ABBREV.test(prev.segment))) prev.segment += s.segment;
        else out.push({ index: s.index, segment: s.segment });
    }
    return out;
}

let segmenter;
function sentencesOf(text) {
    let segs;
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
        segmenter = segmenter || new Intl.Segmenter(undefined, { granularity: 'sentence' });
        segs = Array.from(segmenter.segment(text), s => ({ index: s.index, segment: s.segment }));
    } else {
        // Fallback: naive terminal-punctuation split
        segs = [];
        const re = /[^.!?…]*[.!?…]+["'”’)\]]*\s*|[^.!?…]+$/g;
        let m;
        while ((m = re.exec(text)) !== null) {
            if (m[0]) segs.push({ index: m.index, segment: m[0] });
            if (m.index === re.lastIndex) re.lastIndex++;
        }
    }
    return mergeMisSplits(segs);
}

// Rect of the single character at a text offset within content
function charRect(content, offset) {
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    let acc = 0, node;
    while ((node = walker.nextNode())) {
        const len = node.textContent.length;
        if (offset < acc + len) {
            const r = document.createRange();
            r.setStart(node, offset - acc);
            r.setEnd(node, Math.min(offset - acc + 1, len));
            const rect = r.getBoundingClientRect();
            return (rect.width || rect.height) ? rect : null;
        }
        acc += len;
    }
    return null;
}

// ──────────────────────────────────
// The render pass
// ──────────────────────────────────
function addChip(cls, num, x, y) {
    const chip = document.createElement('span');
    chip.className = 'num-chip ' + cls;
    chip.textContent = num;
    chip.style.left = x + 'px';
    chip.style.top = y + 'px';
    layer.appendChild(chip);
}

function doRefresh() {
    if (!active()) {
        if (overlay) { overlay.style.display = 'none'; layer.textContent = ''; }
        return;
    }
    ensureOverlay();
    const editor = getEditor();
    const box = editor.getBoundingClientRect();
    overlay.style.display = 'block';
    overlay.style.top = box.top + 'px';
    overlay.style.left = (box.left - GUTTER) + 'px';
    overlay.style.width = (box.width + GUTTER) + 'px';
    overlay.style.height = box.height + 'px';
    overlay.style.fontSize = state.currentFontSize + 'px';   // chips scale with the text
    layer.style.transform = `translateY(${-editor.scrollTop}px)`;
    layer.textContent = '';

    // Chips are laid out in content space (y includes scrollTop), so scrolling
    // only ever moves the one transform above.
    const originX = box.left - GUTTER;
    const originY = box.top - editor.scrollTop;

    let para = 0, sent = 0;
    for (const block of editor.querySelectorAll('.block')) {
        const content = block.querySelector('.block-content');
        if (!content) continue;
        const text = content.textContent || '';
        if (!text.trim()) continue;                                    // blank lines are air, not paragraphs
        if ((block.dataset.type || '').startsWith('heading')) continue; // headings are addresses already

        if (state.paragraphNumbers) {
            const r = block.getBoundingClientRect();
            addChip('num-para', ++para, r.left - originX - PARA_GAP, r.top - originY + 2);
        }
        if (state.sentenceNumbers) {
            for (const s of sentencesOf(text)) {
                if (!s.segment.trim()) continue;
                const lead = s.segment.match(/^\s*/)[0].length;
                const r = charRect(content, s.index + lead);
                sent++;
                if (r) addChip('num-sent', sent, r.left - originX - SENT_GAP, r.top - originY);
            }
        }
    }
}

const refreshSoon = debounce(doRefresh, 150);

// ──────────────────────────────────
// Toggles + init
// ──────────────────────────────────
export function toggleParagraphNumbers() {
    state.paragraphNumbers = !state.paragraphNumbers;
    localStorage.setItem('paragraphNumbers', state.paragraphNumbers);
    doRefresh();
}

export function toggleSentenceNumbers() {
    state.sentenceNumbers = !state.sentenceNumbers;
    localStorage.setItem('sentenceNumbers', state.sentenceNumbers);
    doRefresh();
}

export function initNumbers() {
    state.paragraphNumbers = localStorage.getItem('paragraphNumbers') === 'true';
    state.sentenceNumbers = localStorage.getItem('sentenceNumbers') === 'true';
    const editor = getEditor();
    // The overlay writes nothing inside the editor, so observing it can't loop.
    // Attribute changes cover font/line-height (style on #editor) and block
    // type/indent conversions; the rest is typing and structure.
    new MutationObserver(refreshSoon).observe(editor, {
        subtree: true, childList: true, characterData: true,
        attributes: true, attributeFilter: ['style', 'class', 'data-level', 'data-type'],
    });
    window.addEventListener('resize', refreshSoon);
    editor.addEventListener('scroll', () => {
        if (layer && active()) layer.style.transform = `translateY(${-editor.scrollTop}px)`;
    }, { passive: true });
    doRefresh();
}
