// Find-in-document. Uses the CSS Custom Highlight API where available so
// matches are highlighted without touching the DOM (contenteditable-safe);
// falls back to selecting the current match elsewhere.

import { getEditor } from './blocks.js';

const supportsHighlights = typeof CSS !== 'undefined' && 'highlights' in CSS;

let matches = [];
let currentIndex = 0;

// Search all block content for a case-insensitive substring. Returns {total, index}.
export function search(query) {
    matches = [];
    currentIndex = 0;
    if (query) {
        const q = query.toLowerCase();
        getEditor().querySelectorAll('.block-content').forEach(content => {
            const nodes = [];
            let text = '';
            const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
            let node;
            while ((node = walker.nextNode())) {
                nodes.push({ node, start: text.length });
                text += node.textContent;
            }
            const lower = text.toLowerCase();
            let idx = lower.indexOf(q);
            while (idx !== -1) {
                const range = document.createRange();
                setPoint(range, 'start', nodes, idx);
                setPoint(range, 'end', nodes, idx + q.length);
                matches.push(range);
                idx = lower.indexOf(q, idx + q.length);
            }
        });
    }
    updateHighlights();
    if (matches.length) scrollToCurrent();
    return { total: matches.length, index: currentIndex };
}

function setPoint(range, which, nodes, offset) {
    for (let i = nodes.length - 1; i >= 0; i--) {
        const { node, start } = nodes[i];
        if (offset >= start) {
            const local = Math.min(offset - start, node.textContent.length);
            if (which === 'start') range.setStart(node, local);
            else range.setEnd(node, local);
            return;
        }
    }
}

export function next() { return step(1); }
export function prev() { return step(-1); }

function step(delta) {
    if (matches.length) {
        currentIndex = (currentIndex + delta + matches.length) % matches.length;
        updateHighlights();
        scrollToCurrent();
    }
    return { total: matches.length, index: currentIndex };
}

function updateHighlights() {
    if (supportsHighlights) {
        CSS.highlights.delete('find-match');
        CSS.highlights.delete('find-current');
        if (matches.length) {
            CSS.highlights.set('find-match', new Highlight(...matches));
            CSS.highlights.set('find-current', new Highlight(matches[currentIndex]));
        }
    } else if (matches.length) {
        // Fallback: show the current match as the document selection
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(matches[currentIndex].cloneRange());
    }
}

function scrollToCurrent() {
    const container = matches[currentIndex].startContainer;
    const el = container.nodeType === Node.TEXT_NODE ? container.parentElement : container;
    el?.scrollIntoView({ block: 'center' });
}

// Close the find session. With commit=true, the cursor lands at the current match.
export function close(commit) {
    if (supportsHighlights) {
        CSS.highlights.delete('find-match');
        CSS.highlights.delete('find-current');
    }
    if (commit && matches.length) {
        const range = matches[currentIndex].cloneRange();
        range.collapse(false);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    }
    matches = [];
    currentIndex = 0;
}
