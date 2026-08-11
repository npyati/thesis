// Block management — creation, focus, numbering, deletion

export function getEditor() {
    return document.getElementById('editor');
}

// ──────────────────────────────────
// Structure repair
// ──────────────────────────────────
// The invariant every handler assumes: the editor's children are .block divs
// (plus center-mode spacers), each holding exactly one .block-content. WebKit
// owns the editing paths we don't intercept — forward delete at a block's end,
// deleting a selection that spans blocks, cut, dictation — and its native
// surgery doesn't know that structure. The damage it leaves (a bare div at
// editor level, a block shell missing its content, one block nested inside
// another's) renders as a blank line no handler can reach, because they all
// bail when the structure under the caret isn't a well-formed block. Reload
// used to be the only cure — the serializer reads only well-formed blocks, so
// the junk never made it into the file. This repairs the same invariant in
// place, and only touches the DOM when something is actually broken.
export function normalizeBlocks() {
    const editor = getEditor();

    // Fast path: scan without mutating; the overwhelmingly common case is a
    // clean document, and this must be cheap enough to run on every input.
    let broken = false;
    for (const child of editor.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) { if (child.textContent.trim()) { broken = true; break; } continue; }
        if (child.nodeType !== Node.ELEMENT_NODE) continue;
        if (child.hasAttribute('data-spacer')) continue;
        const content = child.classList.contains('block') && child.querySelector(':scope > .block-content');
        if (!content || content.childNodes.length === 0) { broken = true; break; }
    }
    if (!broken && !editor.querySelector('.block-content .block, .block-content .block-content')) return false;

    const caretWasIn = (() => {
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount) return null;
        const n = sel.getRangeAt(0).startContainer;
        return n.nodeType === Node.TEXT_NODE ? n.parentElement : n;
    })();
    let caretLost = false;
    const dropping = (node) => { if (caretWasIn && node.contains(caretWasIn)) caretLost = true; };

    // 1. Editor-level strays. Anything carrying text becomes a real block —
    //    the writer's words survive the repair; empty shells just go.
    for (const child of Array.from(editor.childNodes)) {
        if (child.nodeType === Node.ELEMENT_NODE) {
            if (child.classList.contains('block') || child.hasAttribute('data-spacer')) continue;
            dropping(child);
            if (child.textContent && child.textContent.trim()) {
                const nb = createBlockElement('text', '');
                nb.querySelector('.block-content').replaceChildren(...child.childNodes);
                editor.replaceChild(nb, child);
            } else {
                child.remove();
            }
        } else if (child.nodeType === Node.TEXT_NODE) {
            if (child.textContent.trim()) {
                const nb = createBlockElement('text', '');
                nb.querySelector('.block-content').textContent = child.textContent;
                dropping(child);
                editor.replaceChild(nb, child);
            } else {
                child.remove();
            }
        }
    }

    // 2. Every block holds exactly one content div. A shell that lost its
    //    content in a native merge gets it back (adopting whatever loose nodes
    //    the merge left behind); a shell with nothing to say is removed.
    for (const block of Array.from(editor.querySelectorAll(':scope > .block'))) {
        if (!block.querySelector(':scope > .block-content')) {
            const loose = Array.from(block.childNodes).filter((n) => !(n.nodeType === Node.ELEMENT_NODE && n.classList.contains('block-marker')));
            if (loose.some((n) => n.textContent && n.textContent.trim())) {
                const content = document.createElement('div');
                content.className = 'block-content';
                content.setAttribute('contenteditable', 'true');
                loose.forEach((n) => content.appendChild(n));
                block.appendChild(content);
            } else {
                dropping(block);
                block.remove();
            }
        }
    }

    // 3. No block structure nested inside content — flatten to the text
    for (const nested of Array.from(editor.querySelectorAll('.block-content .block, .block-content .block-content'))) {
        if (!nested.parentNode) continue;   // already unwrapped via an ancestor
        nested.querySelectorAll(':scope > .block-marker, .block-marker').forEach((m) => m.remove());
        nested.replaceWith(...nested.childNodes);
    }

    // 4. Visibly empty content still needs its <br>, or the block collapses to
    //    zero height — present in the file but impossible to click into
    for (const content of editor.querySelectorAll(':scope > .block > .block-content')) {
        if (content.childNodes.length === 0) content.innerHTML = '<br>';
    }

    // Caret rescue: if the repair removed the node the caret lived in, land it
    // at the end of the last block rather than leaving it in the bare editor
    if (caretLost) {
        const blocks = editor.querySelectorAll(':scope > .block');
        if (blocks.length > 0) focusBlock(blocks[blocks.length - 1], true);
    }
    return true;
}

// Get current block element from cursor position
export function getCurrentBlock() {
    const selection = window.getSelection();
    if (selection.rangeCount === 0) return null;

    const node = selection.getRangeAt(0).startContainer;
    let element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;

    while (element && element !== getEditor()) {
        if (element.classList && element.classList.contains('block')) {
            return element;
        }
        element = element.parentElement;
    }
    return null;
}

// Get all blocks intersecting the current selection
export function getSelectedBlocks() {
    const selection = window.getSelection();
    if (!selection.rangeCount) return [];

    const range = selection.getRangeAt(0);
    const allBlocks = Array.from(getEditor().querySelectorAll('.block'));
    return allBlocks.filter(block => range.intersectsNode(block));
}

// Create a new block DOM element
export function createBlockElement(type = 'text', content = '', level = 0) {
    const block = document.createElement('div');
    block.className = `block block-${type}`;
    block.dataset.type = type;
    block.dataset.level = level;

    let html = '';

    if (type === 'bullet') {
        html += '<span class="block-marker bullet-marker" contenteditable="false" aria-hidden="true">•</span>';
    } else if (type === 'numbered') {
        html += '<span class="block-marker number-marker" contenteditable="false" aria-hidden="true">1.</span>';
    }

    const contentHtml = content || '<br>';
    html += `<div class="block-content" contenteditable="true">${contentHtml}</div>`;

    block.innerHTML = html;
    return block;
}

// Update all numbered block markers with hierarchical numbering
export function updateNumberedBlocks() {
    const allBlocks = Array.from(getEditor().querySelectorAll('.block'));
    const counters = [];

    allBlocks.forEach(block => {
        if (block.dataset.type === 'numbered') {
            const level = parseInt(block.dataset.level) || 0;

            while (counters.length <= level) {
                counters.push(0);
            }

            counters[level]++;

            for (let i = level + 1; i < counters.length; i++) {
                counters[i] = 0;
            }

            const numberParts = counters.slice(0, level + 1).filter(n => n > 0);
            const numberString = numberParts.join('.') + '.';

            const marker = block.querySelector('.number-marker');
            if (marker) {
                marker.textContent = numberString;
            }
        } else {
            counters.length = 0;
        }
    });
}

// Scroll the editor the minimum needed to keep the caret visible. WebKit's own
// caret-reveal stops firing once the selection has been placed programmatically
// (comment save, undo restore), so anything that moves the caret asserts this.
export function revealCaret() {
    const editor = getEditor();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    if (!editor.contains(range.startContainer)) return;
    let rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
        // Collapsed ranges at element boundaries report a zero rect — measure
        // the nearest element instead
        const node = range.startContainer;
        const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
        if (!el) return;
        rect = el.getBoundingClientRect();
    }
    const box = editor.getBoundingClientRect();
    const pad = 32;
    if (rect.top < box.top + pad) editor.scrollTop -= (box.top + pad) - rect.top;
    else if (rect.bottom > box.bottom - pad) editor.scrollTop += rect.bottom - (box.bottom - pad);
}

// Focus a block element, optionally at the end
export function focusBlock(blockElement, atEnd = false) {
    // Bail before touching the selection — clearing it with no valid target loses the caret
    if (!blockElement || !blockElement.querySelector('.block-content')) return;

    const selection = window.getSelection();
    selection.removeAllRanges();

    requestAnimationFrame(() => {
        const contentEl = blockElement.querySelector('.block-content');
        if (!contentEl) return;

        const range = document.createRange();

        if (atEnd) {
            try {
                range.selectNodeContents(contentEl);
                range.collapse(false);
                selection.removeAllRanges();
                selection.addRange(range);
            } catch (e) {
                console.error('Focus error:', e);
            }
        } else {
            let textNode;
            if (contentEl.childNodes.length === 0) {
                textNode = document.createTextNode('');
                contentEl.appendChild(textNode);
            } else if (contentEl.childNodes.length === 1 && contentEl.firstChild.nodeName === 'BR') {
                textNode = document.createTextNode('');
                contentEl.insertBefore(textNode, contentEl.firstChild);
            } else {
                textNode = Array.from(contentEl.childNodes).find(n => n.nodeType === Node.TEXT_NODE);
                if (!textNode) {
                    textNode = document.createTextNode('');
                    contentEl.insertBefore(textNode, contentEl.firstChild);
                }
            }

            try {
                range.setStart(textNode, 0);
                range.collapse(true);
                selection.removeAllRanges();
                selection.addRange(range);
            } catch (e) {
                console.error('Focus error:', e);
            }
        }
    });
}
