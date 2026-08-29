// Margin comments — notes that live in the document, not in a sidecar.
//
// Comments are stored in state.comments and written back into the .md file as a
// single delimited HTML-comment block (see splitComments/getCommentBlock), the
// same format any other tool can read, so files round-trip between them.
//
// Highlights are <mark class="cmt"> elements wrapped around the quoted text.
// They are DERIVED state: never serialized (history and localStorage strip
// them), always re-anchored from the stored quote+prefix. While the document is
// open, the live marks are the ground truth — syncAnchorsFromDOM() refreshes
// each comment's quote/prefix/block from its marks before every persist, so
// editing highlighted text keeps the anchor fresh instead of orphaning it.

import state from './state.js';
import { getEditor, revealCaret } from './blocks.js';
import { showAlert, showConfirm } from './modals.js';
import { debounce } from './utils.js';
import { recordCheckpoint } from './history.js';

const MARK_START = '<!-- thesis:comments v1';
const BLOCK_RE = /^<!--\s*thesis:comments v1\s*\n([\s\S]*?)\n-->\s*$/;
const MARGIN_START = '<!-- thesis:margin v1';
const MARGIN_RE = /<!--\s*thesis:margin v1\s*\n([\s\S]*?)\n-->\s*/;

let persist = () => {};        // injected autoSave, set by initComments
let orphans = new Set();
let draft = null;              // { blockIndex, start, quote, prefix }

// Notes that just arrived from outside (the margin writing back) fade in
// rather than popping. io.js feeds these during the external merge; they are
// consumed on the first render that actually shows them, so reopening the
// panel later still greets unseen arrivals gently.
const arrivingCards = new Set();     // comment ids
const arrivingReplies = new Set();   // `${commentId}|${author}|${created}`
let arriveStagger = 0;               // reset each render; spaces out a batch

export function noteArrivals(cardIds, replyKeys) {
    for (const id of cardIds || []) arrivingCards.add(id);
    for (const k of replyKeys || []) arrivingReplies.add(k);
}

function newId() {
    return 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

// ──────────────────────────────────
// Storage format (the thesis:comments v1 block)
// margin/margin.js carries its own copy of this parser; any change here must
// keep the two in agreement — `node margin/format-test.js` checks that.
// ──────────────────────────────────

// Lift the thesis:margin block (Claude's per-file invitation + brief) out of
// raw markdown. Same never-reaches-the-editor rule as the comment block.
// Returns { rest, margin, marginRaw } — rest is the input with the block
// removed, so the comment-block extraction below runs on clean text.
function splitMargin(raw) {
    const idx = raw.indexOf(MARGIN_START);
    if (idx < 0) return { rest: raw, margin: null, marginRaw: null };
    const m = raw.match(MARGIN_RE);
    if (!m) {
        // Marker present but the block is mangled — carry the tail from the
        // marker onward untouched, like a damaged comment block
        return { rest: raw.slice(0, idx), margin: null, marginRaw: raw.slice(idx) };
    }
    const rest = raw.slice(0, raw.indexOf(m[0])) + raw.slice(raw.indexOf(m[0]) + m[0].length);
    try {
        const margin = JSON.parse(m[1]);
        if (margin && typeof margin === 'object' && !Array.isArray(margin)) return { rest, margin, marginRaw: null };
    } catch (e) { /* fall through */ }
    // Lenient salvage: first { to last }
    const a = m[1].indexOf('{');
    const b = m[1].lastIndexOf('}');
    if (a >= 0 && b > a) {
        try {
            const margin = JSON.parse(m[1].slice(a, b + 1));
            if (margin && typeof margin === 'object') return { rest, margin, marginRaw: null };
        } catch (e) { /* give up */ }
    }
    return { rest, margin: null, marginRaw: m[0].trimEnd() };
}

// Lift the trailing comment block out of raw markdown. The block must NEVER
// reach the editor as prose: the markdown round-trip would mangle it (trimmed
// indentation, _ → * italics) and the next save writes the damage to disk.
// Three tiers: strict parse → salvage a slightly-corrupted block → keep the
// raw bytes aside untouched (invisible, re-appended verbatim on save).
export function splitComments(input) {
    const { rest: raw, margin, marginRaw } = splitMargin(input);
    const idx = raw.indexOf(MARK_START);
    if (idx < 0) return { prose: raw.replace(/\s+$/, ''), comments: [], raw: null, margin, marginRaw };
    const prose = raw.slice(0, idx).replace(/\s+$/, '');
    const block = raw.slice(idx);

    const m = block.match(BLOCK_RE);
    if (m) {
        try {
            const comments = JSON.parse(m[1]);
            if (Array.isArray(comments)) return { prose, comments, raw: null, margin, marginRaw };
        } catch (e) { /* fall through to salvage */ }
    }

    // Salvage: hand or agent edits sometimes displace the closing bracket
    // past the --> line, or leave junk after the block. The array is whatever
    // sits between the first [ and the last ] after the marker — try it as-is,
    // then with any stray --> lines removed, before giving up.
    const a = block.indexOf('[');
    const b = block.lastIndexOf(']');
    if (a >= 0 && b > a) {
        const mid = block.slice(a, b + 1);
        for (const candidate of [mid, mid.replace(/^\s*-->\s*$/gm, '')]) {
            try {
                const comments = JSON.parse(candidate);
                if (Array.isArray(comments)) return { prose, comments, raw: null, margin, marginRaw };
            } catch (e) { /* try next candidate */ }
        }
    }

    return { prose, comments: [], raw: block, margin, marginRaw };
}

// The block to append after the prose when saving ('' when there are none).
// A damaged block we couldn't parse is carried through byte-for-byte.
export function getCommentBlock() {
    if (state.commentsRaw) return '\n\n' + state.commentsRaw;
    if (!state.comments || state.comments.length === 0) return '';
    return '\n\n' + MARK_START + '\n' + JSON.stringify(state.comments, null, 2) + '\n-->\n';
}

// The margin block (invitation + brief), appended after the comment block.
// Dropped entirely once it says nothing (uninvited, no brief).
export function getMarginBlock() {
    if (state.marginRaw) return '\n\n' + state.marginRaw + '\n';
    const m = state.margin;
    if (!m || (!m.invited && !m.brief)) return '';
    return '\n\n' + MARGIN_START + '\n' + JSON.stringify(m) + '\n-->\n';
}

export function setMargin(margin, raw = null) {
    state.margin = margin || null;
    state.marginRaw = raw || null;
}

export function setComments(comments, raw = null) {
    state.comments = Array.isArray(comments) ? comments : [];
    state.commentsRaw = raw || null;
    state.activeCommentId = null;
    cancelDraft(false);
}

export function openCommentCount() {
    return (state.comments || []).filter(c => !c.resolved).length;
}

// ──────────────────────────────────
// Anchoring — quote+prefix text match, block index as a hint
// ──────────────────────────────────
function allBlocks() {
    return Array.from(getEditor().querySelectorAll('.block'));
}

function contentOf(block) {
    return block ? block.querySelector('.block-content') : null;
}

function findStart(content, c) {
    if (!content || !c.quote) return -1;
    const text = content.textContent;
    if (c.prefix) {
        const i = text.indexOf(c.prefix + c.quote);
        if (i >= 0) return i + c.prefix.length;
    }
    return text.indexOf(c.quote);
}

function wrapRange(content, start, len, id, cls) {
    const end = start + len;
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT, null);
    const hits = [];
    let pos = 0, n;
    while ((n = walker.nextNode())) {
        const s = pos, e = pos + n.nodeValue.length;
        if (e > start && s < end) hits.push({ node: n, from: Math.max(start, s) - s, to: Math.min(end, e) - s });
        pos = e;
    }
    let ok = false;
    for (let k = hits.length - 1; k >= 0; k--) {
        const { node, from, to } = hits[k];
        if (to <= from) continue;
        const r = document.createRange();
        r.setStart(node, from);
        r.setEnd(node, to);
        const m = document.createElement('mark');
        m.className = 'cmt' + (cls ? ' ' + cls : '');
        m.dataset.cmt = id;
        try { r.surroundContents(m); ok = true; } catch (e) { /* partial node overlap — skip */ }
    }
    return ok;
}

// Unwrap marks (all, or just one comment's) and merge the text nodes back.
export function unwrapMarks(root, id) {
    const sel = id ? `mark.cmt[data-cmt="${id}"]` : 'mark.cmt';
    root.querySelectorAll(sel).forEach(m => {
        const parent = m.parentNode;
        while (m.firstChild) parent.insertBefore(m.firstChild, m);
        m.remove();
        parent.normalize();
    });
}

function marksFor(id) {
    return Array.from(getEditor().querySelectorAll(`mark.cmt[data-cmt="${id}"]`));
}

// Refresh quote/prefix/block from the live marks. The editor may have changed
// the highlighted text itself — the marks moved with it, so they are the truth.
export function syncAnchorsFromDOM() {
    const blocks = allBlocks();
    for (const c of state.comments || []) {
        let marks = marksFor(c.id);
        if (marks.length === 0) continue;
        const firstBlock = marks[0].closest('.block');
        if (!firstBlock) continue;
        // An Enter-split can scatter one comment's marks across blocks; anchor
        // to the piece in the first block so the quote stays matchable.
        marks = marks.filter(m => m.closest('.block') === firstBlock);
        const quote = marks.map(m => m.textContent).join('');
        if (!quote.trim()) continue;   // highlight deleted — keep the old anchor
        const content = contentOf(firstBlock);
        const r = document.createRange();
        r.setStart(content, 0);
        r.setEndBefore(marks[0]);
        c.quote = quote;
        c.prefix = r.toString().slice(-30);
        c.block = blocks.indexOf(firstBlock);
    }
}

// Drop every mark and re-wrap from stored anchors. Call after any wholesale
// DOM replacement (load, undo/redo) — not while typing; live marks ride along.
function anchorAll() {
    const editor = getEditor();
    unwrapMarks(editor);
    orphans = new Set();
    if (!commentsVisible()) return;
    const blocks = allBlocks();
    for (const c of state.comments || []) {
        if (c.resolved && !state.showResolvedComments) continue;
        if (!c.quote) continue;   // document note — intentionally unanchored, never an orphan
        let content = contentOf(blocks[c.block]);
        let start = findStart(content, c);
        if (start < 0 && c.quote) {
            for (const b of blocks) {
                const alt = contentOf(b);
                const i = findStart(alt, c);
                if (i >= 0) { content = alt; start = i; break; }
            }
        }
        // anchorAll runs before the cards are built, so arrival ids are still
        // unconsumed here — the highlight fades in alongside its card
        const cls = (c.resolved ? 'resolved' : '') + (c.id === state.activeCommentId ? ' active' : '')
            + (arrivingCards.has(c.id) ? ' arriving' : '');
        const ok = start >= 0 && wrapRange(content, start, c.quote.length, c.id, cls.trim());
        if (!ok) orphans.add(c.id);
    }
    // The in-progress draft highlight is re-derived here too, so it survives
    // any re-render while the composer is open
    if (draft) {
        const content = contentOf(blocks[draft.blockIndex]);
        if (content) wrapRange(content, draft.start, draft.quote.length, '__draft__', 'pending');
    }
}

// ──────────────────────────────────
// Panel rendering
// ──────────────────────────────────
function panel() { return document.getElementById('comments-panel'); }
function cardsEl() { return document.getElementById('comments-cards'); }

export function commentsVisible() {
    return state.commentsVisible;
}

function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
}

function fmtTime(iso) {
    try {
        const d = new Date(iso);
        return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' +
               d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    } catch (e) { return ''; }
}

function mutate(fn) {
    fn();
    persist();
    renderCommentUI();
}

function buildCard(c) {
    const foreign = c.author && c.author !== 'me';
    const card = el('div', 'comment-card' + (c.resolved ? ' resolved' : '') + (c.id === state.activeCommentId ? ' active' : '') + (foreign ? ' foreign' : ''));
    card.dataset.cmt = c.id;
    if (arrivingCards.delete(c.id)) {
        card.classList.add('arriving');
        card.style.animationDelay = `${Math.min(arriveStagger++ * 120, 600)}ms`;
    }

    if (c.quote) {
        const quote = el('div', 'comment-quote', c.quote);
        quote.title = 'Jump to highlight';
        quote.addEventListener('click', () => focusComment(c.id, true));
        card.appendChild(quote);
    } else {
        // A document note — about the whole piece, anchored to nothing
        card.appendChild(el('div', 'comment-doc-label', 'whole document'));
    }

    if (orphans.has(c.id)) card.appendChild(el('div', 'comment-orphan', '⚠ highlight not found in current text'));
    card.appendChild(el('div', 'comment-meta', `${c.author || 'me'} · ${fmtTime(c.created)}`));
    const bodyEl = el('div', 'comment-body', c.body);
    card.appendChild(bodyEl);

    for (const r of (c.replies || [])) {
        const rd = el('div', 'comment-reply' + (r.author && r.author !== 'me' ? ' foreign' : ''));
        if (arrivingReplies.delete(`${c.id}|${r.author}|${r.created}`)) {
            rd.classList.add('arriving');
            rd.style.animationDelay = `${Math.min(arriveStagger++ * 120, 600)}ms`;
        }
        rd.appendChild(el('div', 'comment-meta', `${r.author || 'me'} · ${fmtTime(r.created)}`));
        rd.appendChild(el('div', 'comment-body', r.body));
        card.appendChild(rd);
    }

    const replyBox = el('div', 'comment-reply-box');
    const ta = document.createElement('textarea');
    ta.rows = 2;
    ta.placeholder = 'Reply…';
    replyBox.appendChild(ta);
    const saveReply = () => {
        const body = ta.value.trim();
        if (!body) return;
        mutate(() => {
            c.replies = c.replies || [];
            c.replies.push({ author: 'me', body, created: new Date().toISOString() });
        });
        refocusEditor();
    };
    ta.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveReply(); }
        else if (e.key === 'Escape') { e.preventDefault(); replyBox.classList.remove('open'); refocusEditor(); }
    });
    card.appendChild(replyBox);

    // Icon buttons, right-aligned; the title/aria-label carries the word
    const actions = el('div', 'comment-actions');
    // An orphaned note's honest repair: the writer, not a heuristic, says
    // where it belongs now. Select the text, press Re-anchor.
    if (orphans.has(c.id) && c.quote) {
        const reBtn = el('button', 'comment-act primary', 'Re-anchor');
        reBtn.title = 'Attach this note to the currently selected text';
        reBtn.addEventListener('mousedown', (e) => e.preventDefault());   // keep the editor selection alive
        reBtn.addEventListener('click', () => reanchorComment(c));
        actions.appendChild(reBtn);
    }
    // A comment carrying a preloaded mechanical fix gets a one-press Fix
    // button — the press is the bidding, the change is local, no inference
    if (!c.resolved && c.fix && typeof c.fix.before === 'string' && c.fix.before && typeof c.fix.after === 'string') {
        const fixBtn = el('button', 'comment-act primary', 'Fix');
        fixBtn.title = `Replace “${c.fix.before}” with “${c.fix.after}”`;
        fixBtn.addEventListener('click', () => applyFix(c));
        actions.appendChild(fixBtn);
    }
    const act = (icon, label, cls) => {
        const b = el('button', 'comment-act icon' + (cls ? ' ' + cls : ''), icon);
        b.title = label;
        b.setAttribute('aria-label', label);
        actions.appendChild(b);
        return b;
    };
    const replyBtn = act('↩', 'Reply');
    replyBtn.addEventListener('click', () => {
        replyBox.classList.toggle('open');
        if (replyBox.classList.contains('open')) ta.focus();
        positionCards();
    });
    const editBtn = act('✎', 'Edit');
    editBtn.addEventListener('click', () => {
        if (card.querySelector('.comment-edit')) return;
        const eta = document.createElement('textarea');
        eta.className = 'comment-edit';
        eta.rows = 3;
        eta.value = c.body;
        bodyEl.replaceWith(eta);
        eta.focus();
        eta.setSelectionRange(eta.value.length, eta.value.length);
        eta.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                const v = eta.value.trim();
                if (v && v !== c.body) mutate(() => { c.body = v; });
                else renderCommentUI();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                renderCommentUI();
            }
        });
        positionCards();
    });
    const resolveBtn = act(c.resolved ? '↺' : '✓', c.resolved ? 'Reopen' : 'Resolve');
    resolveBtn.addEventListener('click', () => mutate(() => { c.resolved = !c.resolved; }));
    const deleteBtn = act('✕', 'Delete', 'danger');
    deleteBtn.addEventListener('click', async () => {
        if (await showConfirm('Delete this comment? It is removed from the saved file too.')) {
            mutate(() => {
                const i = state.comments.indexOf(c);
                if (i >= 0) state.comments.splice(i, 1);
                if (state.activeCommentId === c.id) state.activeCommentId = null;
            });
        }
    });
    card.appendChild(actions);

    card.addEventListener('mousedown', (e) => {
        if (e.target.closest('button') || e.target.closest('textarea')) return;
        focusComment(c.id, false);
    });
    return card;
}

// Build a Range covering the text span [start, start+len) inside content,
// walking across text nodes (the span may straddle marks or inline formatting)
function textRangeIn(content, start, len) {
    const end = start + len;
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT, null);
    let pos = 0, n, startNode = null, startOff = 0, endNode = null, endOff = 0;
    while ((n = walker.nextNode())) {
        const s = pos, e = pos + n.nodeValue.length;
        if (startNode === null && e > start) { startNode = n; startOff = start - s; }
        if (e >= end) { endNode = n; endOff = end - s; break; }
        pos = e;
    }
    if (!startNode || !endNode) return null;
    const r = document.createRange();
    r.setStart(startNode, startOff);
    r.setEnd(endNode, endOff);
    return r;
}

// Apply a comment's preloaded fix: exact-text replacement, done locally in the
// DOM (undoable via history), then the note resolves — the press was the
// writer's acceptance, so no reply ceremony.
async function applyFix(c) {
    const blocks = allBlocks();
    // Prefer the comment's own block, then search the whole document
    const candidates = [];
    const own = contentOf(blocks[c.block]);
    if (own) candidates.push(own);
    for (const b of blocks) {
        const ct = contentOf(b);
        if (ct && ct !== own) candidates.push(ct);
    }
    let content = null, start = -1;
    for (const ct of candidates) {
        const i = ct.textContent.indexOf(c.fix.before);
        if (i >= 0) { content = ct; start = i; break; }
    }
    const range = content && textRangeIn(content, start, c.fix.before.length);
    if (!range) {
        await showAlert('The text has changed — this fix no longer applies.');
        return;
    }
    recordCheckpoint();
    range.deleteContents();
    if (c.fix.after) range.insertNode(document.createTextNode(c.fix.after));
    content.normalize();
    mutate(() => { c.resolved = true; });
}

export function renderCommentUI() {
    const p = panel();
    if (!p) return;
    anchorAll();
    // Anyone watching the margin (open-count pill, palette badge) hears about
    // every re-render — cheap, and avoids import cycles
    document.dispatchEvent(new CustomEvent('thesis:comments-changed'));

    // The panel only exists on screen when there is something to show — an
    // empty margin never competes with the writing
    const total = (state.comments || []).length;
    const show = commentsVisible() && (total > 0 || !!draft);
    p.classList.toggle('hidden', !show);
    const resolvedToggle = document.getElementById('comments-resolved-toggle');
    if (resolvedToggle) resolvedToggle.classList.toggle('on', !!state.showResolvedComments);
    if (!show) return;

    const cards = cardsEl();
    cards.innerHTML = '';
    arriveStagger = 0;
    const visible = (state.comments || []).filter(c => state.showResolvedComments || !c.resolved);
    const emptyEl = document.getElementById('comments-empty');
    if (visible.length === 0 && !draft) {
        emptyEl.textContent = `${total} resolved comment${total === 1 ? '' : 's'} hidden`;
        emptyEl.classList.remove('hidden');
    } else {
        emptyEl.classList.add('hidden');
    }
    for (const c of visible) cards.appendChild(buildCard(c));
    if (draft) {
        const dc = buildDraftCard();
        cards.appendChild(dc);
        // Focus synchronously — in quick comment mode the very next keystroke
        // must already land in the composer
        const ta = dc.querySelector('textarea');
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
    }
    positionCards();
}

// Float each card at its highlight's vertical position; stack on collision.
// Cards are laid out in DOCUMENT space (their top is where the highlight sits
// in the scroll content), and syncCardScroll slides the whole container to
// mirror the editor's scroll — so mid-scroll the cards move in lockstep with
// the text instead of each card chasing its highlight through a transition.
let posRAF = null;
export function positionCards() {
    if (posRAF) return;
    posRAF = requestAnimationFrame(() => { posRAF = null; doPosition(); });
}

function anchorFor(id) {
    const mark = getEditor().querySelector(`mark.cmt[data-cmt="${id}"]`);
    if (mark) return mark;
    const c = (state.comments || []).find(x => x.id === id);
    return (c && allBlocks()[c.block]) || null;
}

function doPosition() {
    const cards = cardsEl();
    if (!cards || !commentsVisible()) return;
    const editor = getEditor();
    const editorTop = editor.getBoundingClientRect().top - editor.scrollTop;
    const items = Array.from(cards.children).map(card => {
        const anchor = anchorFor(card.dataset.cmt);
        const y = anchor ? anchor.getBoundingClientRect().top - editorTop : 0;
        return { card, y: Math.max(0, y) };
    });
    items.sort((a, b) => a.y - b.y);
    let cursor = 0;
    for (const it of items) {
        const y = Math.max(it.y, cursor);
        it.card.style.top = y + 'px';
        cursor = y + it.card.offsetHeight + 10;
    }
    syncCardScroll();
}

// One transform keeps the document-space card layout aligned with the editor's
// current scroll. Cheap enough to run on every scroll event.
//
// The margin can outrun the document in either direction. A long thread near
// the last paragraph stacks past where the editor can scroll (bottom clipped);
// a whole-document note has no highlight, so it pins to content-top — which
// sits above the panel's own top edge — and its head is clipped there. A plain
// mirror leaves both unreachable. cardOverscroll is the margin's manual travel
// beyond the document's scroll range: positive reveals content below the
// document's end, negative reveals content pinned above its top. It is clamped
// here to exactly what's hidden in each direction, so it can never drift.
let cardOverscroll = 0;

export function syncCardScroll() {
    const cards = cardsEl();
    const scrollEl = document.getElementById('comments-scroll');
    if (!cards || !scrollEl || !commentsVisible()) return;
    const editor = getEditor();
    const offset = editor.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top - editor.scrollTop;
    let stackTop = Infinity, stackBottom = 0;
    for (const card of cards.children) {
        const t = parseFloat(card.style.top) || 0;
        if (t < stackTop) stackTop = t;
        const b = t + card.offsetHeight;
        if (b > stackBottom) stackBottom = b;
    }
    if (stackTop === Infinity) stackTop = 0;
    const maxOverscroll = Math.max(0, stackBottom + offset - scrollEl.clientHeight + 16);
    const minOverscroll = Math.min(0, stackTop + offset - 8);
    cardOverscroll = Math.max(minOverscroll, Math.min(maxOverscroll, cardOverscroll));
    cards.style.transform = `translateY(${offset - cardOverscroll}px)`;
}

function focusComment(id, scrollDoc) {
    state.activeCommentId = id;
    getEditor().querySelectorAll('mark.cmt.active').forEach(m => m.classList.remove('active'));
    const marks = marksFor(id);
    marks.forEach(m => m.classList.add('active'));
    if (scrollDoc) {
        const c = (state.comments || []).find(x => x.id === id);
        // Orphaned highlight: scroll to the comment's remembered block instead
        const target = marks[0] || (c && allBlocks()[c.block]);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    const cards = cardsEl();
    cards.querySelectorAll('.comment-card.active').forEach(x => x.classList.remove('active'));
    const card = cards.querySelector(`.comment-card[data-cmt="${id}"]`);
    if (card) card.classList.add('active');
    positionCards();
}

async function reanchorComment(c) {
    const sel = window.getSelection();
    const usable = sel && sel.rangeCount > 0 && !sel.isCollapsed && sel.toString().trim();
    const resolved = usable ? singleBlockSelection(sel) : null;
    if (!resolved) {
        await showAlert('Select the text this note should attach to (within one paragraph), then press Re-anchor.');
        return;
    }
    const start = startOffsetInContent(resolved.content, resolved.range);
    mutate(() => {
        c.quote = resolved.range.toString();
        c.prefix = resolved.content.textContent.slice(Math.max(0, start - 30), start);
        c.block = allBlocks().indexOf(resolved.content.closest('.block'));
    });
}

// Open the reply box on the active card — the keyboard's version of clicking
// Reply, so cycle-then-respond (⌘⌥. then ⌘⌥R) never needs the mouse.
export function replyToActiveComment() {
    if (!commentsVisible()) return;
    let card = cardsEl() && cardsEl().querySelector('.comment-card.active');
    if (!card) {
        cycleComment(1);
        card = cardsEl() && cardsEl().querySelector('.comment-card.active');
    }
    if (!card || card.classList.contains('draft')) return;
    const box = card.querySelector('.comment-reply-box');
    const ta = box && box.querySelector('textarea');
    if (!box || !ta) return;
    box.classList.add('open');
    positionCards();
    ta.focus();
    // The command-menu path refocuses the editor after the action runs —
    // reassert (same fallback as the draft composer)
    requestAnimationFrame(() => { if (document.activeElement !== ta) ta.focus(); });
}

// Step to the next/previous comment in document order, wrapping at the ends.
export function cycleComment(dir) {
    if (!commentsVisible()) toggleCommentsPanel(true);
    const items = (state.comments || [])
        .filter(c => state.showResolvedComments || !c.resolved)
        .map(c => {
            const anchor = anchorFor(c.id);
            return { id: c.id, y: anchor ? anchor.getBoundingClientRect().top : 0 };
        })
        .sort((a, b) => a.y - b.y);
    if (items.length === 0) return;
    let i = items.findIndex(x => x.id === state.activeCommentId);
    i = i < 0 ? (dir > 0 ? 0 : items.length - 1) : (i + dir + items.length) % items.length;
    focusComment(items[i].id, true);
}

// ──────────────────────────────────
// Creating a comment from the current selection
// ──────────────────────────────────
// Text offset of the range's start within content, clamped to [0, length].
// Works even when the range starts above or before the content element (a
// triple-click roots its endpoints on the block or the editor itself).
function startOffsetInContent(content, range) {
    const probe = document.createRange();
    probe.selectNodeContents(content);
    if (range.compareBoundaryPoints(Range.START_TO_START, probe) <= 0) return 0;
    probe.setEnd(range.startContainer, range.startOffset);
    return probe.toString().length;
}

function contentAncestor(node) {
    let e = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    while (e && e !== getEditor()) {
        if (e.classList && e.classList.contains('block-content')) return e;
        e = e.parentElement;
    }
    return null;
}

// An endpoint that sits above block-content level (the editor or a block —
// triple-click does this): the child at the offset says which block it means.
function descendToContent(node, offset) {
    const child = node.childNodes[offset];
    if (!child) return null;
    if (child.nodeType !== Node.ELEMENT_NODE) return contentAncestor(child);
    if (child.classList.contains('block-content')) return child;
    return contentOf(child.classList.contains('block') ? child : child.closest('.block'));
}

// Resolve the selection to one block-content plus a range clamped inside it.
// Triple-clicks and drag-past-the-end selections spill beyond the paragraph —
// endpoints land on the next block or on the block/editor element itself even
// though all the selected TEXT is one paragraph. Accept any spill that adds no
// text; return null for selections whose text genuinely spans blocks.
function singleBlockSelection(sel) {
    const range = sel.getRangeAt(0);
    let content = contentAncestor(range.startContainer);
    if (!content && range.startContainer.nodeType === Node.ELEMENT_NODE) {
        content = descendToContent(range.startContainer, range.startOffset);
    }
    if (!content) return null;
    const bounds = document.createRange();
    bounds.selectNodeContents(content);
    const r = range.cloneRange();
    // A start before the content holds only the block's marker/decoration,
    // never prose — clamp it in without checking what it skips
    if (r.compareBoundaryPoints(Range.START_TO_START, bounds) < 0) r.setStart(content, 0);
    if (r.compareBoundaryPoints(Range.END_TO_END, bounds) > 0) {
        const spill = range.cloneRange();
        spill.setStart(content, content.childNodes.length);
        if (spill.toString().trim()) return null;   // real text in another block
        r.setEnd(content, content.childNodes.length);
    }
    if (!r.toString().trim()) return null;
    return { content, range: r };
}

export async function addCommentOnSelection(initial = '') {
    if (state.currentDocumentIsEphemeral) {
        await showAlert('Ephemeral documents leave no record — comments live in the saved file.');
        return;
    }
    if (state.commentsRaw) {
        await showAlert('This file has a damaged comment block that thesis is preserving untouched — repair it before adding new comments.');
        return;
    }
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed || !sel.toString().trim()) {
        await showAlert('Select some text to comment on.');
        return;
    }
    const resolved = singleBlockSelection(sel);
    if (!resolved) {
        await showAlert('Select within a single paragraph to comment.');
        return;
    }
    beginDraft(resolved.content, resolved.range, sel, typeof initial === 'string' ? initial : '');
}

// Sugar over the @-mention convention: a normal comment, pre-addressed.
export async function askClaudeOnSelection() {
    return addCommentOnSelection('@claude ');
}

// A note on the whole document rather than a passage — no anchor, no
// highlight; it floats at the top of the margin. Claude's general reads land
// the same way.
export function addWholeDocumentComment(body) {
    if (state.currentDocumentIsEphemeral || state.commentsRaw || !body) return null;
    const c = {
        id: newId(),
        block: -1,
        quote: '',
        prefix: '',
        body,
        author: 'me',
        created: new Date().toISOString(),
        resolved: false,
        replies: [],
    };
    state.comments.push(c);
    state.activeCommentId = c.id;
    if (!state.commentsVisible) toggleCommentsPanel(true);
    persist();
    renderCommentUI();
    return c;
}

// Quick Comment Mode: with text selected, typing starts the comment instead of
// replacing the selection. Returns true when the keystroke was consumed.
export function quickCommentFromTyping(char) {
    if (!state.quickCommentMode) return false;
    if (state.currentDocumentIsEphemeral || state.commentsRaw) return false;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed || !sel.toString().trim()) return false;
    const resolved = singleBlockSelection(sel);
    if (!resolved) {
        // The mode's promise is that typing never replaces a selection. When
        // the selection can't take a comment, swallow the keystroke rather
        // than letting it destroy the selected text.
        showAlert('Select within a single paragraph to comment.');
        return true;
    }
    beginDraft(resolved.content, resolved.range, sel, char);
    return true;
}

export function toggleQuickCommentMode() {
    state.quickCommentMode = !state.quickCommentMode;
    localStorage.setItem('quickCommentMode', state.quickCommentMode);
}

function beginDraft(content, range, sel, initial) {
    cancelDraft(false);
    const start = startOffsetInContent(content, range);
    const quote = range.toString();
    draft = {
        blockIndex: allBlocks().indexOf(content.closest('.block')),
        start,
        quote,
        prefix: content.textContent.slice(Math.max(0, start - 30), start),
        initial: initial || '',
    };
    sel.removeAllRanges();
    if (!state.commentsVisible) toggleCommentsPanel(true);
    else renderCommentUI();
}

function buildDraftCard() {
    const card = el('div', 'comment-card draft');
    card.dataset.cmt = '__draft__';
    card.appendChild(el('div', 'comment-quote', draft.quote));
    const ta = document.createElement('textarea');
    ta.rows = 3;
    ta.placeholder = 'Comment…  (enter saves · esc cancels)';
    ta.value = draft.initial || '';
    card.appendChild(ta);
    const actions = el('div', 'comment-actions');
    const cancelBtn = el('button', 'comment-act', 'Cancel');
    cancelBtn.addEventListener('click', () => cancelDraft(true));
    const saveBtn = el('button', 'comment-act primary', 'Comment');
    saveBtn.addEventListener('click', () => saveDraft(ta.value));
    actions.appendChild(cancelBtn);
    actions.appendChild(saveBtn);
    card.appendChild(actions);
    ta.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveDraft(ta.value); }
        else if (e.key === 'Escape') { e.preventDefault(); cancelDraft(true); }
    });
    // Fallback focus: the command-menu path refocuses the editor after the
    // action runs, stealing the synchronous focus set in renderCommentUI
    requestAnimationFrame(() => {
        if (document.activeElement !== ta) {
            ta.focus();
            const L = ta.value.length;
            ta.setSelectionRange(L, L);
        }
    });
    return card;
}

// Hand focus back to the editor without letting the browser choose a scroll
// position. A bare focus() on a contenteditable with no selection invents a
// caret (usually at the document start) and scrolls to reveal it — so focus
// with preventScroll FIRST (focusing can restore a stale cached selection,
// which would clobber a caret placed before it), then place the caret
// deliberately, then do our own minimal reveal. `after` puts the caret just
// past `target` (outside a mark, so typing doesn't extend the highlight);
// otherwise it goes at the end of target's contents.
function refocusEditor(target, after) {
    getEditor().focus({ preventScroll: true });
    if (target) {
        const sel = window.getSelection();
        const r = document.createRange();
        if (after) { r.setStartAfter(target); r.collapse(true); }
        else { r.selectNodeContents(target); r.collapse(false); }
        sel.removeAllRanges();
        sel.addRange(r);
    }
    revealCaret();
}

function saveDraft(body) {
    if (!draft) return;
    body = (body || '').trim();
    const d = draft;
    draft = null;
    unwrapMarks(getEditor(), '__draft__');
    if (!body) { renderCommentUI(); refocusEditor(contentOf(allBlocks()[d.blockIndex])); return; }
    const c = {
        id: newId(),
        block: d.blockIndex,
        quote: d.quote,
        prefix: d.prefix,
        body,
        author: 'me',
        created: new Date().toISOString(),
        resolved: false,
        replies: [],
    };
    state.comments.push(c);
    state.activeCommentId = c.id;
    persist();
    renderCommentUI();
    const mark = marksFor(c.id).pop();
    refocusEditor(mark || contentOf(allBlocks()[d.blockIndex]), !!mark);
}

function cancelDraft(refocus) {
    if (!draft) return;
    const d = draft;
    draft = null;
    unwrapMarks(getEditor(), '__draft__');
    const card = cardsEl() && cardsEl().querySelector('.comment-card.draft');
    if (card) card.remove();
    if (refocus) { renderCommentUI(); refocusEditor(contentOf(allBlocks()[d.blockIndex])); }
}

// ──────────────────────────────────
// Toggles
// ──────────────────────────────────
export function toggleCommentsPanel(force) {
    state.commentsVisible = force !== undefined ? !!force : !state.commentsVisible;
    localStorage.setItem('commentsVisible', state.commentsVisible);
    renderCommentUI();
}

export function toggleResolvedComments() {
    state.showResolvedComments = !state.showResolvedComments;
    renderCommentUI();
}

// ──────────────────────────────────
// Init
// ──────────────────────────────────
export function initComments(persistFn) {
    persist = persistFn || persist;
    state.commentsVisible = localStorage.getItem('commentsVisible') !== 'false';
    state.quickCommentMode = localStorage.getItem('quickCommentMode') === 'true';

    const editor = getEditor();
    // Click a highlight → focus its card
    editor.addEventListener('click', (e) => {
        const mark = e.target.closest && e.target.closest('mark.cmt');
        if (mark && mark.dataset.cmt !== '__draft__') focusComment(mark.dataset.cmt, false);
    });
    // Keep cards aligned as the document scrolls, resizes, or reflows under
    // typing. Scroll is the hot path: syncCardScroll moves everything in one
    // transform; the rAF positionCards pass just heals any stale layout.
    editor.addEventListener('scroll', () => { syncCardScroll(); positionCards(); }, { passive: true });
    window.addEventListener('resize', positionCards);
    editor.addEventListener('input', debounce(positionCards, 120));

    // The panel has no scroll of its own — it mirrors the document. Forward
    // wheel gestures over the margin into the editor so scrolling anywhere
    // moves the one true scroll position. Once the document bottoms out, the
    // remaining travel slides just the cards (cardOverscroll), so a thread
    // stacked past the document's end is still reachable; scrolling up
    // unwinds that extra travel before the document moves again.
    panel().addEventListener('wheel', (e) => {
        e.preventDefault();
        let dy = e.deltaY;
        // Unwind any overscroll this gesture opposes before moving the document,
        // so scrolling back toward the mirror re-aligns cards with the text
        // before the document itself starts to move.
        if (cardOverscroll > 0 && dy < 0) {
            const u = Math.min(cardOverscroll, -dy);
            cardOverscroll -= u; dy += u;
        } else if (cardOverscroll < 0 && dy > 0) {
            const u = Math.min(-cardOverscroll, dy);
            cardOverscroll += u; dy -= u;
        }
        // Then scroll the document; whatever it can't absorb (either end)
        // becomes overscroll, clamped to what's actually hidden in syncCardScroll.
        if (dy !== 0) {
            const before = editor.scrollTop;
            editor.scrollTop += dy;
            const leftover = dy - (editor.scrollTop - before);
            if (leftover !== 0) cardOverscroll += leftover;
        }
        syncCardScroll();
        positionCards();
    }, { passive: false });

    const resolvedToggle = document.getElementById('comments-resolved-toggle');
    if (resolvedToggle) resolvedToggle.addEventListener('click', toggleResolvedComments);

    // ‹ › cycle buttons; mousedown-preventDefault keeps focus in the editor
    // so the keyboard shortcuts still work after a click
    for (const [btnId, dir] of [['comments-prev', -1], ['comments-next', 1]]) {
        const btn = document.getElementById(btnId);
        if (!btn) continue;
        btn.addEventListener('mousedown', (e) => e.preventDefault());
        btn.addEventListener('click', () => cycleComment(dir));
    }

    renderCommentUI();
}
