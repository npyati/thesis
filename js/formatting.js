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
    const nodes = textNodesInRange(range);
    const fullyFormatted = nodes.length > 0 && nodes.every(n => formatElementFor(n, aliases));

    if (fullyFormatted) {
        // Remember the selection as character offsets in a stable ancestor —
        // unwrapping moves nodes and normalize() merges them, which would
        // otherwise collapse the selection to the end of the block
        const anchorEl = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
            ? range.commonAncestorContainer.parentElement
            : range.commonAncestorContainer;
        const stableRoot = (anchorEl && anchorEl.closest('.block-content')) || editor;
        const startChar = charOffsetIn(stableRoot, range.startContainer, range.startOffset);
        const endChar = charOffsetIn(stableRoot, range.endContainer, range.endOffset);

        // Remove formatting: unwrap every format element the selection touches
        // (a partially-selected run is unwrapped whole)
        const els = [...new Set(nodes.map(n => formatElementFor(n, aliases)))];
        els.forEach(unwrapElement);
        // Normalize to merge adjacent text nodes
        editor.normalize();

        // Restore the selection over the same characters
        const [startNode, startOffset] = pointAtChar(stableRoot, startChar);
        const [endNode, endOffset] = pointAtChar(stableRoot, endChar);
        const restored = document.createRange();
        restored.setStart(startNode, startOffset);
        restored.setEnd(endNode, endOffset);
        selection.removeAllRanges();
        selection.addRange(restored);
    } else {
        // Apply formatting: wrap selection, stripping any same-format elements
        // inside it first so repeated toggling can never nest tags
        const wrapper = document.createElement(tag);
        const fragment = range.extractContents();
        fragment.querySelectorAll(aliases.join(',')).forEach(unwrapElement);
        wrapper.appendChild(fragment);
        range.insertNode(wrapper);
        // Re-select the wrapped content
        selection.removeAllRanges();
        const newRange = document.createRange();
        newRange.selectNodeContents(wrapper);
        selection.addRange(newRange);
    }

    // Sweep empty format shells — extractContents leaves one behind when a
    // selection starts or ends inside an existing format element
    editor.querySelectorAll('strong, b, em, i, strike, s, del').forEach(el => {
        if (el.textContent === '' && !el.querySelector('br')) el.remove();
    });

    editor.focus();
}

// Strikethrough the last word before cursor
export function strikethroughLastWord(savedCursorOffset = null) {
    const selection = window.getSelection();
    if (!selection.rangeCount) return;

    const currentBlock = getCurrentBlock();
    if (!currentBlock) return;

    const contentEl = currentBlock.querySelector('.block-content');
    if (!contentEl) return;

    const fullText = contentEl.textContent;
    const range = selection.getRangeAt(0);
    let cursorOffset = savedCursorOffset;

    if (cursorOffset === null) {
        cursorOffset = 0;
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
