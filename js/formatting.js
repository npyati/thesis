// Text formatting — replaces deprecated document.execCommand with DOM manipulation

import { getCurrentBlock } from './blocks.js';

// Apply bold/italic/strikethrough using DOM ranges instead of execCommand
const TAG_ALIASES = {
    strong: ['strong', 'b'],
    em: ['em', 'i'],
    strike: ['strike', 's', 'del'],
};

function unwrapElement(el) {
    const parent = el.parentNode;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
}

function formatElementFor(node, aliases) {
    const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    return el ? el.closest(aliases.join(',')) : null;
}

// Character offset of (container, offset) measured from the start of root
function charOffsetIn(root, container, offset) {
    const probe = document.createRange();
    probe.selectNodeContents(root);
    probe.setEnd(container, offset);
    return probe.toString().length;
}

// Inverse of charOffsetIn: the text position `target` characters into root
function pointAtChar(root, target) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let acc = 0;
    let node;
    while ((node = walker.nextNode())) {
        const len = node.textContent.length;
        if (acc + len >= target) return [node, target - acc];
        acc += len;
    }
    return [root, root.childNodes.length];
}

// Text nodes that genuinely overlap the range — a boundary merely touching a
// node doesn't count. (WebKit often puts selection boundaries at element
// edges where Chrome uses inner text nodes, so ancestor checks alone fail.)
function textNodesInRange(range) {
    const container = range.commonAncestorContainer;
    const root = container.nodeType === Node.TEXT_NODE ? container.parentElement : container;
    if (!root) return [];

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let node;
    while ((node = walker.nextNode())) {
        if (!node.textContent.length) continue;
        const nodeRange = document.createRange();
        nodeRange.selectNodeContents(node);
        // overlap > 0 ⇔ range.end > node.start && range.start < node.end
        if (range.compareBoundaryPoints(Range.START_TO_END, nodeRange) > 0 &&
            range.compareBoundaryPoints(Range.END_TO_START, nodeRange) < 0) {
            nodes.push(node);
        }
    }
    return nodes;
}

// Clamp `range` to the inline content of a single .block-content. A boundary
// that lands outside the block (the selection reaches in from a neighbouring
// block, or is anchored on .block / #editor after Select-All) snaps to this
// block's own edge. Returns null when nothing of the range falls inside `bc`.
function rangeWithinBlock(range, bc) {
    const sub = document.createRange();
    sub.selectNodeContents(bc);
    if (bc.contains(range.startContainer)) sub.setStart(range.startContainer, range.startOffset);
    if (bc.contains(range.endContainer)) sub.setEnd(range.endContainer, range.endOffset);
    return sub.collapsed ? null : sub;
}

export function applyFormatting(format) {
    const selection = window.getSelection();
    if (!selection.rangeCount || selection.isCollapsed) return;

    const range = selection.getRangeAt(0);

    // Map format names to HTML elements
    const tagMap = {
        bold: 'strong',
        italic: 'em',
        strikethrough: 'strike',
    };

    const tag = tagMap[format];
    if (!tag) return;
    const aliases = TAG_ALIASES[tag];

    const editor = document.getElementById('editor');

    // Formatting is inline — it must live INSIDE a .block-content, wrapping only
    // text. Split a (possibly cross-block) selection into one range per block it
    // touches, each clamped to that block. Wrapping the selection as one span
    // would otherwise pull whole .block / .block-content divs into a <strong>,
    // which the browser then lays out as its own broken block.
    const targets = [];
    editor.querySelectorAll('.block-content').forEach(bc => {
        if (!range.intersectsNode(bc)) return;
        const sub = rangeWithinBlock(range, bc);
        if (sub) targets.push({ bc, sub });
    });
    if (targets.length === 0) return;

    // Toggle direction is global: only strip formatting when every block's slice
    // is already fully wrapped; otherwise apply it everywhere.
    const fullyFormatted = targets.every(({ sub }) => {
        const nodes = textNodesInRange(sub);
        return nodes.length > 0 && nodes.every(n => formatElementFor(n, aliases));
    });

    // Record each slice as character offsets within its own block-content so the
    // selection survives the DOM surgery — formatting adds no text, so offsets
    // stay valid even after extractContents()/normalize() move nodes around.
    targets.forEach(t => {
        t.startChar = charOffsetIn(t.bc, t.sub.startContainer, t.sub.startOffset);
        t.endChar = charOffsetIn(t.bc, t.sub.endContainer, t.sub.endOffset);
    });

    targets.forEach(({ bc, sub }) => {
        if (fullyFormatted) {
            // Remove: unwrap every format element the slice touches (a
            // partially-selected run is unwrapped whole)
            const nodes = textNodesInRange(sub);
            const els = [...new Set(nodes.map(n => formatElementFor(n, aliases)))].filter(Boolean);
            els.forEach(unwrapElement);
        } else {
            // Apply: wrap the slice, stripping any same-format elements inside it
            // first so repeated toggling can never nest tags
            const wrapper = document.createElement(tag);
            const fragment = sub.extractContents();
            fragment.querySelectorAll(aliases.join(',')).forEach(unwrapElement);
            wrapper.appendChild(fragment);
            sub.insertNode(wrapper);
        }
        bc.normalize();
    });

    // Sweep empty format shells — extractContents leaves one behind when a
    // selection starts or ends inside an existing format element
    editor.querySelectorAll('strong, b, em, i, strike, s, del').forEach(el => {
        if (el.textContent === '' && !el.querySelector('br')) el.remove();
    });

    // Restore the selection over the same characters: first block's start to the
    // last block's end. Works whether one block or many were touched.
    const first = targets[0];
    const last = targets[targets.length - 1];
    const [startNode, startOffset] = pointAtChar(first.bc, first.startChar);
    const [endNode, endOffset] = pointAtChar(last.bc, last.endChar);
    try {
        const restored = document.createRange();
        restored.setStart(startNode, startOffset);
        restored.setEnd(endNode, endOffset);
        selection.removeAllRanges();
        selection.addRange(restored);
    } catch (e) {
        // Best-effort — a failed restore just leaves the caret where it was
    }

    editor.focus();
}

// Strikethrough the last word before cursor
export function strikethroughLastWord() {
    const selection = window.getSelection();
    if (!selection.rangeCount) return;

    const currentBlock = getCurrentBlock();
    if (!currentBlock) return;

    const contentEl = currentBlock.querySelector('.block-content');
    if (!contentEl) return;

    const fullText = contentEl.textContent;
    const range = selection.getRangeAt(0);
    let cursorOffset = 0;
    {
        const walker = document.createTreeWalker(contentEl, NodeFilter.SHOW_TEXT, null, false);
        let currentNode;
        let found = false;
        while (currentNode = walker.nextNode()) {
            if (currentNode === range.startContainer) {
                cursorOffset += range.startOffset;
                found = true;
                break;
            }
            cursorOffset += currentNode.textContent.length;
        }
        if (!found) cursorOffset = fullText.length;
    }

    const textBeforeCursor = fullText.substring(0, cursorOffset);
    const wordMatch = textBeforeCursor.match(/\S+(?=\s*$)/);
    if (!wordMatch) return;

    const word = wordMatch[0].trim();
    const wordStartOffset = textBeforeCursor.lastIndexOf(word);
    const wordEndOffset = wordStartOffset + word.length;

    const extractedWord = fullText.substring(wordStartOffset, wordEndOffset);
    if (extractedWord !== word || /\s/.test(extractedWord)) return;

    // Find text nodes for the word boundaries
    let startNode = null, startOffset = 0;
    let endNode = null, endOffset = 0;
    let currentOffset = 0;
    let currentNode;

    const walker2 = document.createTreeWalker(contentEl, NodeFilter.SHOW_TEXT, null, false);

    while (currentNode = walker2.nextNode()) {
        const nodeLength = currentNode.textContent.length;

        if (startNode === null && currentOffset + nodeLength > wordStartOffset) {
            startNode = currentNode;
            startOffset = wordStartOffset - currentOffset;
        }

        if (currentOffset + nodeLength >= wordEndOffset) {
            endNode = currentNode;
            endOffset = wordEndOffset - currentOffset;
            break;
        }

        currentOffset += nodeLength;
    }

    if (!startNode || !endNode) return;

    // Insert cursor marker
    const marker = document.createElement('span');
    marker.id = 'cursor-marker-temp';
    marker.style.display = 'inline';
    marker.textContent = '';

    const markerRange = range.cloneRange();
    markerRange.collapse(true);
    markerRange.insertNode(marker);

    // Wrap word in <strike>
    const wordRange = document.createRange();
    wordRange.setStart(startNode, startOffset);
    wordRange.setEnd(endNode, endOffset);

    const strikeEl = document.createElement('strike');
    try {
        wordRange.surroundContents(strikeEl);
    } catch (e) {
        const fragment = wordRange.extractContents();
        strikeEl.appendChild(fragment);
        wordRange.insertNode(strikeEl);
    }

    // Restore cursor at marker
    try {
        const foundMarker = contentEl.querySelector('#cursor-marker-temp');
        if (foundMarker && foundMarker.parentNode) {
            const breakSpace = document.createTextNode('\u200B');
            foundMarker.parentNode.insertBefore(breakSpace, foundMarker);

            const finalRange = document.createRange();
            finalRange.setStartAfter(breakSpace);
            finalRange.collapse(true);
            selection.removeAllRanges();
            selection.addRange(finalRange);

            foundMarker.remove();
        }
    } catch (e) {
        console.error('Error restoring cursor:', e);
    }

    document.getElementById('editor').focus();
}

// Delete all struck-through text
export function deleteAllStrikethrough() {
    const editor = document.getElementById('editor');
    const allBlocks = Array.from(editor.querySelectorAll('.block'));

    allBlocks.forEach(block => {
        const contentEl = block.querySelector('.block-content');
        if (!contentEl) return;
        contentEl.querySelectorAll('strike, s').forEach(strike => strike.remove());
    });

    editor.focus();
}
