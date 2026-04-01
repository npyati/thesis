// Block management — creation, focus, numbering, deletion

export function getEditor() {
    return document.getElementById('editor');
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

// Focus a block element, optionally at the end
export function focusBlock(blockElement, atEnd = false) {
    if (!blockElement) return;

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
