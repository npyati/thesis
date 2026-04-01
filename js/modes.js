// View modes: forward-only, center, focus, ephemeral, canvas, dark, fullscreen

import state from './state.js';
import { getEditor, getCurrentBlock, createBlockElement, focusBlock, updateNumberedBlocks } from './blocks.js';
import { debounce } from './utils.js';

// ──────────────────────────────────
// Forward-only mode
// ──────────────────────────────────
export function toggleForwardOnlyMode() {
    state.forwardOnlyMode = !state.forwardOnlyMode;
    document.body.classList.toggle('forward-only-mode', state.forwardOnlyMode);
    localStorage.setItem('forwardOnlyMode', state.forwardOnlyMode);
}

// ──────────────────────────────────
// Center mode
// ──────────────────────────────────
export function toggleCenterMode() {
    state.centerMode = !state.centerMode;
    document.body.classList.toggle('center-mode', state.centerMode);

    if (state.centerMode) {
        addCenterModeSpacers();
    } else {
        removeCenterModeSpacers();
    }

    localStorage.setItem('centerMode', state.centerMode);
}

export function addCenterModeSpacers() {
    const editor = getEditor();
    removeCenterModeSpacers();

    const makeSpacer = (id, focusFirst) => {
        const spacer = document.createElement('div');
        spacer.id = id;
        spacer.style.height = '100vh';
        spacer.style.userSelect = 'none';
        spacer.style.cursor = 'default';
        spacer.setAttribute('contenteditable', 'false');
        spacer.setAttribute('data-spacer', 'true');
        spacer.setAttribute('aria-hidden', 'true');

        spacer.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const blocks = Array.from(editor.querySelectorAll('.block'));
            if (blocks.length > 0) {
                focusBlock(focusFirst ? blocks[0] : blocks[blocks.length - 1], !focusFirst);
            }
        });
        return spacer;
    };

    editor.insertBefore(makeSpacer('center-mode-top-spacer', true), editor.firstChild);
    editor.appendChild(makeSpacer('center-mode-bottom-spacer', false));
}

export function removeCenterModeSpacers() {
    document.getElementById('center-mode-top-spacer')?.remove();
    document.getElementById('center-mode-bottom-spacer')?.remove();
}

export function centerCurrentBlock(instant = false) {
    if (!state.centerMode) return;

    const currentBlock = getCurrentBlock();
    if (!currentBlock) return;

    const editor = getEditor();
    const blockRect = currentBlock.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const targetPositionFromTop = viewportHeight * 0.38;
    const scrollTarget = editor.scrollTop + (blockRect.top - targetPositionFromTop);

    editor.scrollTo({
        top: scrollTarget,
        behavior: instant ? 'auto' : 'smooth'
    });
}

// ──────────────────────────────────
// Focus mode (with debounced updates)
// ──────────────────────────────────
export function toggleFocusMode() {
    state.focusMode = !state.focusMode;
    document.body.classList.toggle('focus-mode', state.focusMode);
    localStorage.setItem('focusMode', state.focusMode);

    if (state.focusMode) {
        updateFocusParagraph();
    } else {
        const allBlocks = getEditor().querySelectorAll('.block');
        allBlocks.forEach(el => {
            el.classList.remove('focus-active');
            el.style.opacity = '';
        });
    }
}

let _lastFocusedBlock = null;

export function updateFocusParagraph() {
    if (!state.focusMode) return;

    const currentBlock = getCurrentBlock();
    if (!currentBlock || currentBlock === _lastFocusedBlock) return;
    _lastFocusedBlock = currentBlock;

    const allBlocks = Array.from(getEditor().querySelectorAll('.block'));
    const currentIndex = allBlocks.indexOf(currentBlock);
    if (currentIndex === -1) return;

    allBlocks.forEach((block, index) => {
        block.classList.remove('focus-active');
        const distance = Math.abs(index - currentIndex);
        let opacity;
        if (distance === 0) {
            opacity = 1.0;
            block.classList.add('focus-active');
        } else if (distance === 1) {
            opacity = 0.35;
        } else if (distance === 2) {
            opacity = 0.15;
        } else {
            opacity = 0.08;
        }
        block.style.setProperty('opacity', opacity, 'important');
    });
}

// Debounced version for input events
export const debouncedUpdateFocusParagraph = debounce(updateFocusParagraph, 50);

// ──────────────────────────────────
// Ephemeral mode
// ──────────────────────────────────
export function createNewEphemeralDocument(autoSaveFn) {
    const editor = getEditor();
    editor.innerHTML = '';
    const firstBlock = createBlockElement('text', '');
    editor.appendChild(firstBlock);

    state.currentDocumentIsEphemeral = true;
    state.currentDocumentName = null;
    state.currentFileHandle = null;
    state.currentFileName = null;

    clearURL();
    clearPageTitle();
    focusBlock(firstBlock);
    if (autoSaveFn) autoSaveFn();

    if (state.centerMode) {
        setTimeout(() => {
            addCenterModeSpacers();
            setTimeout(() => centerCurrentBlock(true), 50);
        }, 50);
    }
}

export function enforceEphemeralLimit() {
    if (!state.currentDocumentIsEphemeral) return;

    const editor = getEditor();
    const selection = window.getSelection();
    let currentBlock = null;

    if (selection.rangeCount > 0) {
        let node = selection.getRangeAt(0).startContainer;
        while (node && node !== editor) {
            if (node.classList && node.classList.contains('block')) {
                currentBlock = node;
                break;
            }
            node = node.parentNode;
        }
    }

    const allBlocks = Array.from(editor.querySelectorAll('.block'));
    let totalWords = 0;
    const blockWordCounts = [];

    allBlocks.forEach(block => {
        const content = block.querySelector('.block-content');
        if (content) {
            const text = content.textContent || '';
            const words = text.trim().split(/\s+/).filter(w => w.length > 0);
            blockWordCounts.push({ block, wordCount: words.length });
            totalWords += words.length;
        } else {
            blockWordCounts.push({ block, wordCount: 0 });
        }
    });

    if (totalWords > state.EPHEMERAL_WORD_LIMIT) {
        const wordsToRemove = totalWords - state.EPHEMERAL_WORD_LIMIT;
        let wordsRemoved = 0;
        let currentBlockWasModified = false;

        for (let i = 0; i < blockWordCounts.length && wordsRemoved < wordsToRemove; i++) {
            const { block, wordCount } = blockWordCounts[i];
            const content = block.querySelector('.block-content');
            if (!content) continue;

            if (wordsRemoved + wordCount <= wordsToRemove) {
                if (block === currentBlock) currentBlockWasModified = true;
                block.remove();
                wordsRemoved += wordCount;
            } else {
                if (block === currentBlock) currentBlockWasModified = true;
                const wordsToRemoveFromBlock = wordsToRemove - wordsRemoved;
                const text = content.textContent || '';
                const words = text.trim().split(/\s+/).filter(w => w.length > 0);
                content.textContent = words.slice(wordsToRemoveFromBlock).join(' ');
                wordsRemoved += wordsToRemoveFromBlock;
            }
        }

        updateNumberedBlocks();

        if (currentBlockWasModified) {
            if (currentBlock && currentBlock.parentNode) {
                const content = currentBlock.querySelector('.block-content');
                if (content && content.firstChild) {
                    try {
                        const range = document.createRange();
                        const textNode = content.firstChild;
                        range.setStart(textNode, textNode.length);
                        range.collapse(true);
                        selection.removeAllRanges();
                        selection.addRange(range);
                    } catch (e) {
                        focusBlock(currentBlock, true);
                    }
                }
            } else {
                const remainingBlocks = Array.from(editor.querySelectorAll('.block'));
                if (remainingBlocks.length > 0) {
                    focusBlock(remainingBlocks[0], true);
                }
            }
        }
    }
}

// Ephemeral fading is disabled (breaks contenteditable), but keep the clear function
export function applyEphemeralFading() {
    // DISABLED: wrapping words in spans breaks contenteditable cursor tracking
    return;
}

export function clearEphemeralFading() {
    const allBlocks = Array.from(getEditor().querySelectorAll('.block'));
    allBlocks.forEach(block => {
        const content = block.querySelector('.block-content');
        if (content && content.querySelector('.ephemeral-word')) {
            content.textContent = content.textContent;
        }
    });
}

// ──────────────────────────────────
// Dark mode / Canvas mode / Fullscreen
// ──────────────────────────────────
export function toggleDarkMode() {
    document.body.classList.toggle('dark-mode');
    localStorage.setItem('darkMode', document.body.classList.contains('dark-mode'));
}

export function togglePageStyle() {
    document.body.classList.toggle('canvas-mode');
    localStorage.setItem('canvasMode', document.body.classList.contains('canvas-mode'));
}

export function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(err => {
            console.error(`Error attempting to enable fullscreen: ${err.message}`);
        });
    } else if (document.exitFullscreen) {
        document.exitFullscreen();
    }
}

// ──────────────────────────────────
// URL and page title helpers
// ──────────────────────────────────
export function updateURL(docId) {
    const url = new URL(window.location);
    url.searchParams.set('id', docId);
    window.history.pushState({}, '', url);
}

export function clearURL() {
    const url = new URL(window.location);
    url.searchParams.delete('id');
    window.history.pushState({}, '', url);
}

export function getDocIdFromURL() {
    return new URLSearchParams(window.location.search).get('id');
}

export function updatePageTitle(docName) {
    document.title = `thesis: ${docName}`;
}

export function clearPageTitle() {
    document.title = 'thesis';
}
