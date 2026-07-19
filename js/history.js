// Snapshot-based undo/redo.
// Native contenteditable undo can't track the app's DOM surgery (block splits,
// merges, type changes, ephemeral trimming), so undo is intercepted and editor
// state restored from snapshots instead.

import { getEditor } from './blocks.js';

const MAX_STACK = 100;
const TYPING_DEBOUNCE_MS = 500;

let undoStack = [];
let redoStack = [];
let pendingTimer = null;
let lastRecordedHTML = null;

function serialize() {
    const editor = getEditor();
    const clone = editor.cloneNode(true);
    clone.querySelectorAll('[data-spacer]').forEach(s => s.remove());
    return { html: clone.innerHTML, cursor: serializeCursor() };
}

// Cursor as { blockIndex, offset } — offset is a text offset within block-content
function serializeCursor() {
    const editor = getEditor();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    let el = range.startContainer.nodeType === Node.TEXT_NODE
        ? range.startContainer.parentElement
        : range.startContainer;
    let block = null;
    while (el && el !== editor) {
        if (el.classList && el.classList.contains('block')) { block = el; break; }
        el = el.parentElement;
    }
    if (!block) return null;
    const blocks = Array.from(editor.querySelectorAll('.block'));
    const blockIndex = blocks.indexOf(block);
    const content = block.querySelector('.block-content');
    if (!content) return null;

    let offset = 0;
    let found = false;
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
        if (node === range.startContainer) { offset += range.startOffset; found = true; break; }
        offset += node.textContent.length;
    }
    if (!found) {
        if (range.startContainer === content) {
            offset = 0;
            for (let i = 0; i < range.startOffset && i < content.childNodes.length; i++) {
                offset += content.childNodes[i].textContent.length;
            }
        } else {
            offset = content.textContent.length;
        }
    }
    return { blockIndex, offset };
}

function restoreCursor(cursor) {
    const editor = getEditor();
    if (!cursor) return;
    const blocks = editor.querySelectorAll('.block');
    if (!blocks.length) return;
    const block = blocks[Math.min(cursor.blockIndex, blocks.length - 1)];
    const content = block.querySelector('.block-content');
    if (!content) return;

    let remaining = cursor.offset;
    let target = null, targetOffset = 0;
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
        if (remaining <= node.textContent.length) { target = node; targetOffset = remaining; break; }
        remaining -= node.textContent.length;
    }
    const range = document.createRange();
    if (target) range.setStart(target, targetOffset);
    else { range.selectNodeContents(content); range.collapse(false); }
    range.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
}

function applySnapshot(snap) {
    getEditor().innerHTML = snap.html;
    restoreCursor(snap.cursor);
    lastRecordedHTML = snap.html;
}

// Record a checkpoint now. Call BEFORE structural mutations; also called by the
// typing debounce. No-op if content is unchanged since the last checkpoint.
export function recordCheckpoint() {
    clearTimeout(pendingTimer);
    pendingTimer = null;
    const snap = serialize();
    if (snap.html === lastRecordedHTML) return;
    undoStack.push(snap);
    if (undoStack.length > MAX_STACK) undoStack.shift();
    lastRecordedHTML = snap.html;
    redoStack = [];
}

// Debounced checkpoint for typing bursts — call from the input handler
export function scheduleCheckpoint() {
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(recordCheckpoint, TYPING_DEBOUNCE_MS);
}

export function undo() {
    clearTimeout(pendingTimer);
    pendingTimer = null;
    const current = serialize();
    let target = undoStack.pop();
    if (target && target.html === current.html) target = undoStack.pop();
    if (!target) {
        // Nothing older than the current state — put it back (directly, so the
        // redo stack survives)
        undoStack.push(current);
        lastRecordedHTML = current.html;
        return false;
    }
    redoStack.push(current);
    applySnapshot(target);
    return true;
}

export function redo() {
    const target = redoStack.pop();
    if (!target) return false;
    const current = serialize();
    if (current.html !== target.html) undoStack.push(current);
    applySnapshot(target);
    return true;
}

// Clear all history — call when the document is wholesale replaced (file load)
export function resetHistory() {
    clearTimeout(pendingTimer);
    pendingTimer = null;
    undoStack = [];
    redoStack = [];
    lastRecordedHTML = null;
    recordCheckpoint();
}
