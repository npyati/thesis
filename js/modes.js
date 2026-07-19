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
    clearStage();
}

// ──────────────────────────────────
// Blind mode — type without seeing the words; only the last character shows.
// Deliberately not persisted: reopening the app to an invisible document
// would read as data loss.
// ──────────────────────────────────
let _blindBaseline = { words: 0, chars: 0 };

function docCounts() {
    const editor = getEditor();
    const text = editor.innerText || editor.textContent || '';
    const words = text.trim().split(/\s+/).filter(w => w.length > 0).length;
    return { words, chars: text.length };
}

export function toggleBlindMode() {
    state.blindMode = !state.blindMode;
    document.body.classList.toggle('blind-mode', state.blindMode);
    const overlay = document.getElementById('blind-overlay');
    if (state.blindMode) {
        _blindBaseline = docCounts();
        overlay.classList.remove('hidden');
        updateBlindCount();
    } else {
        overlay.classList.add('hidden');
        const blocks = getEditor().querySelectorAll('.block');
        if (blocks.length) focusBlock(blocks[blocks.length - 1], true);
    }
}

// Show a running count of what's been typed this blind session — a calm
// anchor in place of seeing the words themselves.
export function updateBlindCount() {
    if (!state.blindMode) return;
    const now = docCounts();
    const words = Math.max(0, now.words - _blindBaseline.words);
    const chars = Math.max(0, now.chars - _blindBaseline.chars);
    const wordsEl = document.getElementById('blind-words');
    const charsEl = document.getElementById('blind-chars');
    if (wordsEl) wordsEl.textContent = words;
    if (charsEl) charsEl.textContent = `${chars} character${chars === 1 ? '' : 's'}`;
}

// ──────────────────────────────────
// Fog focus — the block you're writing stays sharp; everything else blurs
// into an unreadable smudge. A sibling of Fade focus (below); the two are
// mutually exclusive. Session-only: a fogged document on reload would look
// broken.
// ──────────────────────────────────
let _lastFogBlock = null;

function setFogMode(on) {
    state.fogMode = on;
    document.body.classList.toggle('fog-mode', on);
    _lastFogBlock = null;
    if (on) {
        if (state.focusMode) setFadeFocus(false); // one focus flavor at a time
        updateFogBlock();
    } else {
        getEditor().querySelectorAll('.block.fog-clear').forEach(b => b.classList.remove('fog-clear'));
    }
}

export function toggleFogMode() {
    setFogMode(!state.fogMode);
    clearStage();
}

export function updateFogBlock() {
    if (!state.fogMode) return;
    const current = getCurrentBlock();
    if (current === _lastFogBlock) return;
    _lastFogBlock = current;
    getEditor().querySelectorAll('.block').forEach(b => b.classList.toggle('fog-clear', b === current));
}

// ──────────────────────────────────
// Spellcheck
// ──────────────────────────────────
export function applySpellcheck(enabled) {
    const editor = getEditor();
    editor.spellcheck = enabled;
    localStorage.setItem('spellcheck', enabled);
    // Squiggles only refresh after a blur/focus cycle
    if (document.activeElement === editor || editor.contains(document.activeElement)) {
        editor.blur();
        editor.focus();
    }
}

export function toggleSpellcheck() {
    applySpellcheck(!getEditor().spellcheck);
    clearStage();
}

// ──────────────────────────────────
// Stage presets — bundles of modes for phases of writing
// ──────────────────────────────────
const STAGES = {
    draft:  { forwardOnly: true,  focus: true,  spellcheck: false },
    revise: { forwardOnly: false, focus: false, spellcheck: false },
    polish: { forwardOnly: false, focus: false, spellcheck: true },
};

// Manually toggling any stage-managed mode clears the stage label
function clearStage() {
    if (state.currentStage) {
        state.currentStage = null;
        localStorage.removeItem('writingStage');
    }
}

export function applyStage(stageName) {
    const stage = STAGES[stageName];
    if (!stage) return;
    if (state.forwardOnlyMode !== stage.forwardOnly) toggleForwardOnlyMode();
    if (state.focusMode !== stage.focus) toggleFocusMode();
    applySpellcheck(stage.spellcheck);
    state.currentStage = stageName;
    localStorage.setItem('writingStage', stageName);
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

// Rect of the caret's own visual line, so long wrapped paragraphs keep the
// line being typed pinned (true typewriter scrolling) rather than the block top
function caretLineRect(editor) {
    const selection = window.getSelection();
    if (!selection.rangeCount) return null;
    let range = selection.getRangeAt(0);
    if (!editor.contains(range.startContainer)) return null;
    range = range.cloneRange();
    range.collapse(false);
    let rects = range.getClientRects();
    if (!rects.length && range.startContainer.nodeType === Node.TEXT_NODE && range.startOffset > 0) {
        // Collapsed ranges at some positions report no rects — widen one char back
        range.setStart(range.startContainer, range.startOffset - 1);
        rects = range.getClientRects();
    }
    return rects.length ? rects[rects.length - 1] : null;
}

export function centerCurrentBlock(instant = false) {
    if (!state.centerMode) return;

    const currentBlock = getCurrentBlock();
    if (!currentBlock) return;

    const editor = getEditor();
    // Track the caret's line; fall back to the block top for empty lines
    const rect = caretLineRect(editor) || currentBlock.getBoundingClientRect();
    const targetPositionFromTop = window.innerHeight * 0.38;
    const delta = rect.top - targetPositionFromTop;
    if (Math.abs(delta) < 2) return; // already centered — avoid scroll jitter

    editor.scrollTo({
        top: editor.scrollTop + delta,
        behavior: instant ? 'auto' : 'smooth'
    });
}

// ──────────────────────────────────
// Fade focus — the paragraphs around the one you're on dim by distance.
// Mutually exclusive with Fog focus (above).
// ──────────────────────────────────
function setFadeFocus(on) {
    state.focusMode = on;
    document.body.classList.toggle('focus-mode', on);
    localStorage.setItem('focusMode', on);
    if (on) {
        if (state.fogMode) setFogMode(false); // one focus flavor at a time
        _lastFocusedBlock = null;
        updateFocusParagraph();
    } else {
        getEditor().querySelectorAll('.block').forEach(el => {
            el.classList.remove('focus-active');
            el.style.opacity = '';
        });
    }
}

export function toggleFocusMode() {
    setFadeFocus(!state.focusMode);
    clearStage();
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
    state.currentFileHandle = null;
    state.currentFileName = null;

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
// Page title helpers
// ──────────────────────────────────
export function updatePageTitle(docName) {
    document.title = `thesis: ${docName}`;
}

export function clearPageTitle() {
    document.title = 'thesis';
}
