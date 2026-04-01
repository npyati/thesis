// Text formatting — replaces deprecated document.execCommand with DOM manipulation

import { getCurrentBlock } from './blocks.js';

// Apply bold/italic/strikethrough using DOM ranges instead of execCommand
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

    // Check if selection is already wrapped in this format
    const parentEl = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
        ? range.commonAncestorContainer.parentElement
        : range.commonAncestorContainer;

    const existingFormat = parentEl.closest(tag) || parentEl.closest(tag === 'strong' ? 'b' : tag === 'em' ? 'i' : 's');

    if (existingFormat) {
        // Remove formatting: unwrap the element
        const parent = existingFormat.parentNode;
        while (existingFormat.firstChild) {
            parent.insertBefore(existingFormat.firstChild, existingFormat);
        }
        parent.removeChild(existingFormat);
        // Normalize to merge adjacent text nodes
        parent.normalize();
    } else {
        // Apply formatting: wrap selection in element
        const wrapper = document.createElement(tag);
        try {
            range.surroundContents(wrapper);
        } catch (e) {
            // surroundContents fails on partial element selections
            // Fall back to extracting and re-inserting
            const fragment = range.extractContents();
            wrapper.appendChild(fragment);
            range.insertNode(wrapper);
        }
        // Re-select the wrapped content
        selection.removeAllRanges();
        const newRange = document.createRange();
        newRange.selectNodeContents(wrapper);
        selection.addRange(newRange);
    }

    document.getElementById('editor').focus();
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
