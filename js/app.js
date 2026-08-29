// Main application entry point — wires modules together, sets up event listeners

import state from './state.js';
import { debounce, readJSON, restoreSelection } from './utils.js';
import { getEditor, getCurrentBlock, getSelectedBlocks, createBlockElement, appendBlockToEditor, updateNumberedBlocks, focusBlock, revealCaret, normalizeBlocks } from './blocks.js';
import { openModal, closeModal, closeOnClickOutside, attachModalKeyboardNav, showAlert, showConfirm, showPrompt } from './modals.js';
import { applyFormatting, strikethroughLastWord, deleteAllStrikethrough } from './formatting.js';
import {
    toggleForwardOnlyMode, toggleCenterMode, toggleFocusMode, toggleDarkMode,
    togglePageStyle, toggleFullscreen, addCenterModeSpacers,
    centerCurrentBlock, updateFocusParagraph, debouncedUpdateFocusParagraph,
    createNewEphemeralDocument, enforceEphemeralLimit,
    applyStage, toggleSpellcheck, toggleBlindMode, updateBlindCount,
    toggleFogMode, updateFogBlock,
} from './modes.js';
import { startRetype, retypeNext, retypePrev, endRetype, resumeRetypeIfActive, resumeRetype, recoverLastSource } from './retype.js';
import {
    loadContent, autoSave, saveToNewFile,
    importFromMarkdown, exportAsMarkdown, exportAsWord,
    copyAll, copyAsMarkdown, clearAll, clearStorage, quickSave,
    markdownToBlocks, restoreFileHandle, openRecentFile, setSaveStatus, openExternalFile,
    checkExternalChanges, reloadFromFile, flushAutoSave, syncMarginProcess,
} from './io.js';
import { getRecentFiles } from './db.js';
import { blocksFromPastedHTML } from './sanitize.js';
import { recordCheckpoint, scheduleCheckpoint, undo as historyUndo, redo as historyRedo, resetHistory } from './history.js';
import * as find from './find.js';
import {
    initComments, addCommentOnSelection, askClaudeOnSelection, addWholeDocumentComment,
    toggleCommentsPanel,
    renderCommentUI, setComments, setMargin, splitComments, openCommentCount,
    quickCommentFromTyping, toggleQuickCommentMode, cycleComment, replyToActiveComment,
    positionCards,
} from './comments.js';

const editor = getEditor();

// ──────────────────────────────────
// Font management
// ──────────────────────────────────
const availableFonts = [
    'Arial', 'Helvetica', 'Times New Roman', 'Times', 'Courier New', 'Courier',
    'Verdana', 'Georgia', 'Palatino', 'Garamond', 'Bookman', 'Comic Sans MS',
    'Trebuchet MS', 'Arial Black', 'Impact', 'Lucida Sans Unicode', 'Tahoma',
    'Lucida Console', 'Monaco', 'Brush Script MT', 'Copperplate', 'Papyrus',
    'Cambria', 'Calibri', 'Consolas', 'Segoe UI', 'Franklin Gothic Medium',
    'Century Gothic', 'Gill Sans', 'Optima', 'Futura', 'Baskerville', 'Didot',
    'Rockwell', 'Andale Mono', 'system-ui', 'ui-serif', 'ui-sans-serif',
    'ui-monospace', 'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy'
];

function getAllFonts() {
    const all = [...state.customFonts, ...(state.installedFonts || []), ...availableFonts];
    const seen = new Set();
    return all.filter(f => { const key = f.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; });
}

function isFontAvailable(fontName) {
    const testString = 'mmmmmmmmmmlli';
    const testSize = '72px';
    const baseFonts = ['monospace', 'sans-serif', 'serif'];
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const baseWidths = {};
    baseFonts.forEach(bf => { ctx.font = testSize + ' ' + bf; baseWidths[bf] = ctx.measureText(testString).width; });
    let detected = false;
    baseFonts.forEach(bf => { ctx.font = testSize + " '" + fontName + "'," + bf; if (ctx.measureText(testString).width !== baseWidths[bf]) detected = true; });
    return detected;
}

function loadCustomFonts() { state.customFonts = readJSON('customFonts', []); }
function saveCustomFonts() { localStorage.setItem('customFonts', JSON.stringify(state.customFonts)); }
function addCustomFont(fontName) {
    if (!fontName || getAllFonts().some(f => f.toLowerCase() === fontName.toLowerCase())) return false;
    if (isFontAvailable(fontName)) { state.customFonts.unshift(fontName); saveCustomFonts(); return true; }
    return false;
}
// Every appearance change reflows the text under the comment highlights —
// the cards must follow (positionCards is rAF'd, so this is cheap)
function applyFont(font) { editor.style.fontFamily = font; localStorage.setItem('editorFont', font); closeFontModal(); positionCards(); }
function loadFont() { const f = localStorage.getItem('editorFont'); if (f) editor.style.fontFamily = f; }

function increaseFontSize() { state.currentFontSize = Math.min(state.currentFontSize + 2, 40); applyFontSize(); }
function decreaseFontSize() { state.currentFontSize = Math.max(state.currentFontSize - 2, 10); applyFontSize(); }
function applyFontSize() { editor.style.fontSize = state.currentFontSize + 'px'; localStorage.setItem('editorFontSize', state.currentFontSize); positionCards(); }
function loadFontSize() { const s = localStorage.getItem('editorFontSize'); if (s) { state.currentFontSize = parseInt(s); editor.style.fontSize = state.currentFontSize + 'px'; } }

function increaseLineHeight() { state.currentLineHeight = Math.min(state.currentLineHeight + 0.1, 2.5); applyLineHeight(); }
function decreaseLineHeight() { state.currentLineHeight = Math.max(state.currentLineHeight - 0.1, 1.0); applyLineHeight(); }
function applyLineHeight() { editor.style.lineHeight = state.currentLineHeight; localStorage.setItem('editorLineHeight', state.currentLineHeight); positionCards(); }
function loadLineHeight() { const l = localStorage.getItem('editorLineHeight'); if (l) { state.currentLineHeight = parseFloat(l); editor.style.lineHeight = state.currentLineHeight; } }

function increaseColumnWidth() { state.currentColumnWidth = Math.min(state.currentColumnWidth + 50, 1200); applyColumnWidth(); }
function decreaseColumnWidth() { state.currentColumnWidth = Math.max(state.currentColumnWidth - 50, 400); applyColumnWidth(); }
function applyColumnWidth() { document.documentElement.style.setProperty('--column-width', state.currentColumnWidth + 'px'); localStorage.setItem('editorColumnWidth', state.currentColumnWidth); positionCards(); }
function loadColumnWidth() { const w = localStorage.getItem('editorColumnWidth'); if (w) { state.currentColumnWidth = parseInt(w); document.documentElement.style.setProperty('--column-width', state.currentColumnWidth + 'px'); } }

function toggleParagraphSpacing() {
    state.paragraphSpacing = !state.paragraphSpacing;
    document.body.classList.toggle('paragraph-spacing', state.paragraphSpacing);
    localStorage.setItem('paragraphSpacing', state.paragraphSpacing);
    positionCards();
}

// ──────────────────────────────────
// Word count (debounced)
// ──────────────────────────────────
function updateWordCount() {
    let text;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && editor.contains(selection.anchorNode)) {
        text = selection.toString();
    } else {
        text = editor.innerText || editor.textContent || '';
    }
    const words = text.trim().split(/\s+/).filter(w => w.length > 0).length;
    const chars = text.length;
    const wordCountSpan = document.getElementById('word-count');
    const charCountSpan = document.getElementById('char-count');
    if (state.currentDocumentIsEphemeral) {
        wordCountSpan.textContent = `${words}/${state.EPHEMERAL_WORD_LIMIT} ${words === 1 ? 'word' : 'words'}`;
    } else {
        wordCountSpan.textContent = `${words} ${words === 1 ? 'word' : 'words'}`;
    }
    charCountSpan.textContent = `${chars} ${chars === 1 ? 'character' : 'characters'}`;

    // Optional open-comment count in the same pill
    const cSep = document.getElementById('comment-count-sep');
    const cSpan = document.getElementById('comment-count');
    if (cSep && cSpan) {
        const open = state.commentCountInPill ? openCommentCount() : 0;
        cSep.classList.toggle('hidden', open === 0);
        cSpan.classList.toggle('hidden', open === 0);
        if (open > 0) cSpan.textContent = `${open} open ${open === 1 ? 'comment' : 'comments'}`;
    }
}

const debouncedWordCount = debounce(updateWordCount, 150);

function showWordCountToggle() {
    state.wordCountVisible = !state.wordCountVisible;
    localStorage.setItem('wordCountVisible', state.wordCountVisible);
    const display = document.getElementById('word-count-display');
    if (state.wordCountVisible) { display.classList.remove('hidden'); updateWordCount(); }
    else { display.classList.add('hidden'); }
}

function toggleCommentCountInPill() {
    state.commentCountInPill = !state.commentCountInPill;
    localStorage.setItem('commentCountInPill', state.commentCountInPill);
    updateWordCount();
}

// ──────────────────────────────────
// Heading navigation
// ──────────────────────────────────
function extractHeadings() {
    const headings = [];
    editor.querySelectorAll('.block-heading1, .block-heading2, .block-heading3').forEach(block => {
        const contentEl = block.querySelector('.block-content');
        headings.push({ element: block, text: contentEl ? contentEl.textContent : '', level: block.dataset.type });
    });
    return headings;
}

function renderHeadings(headings) {
    const headingList = document.getElementById('heading-list');
    headingList.innerHTML = '';
    if (headings.length === 0) { headingList.innerHTML = '<div class="no-headings">No headings found</div>'; state.selectedHeadingIndex = 0; return; }
    headings.forEach((h, i) => {
        const item = document.createElement('div');
        item.className = `heading-item ${h.level} ${i === state.selectedHeadingIndex ? 'selected' : ''}`;
        item.textContent = h.text;
        item.setAttribute('role', 'option');
        item.addEventListener('click', () => jumpToHeading(h.element));
        headingList.appendChild(item);
    });
}

function jumpToHeading(el) {
    document.getElementById('heading-modal').classList.add('hidden');
    state.savedSelection = null;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    focusBlock(el, true);
}

async function openHeadingModal() {
    const headings = extractHeadings();
    if (headings.length === 0) { await showAlert('No headings found in the document'); return; }
    state.selectedHeadingIndex = 0;
    const modal = document.getElementById('heading-modal');
    const search = document.getElementById('heading-search');
    search.value = '';
    renderHeadings(headings);
    openModal(modal, search);
}

// ──────────────────────────────────
// Claude model modal
// ──────────────────────────────────
// Which model reads the margin. The empty id is the default — margin.js then
// omits --model and the CLI picks, which is what most writers want. The rest
// are passed through verbatim as `claude --model <id>`; the search field also
// accepts anything you type, so a model released after this list still works.
const MODELS = [
    { id: '',                  name: 'Default',           note: 'whatever your Claude Code login uses' },
    { id: 'claude-opus-5',     name: 'Claude Opus 5',     note: 'deep reading — the strongest reader' },
    { id: 'claude-sonnet-5',   name: 'Claude Sonnet 5',   note: 'near-Opus quality, faster and cheaper' },
    { id: 'claude-haiku-4-5',  name: 'Claude Haiku 4.5',  note: 'fastest; best for typo-level notes' },
    { id: 'claude-fable-5',    name: 'Claude Fable 5',    note: 'most capable, slowest, priciest' },
    { id: 'claude-opus-4-8',   name: 'Claude Opus 4.8',   note: 'previous Opus' },
    { id: 'claude-opus-4-7',   name: 'Claude Opus 4.7',   note: 'older Opus' },
    { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', note: 'previous Sonnet' },
];

const currentModel = () => localStorage.getItem('marginModel') || '';

function filteredModels() {
    const term = document.getElementById('model-search').value.trim().toLowerCase();
    if (!term) return MODELS;
    const hits = MODELS.filter(m => `${m.name} ${m.id} ${m.note}`.toLowerCase().includes(term));
    // A model id we don't know about is still a valid thing to ask for
    if (hits.length === 0) return [{ id: term, name: term, note: 'use this model id as typed' }];
    return hits;
}

function renderModels(models) {
    const list = document.getElementById('model-list');
    list.innerHTML = '';
    const current = currentModel();
    models.forEach((m, i) => {
        const item = document.createElement('div');
        item.className = `font-item ${i === state.selectedModelIndex ? 'selected' : ''} ${m.id === current ? 'current' : ''}`;
        item.textContent = m.note ? `${m.name} — ${m.note}` : m.name;
        item.setAttribute('role', 'option');
        item.addEventListener('click', () => applyModel(m.id));
        list.appendChild(item);
    });
}

// Changing the model restarts the companion, so the next pass is read by the
// model you just picked rather than the one that was already attached.
function applyModel(id) {
    if (id) localStorage.setItem('marginModel', id);
    else localStorage.removeItem('marginModel');
    closeModal(document.getElementById('model-modal'));
    if (window.__thesisStopMargin) window.__thesisStopMargin();
    syncMarginProcess();
}

function openModelModal() {
    state.selectedModelIndex = 0;
    const search = document.getElementById('model-search');
    search.value = '';
    renderModels(MODELS);
    openModal(document.getElementById('model-modal'), search);
}

// ──────────────────────────────────
// Font modal
// ──────────────────────────────────
function renderFonts(fonts) {
    const fontList = document.getElementById('font-list');
    fontList.innerHTML = '';
    if (fonts.length === 0) { fontList.innerHTML = '<div class="no-fonts">No fonts found</div>'; state.selectedFontIndex = 0; return; }
    const currentFont = localStorage.getItem('editorFont') || 'Helvetica';
    fonts.forEach((font, i) => {
        const item = document.createElement('div');
        item.className = `font-item ${i === state.selectedFontIndex ? 'selected' : ''} ${font === currentFont ? 'current' : ''}`;
        item.style.fontFamily = font;
        item.textContent = font;
        item.setAttribute('role', 'option');
        item.addEventListener('click', () => applyFont(font));
        fontList.appendChild(item);
    });
}

function openFontModal() {
    state.selectedFontIndex = 0;
    const modal = document.getElementById('font-modal');
    const search = document.getElementById('font-search');
    search.value = '';
    renderFonts(getAllFonts());
    openModal(modal, search);
}

function closeFontModal() { closeModal(document.getElementById('font-modal')); }

// ──────────────────────────────────
// Recent files modal
// ──────────────────────────────────
let recentFilesCache = [];

function filteredRecentFiles() {
    const term = document.getElementById('recent-search').value.toLowerCase();
    return recentFilesCache.filter(f => f.fileName.toLowerCase().includes(term));
}

function renderRecentList(files) {
    const listEl = document.getElementById('recent-list');
    listEl.innerHTML = '';
    if (files.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'no-files';
        empty.textContent = 'No matching files';
        listEl.appendChild(empty);
        return;
    }
    files.forEach((f, i) => {
        const item = document.createElement('div');
        item.className = `file-item ${i === state.selectedRecentIndex ? 'selected' : ''}`;
        item.setAttribute('role', 'option');
        const name = document.createElement('div');
        name.className = 'file-item-name';
        name.textContent = f.fileName;
        const date = document.createElement('div');
        date.className = 'file-item-date';
        date.textContent = new Date(f.timestamp).toLocaleString();
        item.appendChild(name);
        item.appendChild(date);
        item.addEventListener('click', () => pickRecentFile(f));
        listEl.appendChild(item);
    });
}

async function pickRecentFile(entry) {
    closeModal(document.getElementById('recent-modal'));
    await openRecentFile(entry);
}

async function openRecentModal() {
    recentFilesCache = await getRecentFiles();
    if (recentFilesCache.length === 0) {
        await showAlert('No recent files yet — they appear here after you open or save a file.');
        return;
    }
    state.selectedRecentIndex = 0;
    const modal = document.getElementById('recent-modal');
    const search = document.getElementById('recent-search');
    search.value = '';
    renderRecentList(recentFilesCache);
    openModal(modal, search);
}

// ──────────────────────────────────
// Find bar
// ──────────────────────────────────
function updateFindCount(result) {
    const findCount = document.getElementById('find-count');
    const findInput = document.getElementById('find-input');
    findCount.textContent = result.total ? `${result.index + 1}/${result.total}` : (findInput.value ? '0' : '');
}

function openFindBar() {
    const findBar = document.getElementById('find-bar');
    const findInput = document.getElementById('find-input');
    findBar.classList.remove('hidden');
    findInput.value = '';
    document.getElementById('find-count').textContent = '';
    setTimeout(() => findInput.focus(), 0);
}

function closeFindBar(commit) {
    find.close(commit);
    document.getElementById('find-bar').classList.add('hidden');
    editor.focus();
}

// ──────────────────────────────────
// Undo / redo
// ──────────────────────────────────
function afterHistoryRestore() {
    if (state.centerMode) addCenterModeSpacers();
    updateNumberedBlocks();
    renderCommentUI();
    autoSave();
    updateFocusParagraph();
    revealCaret();
    if (state.wordCountVisible) debouncedWordCount();
}

function doUndo() {
    if (state.forwardOnlyMode || state.blindMode) return;
    if (historyUndo()) afterHistoryRestore();
}

function doRedo() {
    if (state.forwardOnlyMode || state.blindMode) return;
    if (historyRedo()) afterHistoryRestore();
}

// ──────────────────────────────────
// Ephemeral word limit change
// ──────────────────────────────────
async function changeEphemeralWordLimit() {
    const entered = await showPrompt('Ephemeral word limit', {
        value: String(state.EPHEMERAL_WORD_LIMIT),
        placeholder: 'How many words linger before fading',
    });
    if (entered === null) return;
    const parsed = parseInt(entered.trim(), 10);
    if (isNaN(parsed) || parsed < 1) {
        await showAlert('Please enter a valid number greater than 0.');
        return;
    }
    state.EPHEMERAL_WORD_LIMIT = parsed;
    localStorage.setItem('ephemeralWordLimit', parsed);
    if (state.currentDocumentIsEphemeral) updateWordCount();
}

// ──────────────────────────────────
// Claude in the margin — per-file invitation + brief (thesis:margin block)
// ──────────────────────────────────
// Consent is file-level and explicit: the marker lives in the file itself, so
// it travels with the document and survives moves between folders. The margin
// companion reads nothing unmarked.
async function toggleClaudeInvitation() {
    if (state.currentDocumentIsEphemeral) {
        await showAlert('Ephemeral documents leave no record — there is nothing for Claude to read.');
        return;
    }
    if (!state.currentFileHandle) {
        await showAlert('Connect this document to a file first — the invitation lives in the file.');
        return;
    }
    if (state.marginRaw) {
        await showAlert('This file has a damaged margin block that thesis is preserving untouched — repair it before changing the invitation.');
        return;
    }
    const invited = !!(state.margin && state.margin.invited);
    if (!invited) {
        const ok = await showConfirm(
            'Invite Claude to read this file? While the invitation stands, ' +
            'this file and its comments are sent to Anthropic under your account. ' +
            'Revoke any time with this same command.'
        );
        if (!ok) return;
        state.margin = { ...(state.margin || {}), invited: true };
    } else {
        const ok = await showConfirm('Revoke Claude’s invitation to this file?');
        if (!ok) return;
        state.margin = { ...(state.margin || {}), invited: false };
    }
    // Write the consent to disk now, then let the shell start (or stop) the
    // reader — the invitation should be in the file before anyone reads it
    autoSave();
    flushAutoSave();
    syncMarginProcess();
}

// A whole-document summon: posts an @claude document note asking for a full
// read. The margin answers in-thread with its general read and may add
// anchored notes alongside. Edit the posted note to sharpen the ask.
async function askClaudeFullRead() {
    if (state.currentDocumentIsEphemeral) {
        await showAlert('Ephemeral documents leave no record — there is nothing for Claude to read.');
        return;
    }
    if (!state.currentFileHandle) {
        await showAlert('Connect this document to a file first — the conversation lives in the file.');
        return;
    }
    if (state.commentsRaw) {
        await showAlert('This file has a damaged comment block that thesis is preserving untouched — repair it before adding new comments.');
        return;
    }
    addWholeDocumentComment('@claude do a full read — general thoughts as well as specific notes.');
    if (!(state.margin && state.margin.invited)) {
        await showAlert('Posted — but Claude isn’t invited to this file yet. Run Invite Claude and the margin will answer.');
    }
}

// The brief: how you want to be read, handed to every pass over this file
// ("challenge my logic, leave my style alone"). File-level, like consent.
async function editClaudeBrief() {
    if (state.currentDocumentIsEphemeral || !state.currentFileHandle) {
        await showAlert('Connect this document to a file first — the brief lives in the file.');
        return;
    }
    if (state.marginRaw) {
        await showAlert('This file has a damaged margin block that thesis is preserving untouched — repair it before editing the brief.');
        return;
    }
    const entered = await showPrompt('Claude’s brief for this file', {
        value: (state.margin && state.margin.brief) || '',
        placeholder: 'How should Claude read this file? e.g. "Challenge my logic, leave my style alone."',
        multiline: true,
    });
    if (entered === null) return;
    const brief = entered.trim();
    const margin = { ...(state.margin || { invited: false }) };
    if (brief) margin.brief = brief;
    else delete margin.brief;
    state.margin = margin;
    autoSave();
}

// ──────────────────────────────────
// Block operations (heading/list/quote apply)
// ──────────────────────────────────
function applyHeading(level) {
    const blocksToConvert = state.multiBlockSelection.length > 0 ? state.multiBlockSelection : [getCurrentBlock()];
    if (!blocksToConvert[0]) return;
    const headingType = `heading${level}`;
    blocksToConvert.forEach(block => {
        const marker = block.querySelector('.block-marker'); if (marker) marker.remove();
        block.dataset.type = headingType; block.dataset.level = '0';
        block.className = `block block-${headingType}`;
    });
    updateNumberedBlocks(); state.multiBlockSelection = [];
    focusBlock(blocksToConvert[0], true);
}

function applyBlockQuote() {
    const blocks = state.multiBlockSelection.length > 0 ? state.multiBlockSelection : [getCurrentBlock()];
    if (!blocks[0]) return;
    blocks.forEach(block => {
        if (block.dataset.type === 'quote') {
            block.dataset.type = 'text'; block.dataset.level = '0'; block.className = 'block block-text';
        } else {
            const marker = block.querySelector('.block-marker'); if (marker) marker.remove();
            block.dataset.type = 'quote'; block.dataset.level = '0'; block.className = 'block block-quote';
        }
    });
    updateNumberedBlocks(); state.multiBlockSelection = [];
    focusBlock(blocks[0], true);
}

function toggleListType(listType) {
    const blocks = state.multiBlockSelection.length > 0 ? state.multiBlockSelection : [getCurrentBlock()];
    if (!blocks[0]) return;
    blocks.forEach(block => {
        const contentEl = block.querySelector('.block-content'); if (!contentEl) return;
        if (block.dataset.type === listType) {
            block.dataset.type = 'text'; block.className = 'block block-text';
            const marker = block.querySelector('.block-marker'); if (marker) marker.remove();
        } else {
            block.dataset.type = listType; block.className = `block block-${listType}`;
            const existingMarker = block.querySelector('.block-marker'); if (existingMarker) existingMarker.remove();
            const marker = document.createElement('span');
            marker.className = `block-marker ${listType === 'bullet' ? 'bullet-marker' : 'number-marker'}`;
            marker.contentEditable = 'false'; marker.setAttribute('aria-hidden', 'true');
            marker.textContent = listType === 'bullet' ? '•' : '1.';
            block.insertBefore(marker, contentEl);
        }
    });
    updateNumberedBlocks(); state.multiBlockSelection = [];
    focusBlock(blocks[0], true);
}

function convertToNormalText() {
    const blocks = state.multiBlockSelection.length > 0 ? state.multiBlockSelection : [getCurrentBlock()];
    if (!blocks[0]) return;
    blocks.forEach(block => {
        const marker = block.querySelector('.block-marker'); if (marker) marker.remove();
        block.dataset.type = 'text'; block.dataset.level = '0'; block.className = 'block block-text';
    });
    updateNumberedBlocks(); state.multiBlockSelection = [];
    focusBlock(blocks[0], true);
}

function deleteBlocks() {
    recordCheckpoint();
    let blocksToDelete;
    if (state.multiBlockSelection.length > 0) blocksToDelete = state.multiBlockSelection;
    else { const sel = getSelectedBlocks(); blocksToDelete = sel.length > 0 ? sel : [getCurrentBlock()]; }
    if (!blocksToDelete[0]) return;

    let focusTarget = null;
    const first = blocksToDelete[0];
    if (first.previousElementSibling && first.previousElementSibling.classList.contains('block')) focusTarget = first.previousElementSibling;
    else { const last = blocksToDelete[blocksToDelete.length - 1]; if (last.nextElementSibling && last.nextElementSibling.classList.contains('block')) focusTarget = last.nextElementSibling; }
    blocksToDelete.forEach(b => b.remove());
    if (editor.querySelectorAll('.block').length === 0) { const nb = createBlockElement('text', ''); appendBlockToEditor(nb); focusTarget = nb; }
    updateNumberedBlocks(); state.multiBlockSelection = [];
    if (focusTarget) focusBlock(focusTarget, false);
    autoSave();
}

// Move the current block (or selected blocks) up or down. direction: -1 up, +1 down.
function moveBlocks(direction) {
    recordCheckpoint();
    let blocks;
    if (state.multiBlockSelection.length > 0) blocks = state.multiBlockSelection;
    else { const sel = getSelectedBlocks(); blocks = sel.length > 1 ? sel : [getCurrentBlock()]; }
    if (!blocks[0]) return;

    // Only a .block sibling counts as room to move — at the document's edges
    // the neighbor is a center-mode spacer, and swapping past it strands the
    // block a full viewport outside the text
    if (direction < 0) {
        const target = blocks[0].previousElementSibling;
        if (!target || !target.classList.contains('block')) return;
        for (let i = 0; i < blocks.length; i++) editor.insertBefore(blocks[i], target);
    } else {
        const last = blocks[blocks.length - 1];
        const nextBlock = last.nextElementSibling;
        if (!nextBlock || !nextBlock.classList.contains('block')) return;
        const targetPos = nextBlock.nextElementSibling;
        for (let i = blocks.length - 1; i >= 0; i--) editor.insertBefore(blocks[i], targetPos);
    }
    updateNumberedBlocks(); autoSave();
    if (blocks.length === 1) focusBlock(blocks[0]);
    positionCards();
}

// ──────────────────────────────────
// Intro
// ──────────────────────────────────
const introHTML = `<p><strong>thesis</strong> is a minimalist text editor, designed for focus and creativity.</p><p>It works through the keyboard — you shouldn't need the mouse. Type <strong>/</strong> to open the command menu, then search or use the arrow keys and press <strong>[enter]</strong>. Type <strong>/</strong> again to close it (press <strong>[space]</strong> at the empty prompt to keep a literal /).</p><p>Your writing saves automatically as you type — you never need to reach for Save. It's kept on this machine, and you can also <em>Open File</em> or <em>Save to File As…</em> to sync a real <strong>.md</strong> file on disk. Nothing is ever sent online.</p><p>There are a few different ways to write, all in the / menu:</p><ul><li><strong>Stages</strong> — Draft, Revise, and Polish set the editor up for each phase of writing.</li><li><strong>Forward-only</strong> — type like a typewriter, with no going back.</li><li><strong>Blind</strong> — write without seeing anything; a running word count keeps you company.</li><li><strong>Ephemeral</strong> — the oldest words fade away as new ones arrive, leaving no record.</li><li><strong>Retype</strong> — redraft by retyping your old draft one paragraph at a time.</li><li><strong>Focus</strong> — fade or blur everything but the line you're on, or keep it centered.</li></ul><p>There's more to find — fonts, dark mode, find, margin comments (select text, <strong>⌘⌥M</strong>), export to Markdown or Word — but that's enough to start. There isn't much here, just what's necessary.</p><p>For every shortcut and a note on each way of writing, open <a href="#" id="intro-guide-link"><strong>Shortcuts &amp; Guide</strong></a> — or press <strong>/</strong> and search for it.</p><p><strong>This is a work in progress.</strong> Send me a note if you have ideas.</p>`;

function showIntro() {
    document.getElementById('intro-text').innerHTML = introHTML;
    document.getElementById('intro-modal').classList.remove('hidden');
}

// ──────────────────────────────────
// Shortcuts & guide
// ──────────────────────────────────
// Collapsed, each entry is a cheat-sheet row (keycaps + name). Entries with a
// `detail` get a chevron and expand in place to explain the feature.
const guide = [
    { section: 'Command menu', entries: [
        { keys: ['/'], name: 'Open the command menu', detail: 'Type / anywhere to open the menu, then search by name or use ↑ ↓ and press Enter. Type / again to close it — or press Space at the empty prompt to type a literal slash. Everything thesis can do lives here.' },
    ] },
    { section: 'Moving & editing', entries: [
        { keys: ['⌥', '↑'], name: 'Move line up', detail: 'Moves the current paragraph — or every paragraph in your selection — above its neighbour. Numbered lists renumber themselves.' },
        { keys: ['⌥', '↓'], name: 'Move line down', detail: 'Moves the current paragraph (or selection) below the next one.' },
        { keys: ['⌘', 'Z'], name: 'Undo' },
        { keys: ['⌘', '⇧', 'Z'], name: 'Redo', detail: 'Undo and redo step through your edits. Both are disabled in Forward-only mode, where there is no going back.' },
        { keys: ['⌘', 'D'], name: 'Delete block', detail: 'Removes the current block, or every block you have selected.' },
        { keys: ['⌘', 'B'], name: 'Bold' },
        { keys: ['⌘', 'I'], name: 'Italic' },
        { keys: ['⌘', 'S'], name: 'Save to file', detail: 'Writes to the connected .md file, or asks you to choose one. Your work also autosaves in this browser as you type, so you rarely need to reach for Save.' },
    ] },
    { section: 'Ways to write', entries: [
        { name: 'Draft · Revise · Polish', detail: 'Three presets for the arc of a piece. Draft is forward-only with focus on and spellcheck off — just get words out. Revise unlocks editing and shows the whole document. Polish turns spellcheck on for the final pass.' },
        { name: 'Forward-only', detail: 'Type like a typewriter: backspace, deletion, and cursor movement are locked, so you can only move ahead.' },
        { name: 'Blind', detail: 'Hides everything you write; a running word count keeps you company. Good for silencing the inner editor.' },
        { name: 'Ephemeral', detail: 'The oldest words dissolve as new ones arrive, leaving no record behind — pure flow.' },
        { name: 'Retype', detail: 'Redraft by retyping: your old draft shows a paragraph at a time while you type it fresh. While retyping, ⌘↓ / ⌘↑ move between paragraphs and ⌘. ends the session.' },
    ] },
    { section: 'Focus & view', entries: [
        { name: 'Fade · Fog · Center focus', detail: 'Fade dims the paragraphs around the one you are on. Fog blurs everything but the active line. Center keeps the active line in the middle of the screen.' },
        { keys: ['⌘', '+'], name: 'Larger text' },
        { keys: ['⌘', '−'], name: 'Smaller text' },
        { keys: ['⌘', ']'], name: 'More line spacing' },
        { keys: ['⌘', '['], name: 'Less line spacing' },
        { name: 'Paragraph spacing', detail: 'Adds a blank line of visual space between paragraphs without changing the document itself. Toggle it from the command menu.' },
        { keys: ['⌘', '⇧', ']'], name: 'Wider column' },
        { keys: ['⌘', '⇧', '['], name: 'Narrower column' },
        { keys: ['F11'], name: 'Fullscreen' },
    ] },
    { section: 'Finding your way', entries: [
        { keys: ['⌘', 'F'], name: 'Find in document' },
        { name: 'Jump to heading', detail: 'Open the command menu and choose Jump to Heading to move straight to any heading in the document.' },
    ] },
    { section: 'Comments & Claude', entries: [
        { keys: ['⌘', '⌥', 'M'], name: 'Add comment', detail: 'Select text and add a margin note. Comments are saved right inside the .md file, so they travel with it.' },
        { keys: ['⌘', '⌥', '.'], name: 'Next comment' },
        { keys: ['⌘', '⌥', ','], name: 'Previous comment' },
        { keys: ['⌘', '⌥', 'R'], name: 'Reply to comment', detail: 'Opens the reply box on the active comment — cycle to a note with ⌘⌥. then reply without touching the mouse. Enter sends the reply; Esc puts the caret back in the text.' },
        { name: 'Ask Claude', detail: 'Address a comment to @claude and the margin answers when it reads. Full Read asks for a read of the whole piece. Claude only ever sees a file you have explicitly invited — consent lives in the file itself, and nothing is sent online otherwise.' },
    ] },
];

function renderGuide() {
    const body = document.getElementById('guide-body');
    body.innerHTML = '';
    for (const group of guide) {
        const section = document.createElement('div');
        section.className = 'guide-section';
        const title = document.createElement('div');
        title.className = 'guide-section-title';
        title.textContent = group.section;
        section.appendChild(title);

        for (const entry of group.entries) {
            const row = document.createElement('div');
            row.className = 'guide-row' + (entry.detail ? ' has-detail' : '');

            const head = document.createElement('div');
            head.className = 'guide-row-head';
            if (entry.detail) { head.setAttribute('role', 'button'); head.tabIndex = 0; }

            const keys = document.createElement('span');
            keys.className = 'guide-keys';
            (entry.keys || []).forEach((k, i) => {
                if (i > 0) {
                    const plus = document.createElement('span');
                    plus.className = 'guide-plus';
                    plus.textContent = '+';
                    keys.appendChild(plus);
                }
                const kbd = document.createElement('kbd');
                kbd.className = 'guide-key';
                kbd.textContent = k;
                keys.appendChild(kbd);
            });

            const name = document.createElement('span');
            name.className = 'guide-name';
            name.textContent = entry.name;

            head.appendChild(keys);
            head.appendChild(name);

            if (entry.detail) {
                const chev = document.createElement('span');
                chev.className = 'guide-chevron';
                chev.textContent = '›';
                head.appendChild(chev);
            }
            row.appendChild(head);

            if (entry.detail) {
                const detail = document.createElement('div');
                detail.className = 'guide-detail';
                const inner = document.createElement('div');
                inner.className = 'guide-detail-inner';
                inner.textContent = entry.detail;
                detail.appendChild(inner);
                row.appendChild(detail);
            }
            section.appendChild(row);
        }
        body.appendChild(section);
    }
}

function showGuide() {
    renderGuide();
    document.getElementById('guide-expand-toggle').textContent = 'Expand all';
    const modal = document.getElementById('guide-modal');
    // openModal defers focus (past executeCommand's editor.focus()) and traps Tab
    // inside the modal, so keystrokes don't leak into the editor behind it.
    openModal(modal, modal.querySelector('.guide-content'));
}

// ──────────────────────────────────
// Commands
// ──────────────────────────────────
// Category order controls the grouping shown in the command menu
const CATEGORY_ORDER = ['Document', 'Write', 'Format', 'Comments', 'Navigate', 'View', 'Share', 'App'];

const commands = [
    // Document
    // Icons are flat text glyphs; '︎' pins emoji-capable codepoints to
    // monochrome text presentation
    { icon: '↧', name: 'Save', description: 'Save to the current file (or choose one)', action: quickSave, category: 'Document' },
    { icon: '↥', name: 'Open File', description: 'Open and auto-sync with a .md file on disk', action: importFromMarkdown, category: 'Document' },
    { icon: '◷', name: 'Open Recent', description: 'Reopen a recently used file', action: openRecentModal, category: 'Document' },
    { icon: '↻', name: 'Reload File', description: 'Re-read the connected .md file from disk to pick up outside changes', action: reloadFromFile, category: 'Document' },
    { icon: '⇲', name: 'Save to File As...', description: 'Save and auto-sync to a new .md file on disk', action: saveToNewFile, category: 'Document' },
    { icon: '+', name: 'New Document', description: 'Start a new document', action: clearAll, category: 'Document' },
    { icon: '◌', name: 'New Ephemeral Document', description: 'Write in pure flow - oldest words dissolve as new thoughts emerge', action: () => { createNewEphemeralDocument(autoSave); setComments([]); setMargin(null); syncMarginProcess(); renderCommentUI(); setSaveStatus('hidden'); }, category: 'Document' },

    // Write
    { icon: '✎', name: 'Draft Stage', description: 'Forward-only, focus mode, no spellcheck — just get words out', action: () => applyStage('draft'), category: 'Write' },
    { icon: '☰', name: 'Revise Stage', description: 'Unlock editing and see the whole document', action: () => applyStage('revise'), category: 'Write' },
    { icon: '✦', name: 'Polish Stage', description: 'Spellcheck on for the final pass', action: () => applyStage('polish'), category: 'Write' },
    { icon: '⌨︎', name: 'Retype Document', description: 'Redraft by retyping — the old draft shows a paragraph at a time while you type it fresh', action: () => startRetype(showAlert), category: 'Write' },
    { icon: '▸', name: 'Resume Retype', description: 'Reopen the retype bar where you left off (undo an accidental ⌘.)', action: () => resumeRetype(showAlert), category: 'Write' },
    { icon: '↺', name: 'Recover Last Retype Source', description: 'Load the old draft from your last retype back into the editor', action: () => recoverLastSource(showAlert, showConfirm), category: 'Write' },
    { icon: '⚑', name: 'End Retype', description: 'Finish retyping and keep the new draft', action: endRetype, category: 'Write' },
    { icon: '⊘', name: 'Toggle Blind Mode', description: 'Write without seeing anything — a running word count keeps you company', action: toggleBlindMode, category: 'Write' },
    { icon: '→', name: 'Toggle Forward-Only Mode', description: 'Prevent backspace, deletion, and cursor movement', action: toggleForwardOnlyMode, category: 'Write' },
    { icon: '⧖', name: 'Change Ephemeral Word Limit', description: 'Set how many words linger before fading into the past', action: changeEphemeralWordLimit, category: 'Write' },

    // Format
    { icon: 'H1', name: 'Heading 1', description: 'Format current line(s) as large heading', action: () => applyHeading(1), category: 'Format' },
    { icon: 'H2', name: 'Heading 2', description: 'Format current line(s) as medium heading', action: () => applyHeading(2), category: 'Format' },
    { icon: 'H3', name: 'Heading 3', description: 'Format current line(s) as small heading', action: () => applyHeading(3), category: 'Format' },
    { icon: '¶', name: 'Normal Text', description: 'Convert current line(s) to normal text', action: convertToNormalText, category: 'Format' },
    { icon: '•', name: 'Bullet List', description: 'Toggle bullet list for current line(s)', action: () => toggleListType('bullet'), category: 'Format' },
    { icon: '1.', name: 'Numbered List', description: 'Toggle numbered list for current line(s)', action: () => toggleListType('numbered'), category: 'Format' },
    { icon: '❝', name: 'Block Quote', description: 'Format current line(s) as a block quote', action: applyBlockQuote, category: 'Format' },
    { icon: '✗', name: 'Strikethrough Last Word', description: 'Apply strikethrough to the last typed word (type xxxx)', action: strikethroughLastWord, category: 'Format' },
    { icon: '✂︎', name: 'Delete All Strikethrough', description: 'Remove all struck-through words from document', action: deleteAllStrikethrough, category: 'Format' },
    { icon: '⌫', name: 'Delete Block', description: 'Delete current block or selected blocks', action: deleteBlocks, category: 'Format' },
    { icon: '↑', name: 'Move Line Up', description: 'Move the current line/block up (⌥↑)', action: () => moveBlocks(-1), category: 'Format' },
    { icon: '↓', name: 'Move Line Down', description: 'Move the current line/block down (⌥↓)', action: () => moveBlocks(1), category: 'Format' },

    // Comments
    { icon: '⊕', name: 'Add Comment', description: 'Comment on the selected text (⌘⌥M) — saved into the .md file', action: addCommentOnSelection, category: 'Comments' },
    { icon: '✳', name: 'Ask Claude', description: 'Comment on the selection, addressed to @claude — the margin answers when it reads', action: askClaudeOnSelection, category: 'Comments' },
    { icon: '⊛', name: 'Full Read', description: 'Ask Claude to read the whole piece — a general read plus anchored specifics', action: askClaudeFullRead, category: 'Comments' },
    { icon: '✉', name: 'Invite Claude', description: 'Invite (or revoke) Claude for this file — consent lives in the file itself', action: toggleClaudeInvitation, category: 'Comments' },
    { icon: '§', name: 'Claude Brief', description: 'Edit how Claude should read this file — handed to every pass', action: editClaudeBrief, category: 'Comments' },
    { icon: '◈', name: 'Claude Model', description: 'Choose which model reads the margin — applies to every invited file', action: openModelModal, category: 'Comments' },
    { icon: '›', name: 'Next Comment', description: 'Jump to the next comment in the document (⌘⌥.)', action: () => cycleComment(1), category: 'Comments' },
    { icon: '‹', name: 'Previous Comment', description: 'Jump to the previous comment in the document (⌘⌥,)', action: () => cycleComment(-1), category: 'Comments' },
    { icon: '↩', name: 'Reply to Comment', description: 'Open the reply box on the active comment (⌘⌥R)', action: replyToActiveComment, category: 'Comments' },
    { icon: '↯', name: 'Toggle Quick Comment Mode', description: 'Select text and just start typing to comment — typing never replaces a selection', action: toggleQuickCommentMode, category: 'Comments' },
    { icon: '◉', name: 'Toggle Comments', description: 'Show or hide margin comments and their highlights', action: toggleCommentsPanel, category: 'Comments' },

    // Navigate
    { icon: '⌕', name: 'Find', description: 'Find text in the document (Cmd+F)', action: openFindBar, category: 'Navigate' },
    { icon: '#', name: 'Jump to Heading', description: 'Navigate to a heading in the document', action: openHeadingModal, category: 'Navigate' },

    // View
    { icon: '◐', name: 'Toggle Fade Focus', description: 'Fade the paragraphs around the one you\'re on', action: toggleFocusMode, category: 'View' },
    { icon: '≋', name: 'Toggle Fog Focus', description: 'Blur everything but the line you\'re writing', action: toggleFogMode, category: 'View' },
    { icon: '⊙', name: 'Toggle Center Mode', description: 'Keep active line centered in viewport', action: toggleCenterMode, category: 'View' },
    { icon: '▭', name: 'Toggle Page Style', description: 'Switch between page and canvas view', action: togglePageStyle, category: 'View' },
    { icon: '☾', name: 'Toggle Dark Mode', description: 'Switch between light and dark theme', action: toggleDarkMode, category: 'View' },
    { icon: '⛶', name: 'Toggle Fullscreen', description: 'Enter/exit fullscreen mode (F11)', action: toggleFullscreen, category: 'View' },
    { icon: '✓', name: 'Toggle Spellcheck', description: 'Show or hide spelling squiggles', action: toggleSpellcheck, category: 'View' },
    { icon: '№', name: 'Toggle Word Count', description: 'Show/hide word and character count', action: showWordCountToggle, category: 'View' },
    { icon: '◉', name: 'Toggle Comment Count in Pill', description: 'Show the open-comment count beside the word count', action: toggleCommentCountInPill, category: 'View' },
    { icon: 'Aa', name: 'Change Font', description: 'Select font for the editor', action: openFontModal, category: 'View' },
    { icon: 'A+', name: 'Increase Font Size', description: 'Make text larger (Ctrl/Cmd + +)', action: increaseFontSize, category: 'View' },
    { icon: 'A−', name: 'Decrease Font Size', description: 'Make text smaller (Ctrl/Cmd + -)', action: decreaseFontSize, category: 'View' },
    { icon: '↕︎', name: 'Increase Line Height', description: 'Make text more spacious (Ctrl/Cmd + ])', action: increaseLineHeight, category: 'View' },
    { icon: '↕︎', name: 'Decrease Line Height', description: 'Make text more compact (Ctrl/Cmd + [)', action: decreaseLineHeight, category: 'View' },
    { icon: '¶', name: 'Toggle Paragraph Spacing', description: 'Add a blank line of visual space between paragraphs — the text itself is unchanged', action: toggleParagraphSpacing, category: 'View' },
    { icon: '↔︎', name: 'Widen Text Column', description: 'Make the text column wider (Ctrl/Cmd + Shift + ])', action: increaseColumnWidth, category: 'View' },
    { icon: '↔︎', name: 'Narrow Text Column', description: 'Make the text column narrower (Ctrl/Cmd + Shift + [)', action: decreaseColumnWidth, category: 'View' },

    // Share
    { icon: '⧉', name: 'Copy All', description: 'Copy all content to clipboard', action: copyAll, category: 'Share' },
    { icon: 'M↓', name: 'Copy as Markdown', description: 'Copy content as Markdown to clipboard', action: copyAsMarkdown, category: 'Share' },
    { icon: '↗︎', name: 'Export as Markdown', description: 'Download a copy as a .md file', action: exportAsMarkdown, category: 'Share' },
    { icon: 'W', name: 'Export as Word', description: 'Download content as Word (.docx) file', action: exportAsWord, category: 'Share' },
    { icon: '⎙', name: 'Print', description: 'Print the document or save as PDF', action: () => window.print(), category: 'Share' },

    // App
    { icon: '⌨', name: 'Shortcuts & Guide', description: 'Every keyboard shortcut, plus what each mode and feature does — expand any row for help', action: showGuide, category: 'App' },
    { icon: '?', name: 'Show Intro', description: 'What is this?', action: showIntro, category: 'App' },
    { icon: '⌦', name: 'Clear Storage', description: 'Clear the autosaved draft from browser memory', action: clearStorage, category: 'App' },
];

// ──────────────────────────────────
// Command modal
// ──────────────────────────────────
const commandModal = document.getElementById('command-modal');
const commandSearch = document.getElementById('command-search');
const commandList = document.getElementById('command-list');
const modeStatus = document.getElementById('mode-status');

// Cold-start "commonness" so a fresh install already ranks the everyday
// commands sensibly — e.g. "full" should mean Toggle Fullscreen, not Full Read.
// These are just seeds; real usage (recordCommandUsage) is added on top and
// takes over as you use the app. Keyed by command name.
const COMMAND_PRIORS = {
    'Toggle Fullscreen': 4,
    'Toggle Dark Mode': 4,
    'Save': 4,
    'Open File': 3,
    'Find': 3,
    'New Document': 3,
    'Export as Word': 3,
    'Export as Markdown': 3,
    'Copy All': 2,
};

// Frequency nudge for a command, bounded so it only ever tips *close* matches:
// capped below the gap between match tiers, so a merely-popular description
// match can never outrank a genuine name match. Seed + learned count.
const USAGE_BOOST_CAP = 5;
function usageBoost(cmd) {
    const used = (COMMAND_PRIORS[cmd.name] || 0) + (state.commandUsage[cmd.name] || 0);
    return Math.min(USAGE_BOOST_CAP, used);
}

// Count a run so search learns what you reach for. Only the boost cap's worth
// of counts ever matters, so no need to bound growth beyond that.
function recordCommandUsage(cmd) {
    state.commandUsage[cmd.name] = (state.commandUsage[cmd.name] || 0) + 1;
    try { localStorage.setItem('commandUsage', JSON.stringify(state.commandUsage)); } catch (e) {}
}

// A query is split on whitespace into tokens; every token must match somewhere
// in a command for it to appear ("tog com" finds "Toggle Comments"). Matching
// looks at name, icon, description, and category, then nudges by frequency.
function scoreCommand(cmd, tokens) {
    const name = cmd.name.toLowerCase();
    const desc = cmd.description.toLowerCase();
    const cat = cmd.category.toLowerCase();
    const icon = (cmd.icon || '').toLowerCase();

    let score = 0;
    for (const tok of tokens) {
        let best = 0;
        const ni = name.indexOf(tok);
        if (ni !== -1) {
            best = 10;
            if (ni === 0) best += 6;                    // name starts with the token
            else if (name[ni - 1] === ' ') best += 4;   // token starts a word in the name
        }
        if (best === 0 && icon && icon.indexOf(tok) !== -1) best = 8;  // e.g. "h1" → Heading 1
        if (best === 0) {
            const di = desc.indexOf(tok);
            if (di !== -1) {
                best = 3;
                if (di === 0 || desc[di - 1] === ' ') best += 1;
            }
        }
        if (best === 0 && cat.indexOf(tok) !== -1) best = 2;
        if (best === 0) return null;   // this token matched nowhere → command excluded
        score += best;
    }

    // Keep an exact multi-word phrase in the name ("toggle comments") ahead of
    // the same tokens found scattered across different commands.
    if (tokens.length > 1 && name.indexOf(tokens.join(' ')) !== -1) score += 5;
    score += usageBoost(cmd);
    return score;
}

function filterCommands(searchTerm) {
    const tokens = searchTerm.toLowerCase().trim().split(/\s+/).filter(Boolean);

    // No query: calm, category-grouped browse view (with header markers).
    if (tokens.length === 0) {
        const entries = [];
        const flat = [];
        for (const category of CATEGORY_ORDER) {
            const inCategory = commands.filter(c => c.category === category);
            if (inCategory.length === 0) continue;
            entries.push({ header: category });
            for (const command of inCategory) {
                entries.push({ command });
                flat.push(command);
            }
        }
        state.filteredCommandsList = flat;
        state.selectedCommandIndex = 0;
        renderCommands(entries);
        return;
    }

    // Active search: rank every match, best first, as a flat list (no headers).
    // Equal scores prefer the tighter match — the shorter name covers the same
    // tokens more completely ("tog com" → Toggle Comments over Toggle Comment
    // Count in Pill) — then fall back to original order so the list is stable.
    const ranked = commands
        .map((command, index) => ({ command, index, score: scoreCommand(command, tokens) }))
        .filter(e => e.score !== null)
        .sort((a, b) => b.score - a.score
            || a.command.name.length - b.command.name.length
            || a.index - b.index);

    state.filteredCommandsList = ranked.map(e => e.command);
    state.selectedCommandIndex = 0;
    renderCommands(ranked.map(e => ({ command: e.command })));
}

function renderCommands(entries) {
    commandList.innerHTML = '';
    commandList.setAttribute('role', 'listbox');
    commandList.setAttribute('aria-label', 'Commands');

    if (!entries.some(e => e.command)) {
        commandList.innerHTML = '<div class="command-item no-results" role="option">No commands found</div>';
        return;
    }

    let index = 0;
    entries.forEach(entry => {
        if (entry.header) {
            const header = document.createElement('div');
            header.className = 'command-group';
            header.setAttribute('role', 'presentation');
            header.textContent = entry.header;
            commandList.appendChild(header);
            return;
        }

        const command = entry.command;
        const i = index++;
        const item = document.createElement('div');
        item.className = `command-item ${i === state.selectedCommandIndex ? 'selected' : ''}`;
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', i === state.selectedCommandIndex);

        const nameEl = document.createElement('div');
        nameEl.className = 'command-name';
        const iconEl = document.createElement('span');
        iconEl.className = 'command-icon';
        iconEl.setAttribute('aria-hidden', 'true');
        iconEl.textContent = command.icon || '';
        nameEl.appendChild(iconEl);
        nameEl.appendChild(document.createTextNode(command.name));

        const descEl = document.createElement('div');
        descEl.className = 'command-description';
        descEl.textContent = command.description;

        item.appendChild(nameEl);
        item.appendChild(descEl);
        item.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); executeCommand(command); });
        commandList.appendChild(item);
    });
}

// Save-state line + active-mode pills at the top of the palette
function renderStatusHeader() {
    modeStatus.innerHTML = '';
    let shown = false;

    if (state.saveStatus !== 'hidden') {
        const line = document.createElement('div');
        line.className = `save-line ${state.saveStatus}`;
        const dot = document.createElement('span');
        dot.className = 'save-dot';
        const text = document.createElement('span');
        if (state.saveStatus === 'detached') text.textContent = 'Not connected to a file';
        else if (state.saveStatus === 'saving') text.textContent = 'Saving…';
        else text.textContent = state.currentFileName ? `Saved to ${state.currentFileName}` : 'Saved';
        line.appendChild(dot);
        line.appendChild(text);
        modeStatus.appendChild(line);
        shown = true;
    }

    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
    const modes = [];
    if (state.currentStage) modes.push(`${cap(state.currentStage)} stage`);
    if (state.retypeActive) modes.push('Retype');
    if (state.blindMode) modes.push('Blind');
    if (state.focusMode) modes.push('Fade focus');
    if (state.fogMode) modes.push('Fog focus');
    if (state.centerMode) modes.push('Center');
    if (state.forwardOnlyMode) modes.push('Forward-only');
    if (state.currentDocumentIsEphemeral) modes.push('Ephemeral');
    if (document.body.classList.contains('dark-mode')) modes.push('Dark');
    if (state.wordCountVisible) modes.push('Word count');
    if (state.quickCommentMode) modes.push('Quick comment');
    if (state.marginActivity === 'reading') modes.push('Claude is reading…');
    else if (state.marginActivity === 'checking') modes.push('Claude is checking sources…');
    else if (state.margin && state.margin.invited) modes.push('Claude invited');
    const openComments = openCommentCount();
    if (openComments > 0) modes.push(`${openComments} open comment${openComments === 1 ? '' : 's'}`);
    if (state.newClaudeArrivals > 0) modes.push(`${state.newClaudeArrivals} new in margin`);

    if (modes.length > 0) {
        const row = document.createElement('div');
        row.className = 'mode-badges';
        modes.forEach(m => {
            const badge = document.createElement('span');
            badge.className = 'mode-badge';
            badge.setAttribute('role', 'status');
            badge.textContent = m;
            row.appendChild(badge);
        });
        modeStatus.appendChild(row);
        shown = true;
    }

    modeStatus.style.display = shown ? 'block' : 'none';
}

function executeCommand(command) {
    if (state.savedSelection) {
        restoreSelection(state.savedSelection);
        state.savedSelection = null;
    }
    state.slashPosition = null;
    state.commandModalOpen = false;
    state.newClaudeArrivals = 0;   // the badge was seen — it shows once
    commandModal.classList.add('hidden');
    state.multiBlockSelection = [];

    recordCommandUsage(command);
    recordCheckpoint();
    command.action();

    editor.focus();
}

// anchorRect (optional): position the modal against this rect instead of the
// caret \u2014 used when the menu is summoned from outside the editor (the comments
// pane), where there's no editor selection to anchor to.
function showCommandModal(anchorRect) {
    state.commandModalOpen = true;
    commandModal.classList.remove('hidden');
    commandModal.style.opacity = '0';
    commandSearch.value = '';
    filterCommands('');
    state.selectedCommandIndex = 0;

    renderStatusHeader();

    // Position modal near cursor (or the given anchor)
    setTimeout(() => {
        let rect = anchorRect || null;
        if (!rect) {
            const selection = window.getSelection();
            if (selection.rangeCount > 0) {
                const range = selection.getRangeAt(0);
                const rects = range.getClientRects();
                if (rects.length > 0) rect = rects[rects.length - 1];

                if (!rect || (rect.width === 0 && rect.height === 0 && rect.top === 0 && rect.left === 0)) {
                    const marker = document.createElement('span');
                    marker.style.display = 'inline';
                    marker.textContent = '\u200B';
                    const mr = range.cloneRange();
                    mr.insertNode(marker);
                    rect = marker.getBoundingClientRect();
                    marker.remove();
                    const cb = getCurrentBlock();
                    if (cb) { const bc = cb.querySelector('.block-content'); if (bc) bc.normalize(); }
                }

                if (!rect || (rect.top < 5 && rect.left < 5)) {
                    const cb = getCurrentBlock();
                    if (cb) { const bc = cb.querySelector('.block-content'); rect = (bc || cb).getBoundingClientRect(); }
                }
            }
        }

        if (rect) {
            let left = rect.left;
            let top = rect.bottom + 5;
            const modalWidth = 350;
            const modalHeight = commandModal.offsetHeight || 200;
            if (left + modalWidth > window.innerWidth) left = window.innerWidth - modalWidth - 10;
            if (top + modalHeight > window.innerHeight) top = rect.top - modalHeight - 5;
            left = Math.max(10, left);
            top = Math.max(10, top);

            commandModal.style.left = `${left}px`;
            commandModal.style.top = `${top}px`;
        }
        commandModal.style.opacity = '1';
        commandSearch.focus();
        commandSearch.setSelectionRange(0, 0);
    }, 0);
}

// Summon the command menu from outside the editor (the comments pane). There's
// no editor selection to anchor to or return to, so position against the panel
// and just open \u2014 pane-side work like turning the pane off is then one
// keystroke away, exactly as '/' is in the editor.
function openCommandModalFromPanel() {
    if (state.commandModalOpen) return;
    if (!document.getElementById('intro-modal').classList.contains('hidden')) return;
    state.savedSelection = null;
    state.slashPosition = null;
    state.multiBlockSelection = [];
    const panelEl = document.getElementById('comments-panel');
    const r = (panelEl && !panelEl.classList.contains('hidden')) ? panelEl.getBoundingClientRect() : null;
    const anchor = (r && r.width)
        ? { left: r.left, right: r.right, top: r.top, bottom: r.top }
        : { left: window.innerWidth / 2 - 175, right: window.innerWidth / 2 + 175, top: 60, bottom: 60 };
    showCommandModal(anchor);
}

// '/' opens the command menu from anywhere that isn't the editor or a text
// field \u2014 most usefully the comments pane, where focus sits on a card (or on
// <body> after a card click) and the editor's own '/' handler never sees it.
// Capture phase so it beats the reply/edit textareas' stopPropagation; the
// text-field guard leaves literal slashes typable in those boxes.
document.addEventListener('keydown', (event) => {
    if (event.key !== '/' || state.commandModalOpen) return;
    if (!document.getElementById('intro-modal').classList.contains('hidden')) return;
    const el = event.target;
    if (el === editor || (el && el.closest && el.closest('#editor'))) return;   // editor handles its own '/'
    if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.isContentEditable)) return;   // let slashes type
    event.preventDefault();
    openCommandModalFromPanel();
}, true);

function hideCommandModal() {
    state.commandModalOpen = false;
    state.newClaudeArrivals = 0;   // the badge was seen — it shows once
    commandModal.classList.add('hidden');
    state.slashPosition = null;
    state.multiBlockSelection = [];

    if (state.savedSelection) {
        if (!restoreSelection(state.savedSelection)) editor.focus();
        state.savedSelection = null;
    } else {
        editor.focus();
    }
}

// ──────────────────────────────────
// Event listeners
// ──────────────────────────────────
commandSearch.addEventListener('input', (e) => filterCommands(e.target.value));

commandSearch.addEventListener('keydown', (event) => {
    if (event.key === ' ' && commandSearch.value === '') {
        event.preventDefault();
        if (state.slashPosition && state.slashPosition.node) {
            const s = window.getSelection();
            const r = document.createRange();
            const t = document.createTextNode('/');
            r.setStart(state.slashPosition.node, state.slashPosition.offset);
            r.collapse(true); r.insertNode(t);
            r.setStartAfter(t); r.collapse(true);
            s.removeAllRanges(); s.addRange(r);
        }
        hideCommandModal(); return;
    }
    if (event.key === '/') { event.preventDefault(); hideCommandModal(); return; }
    if (event.key === 'Escape') { event.preventDefault(); hideCommandModal(); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const items = commandList.querySelectorAll('.command-item:not(.no-results)');
        if (items.length === 0) return;
        state.selectedCommandIndex = event.key === 'ArrowDown'
            ? (state.selectedCommandIndex + 1) % items.length
            : (state.selectedCommandIndex - 1 + items.length) % items.length;
        items.forEach((it, i) => { it.classList.toggle('selected', i === state.selectedCommandIndex); it.setAttribute('aria-selected', i === state.selectedCommandIndex); });
        items[state.selectedCommandIndex]?.scrollIntoView({ block: 'nearest' });
        return;
    }
    if (event.key === 'Enter') {
        event.preventDefault();
        if (state.filteredCommandsList[state.selectedCommandIndex]) executeCommand(state.filteredCommandsList[state.selectedCommandIndex]);
    }
});

document.addEventListener('click', (event) => {
    if (state.commandModalOpen && !commandModal.contains(event.target)) hideCommandModal();
});

// ──────────────────────────────────
// Editor keydown handler
// ──────────────────────────────────
// Keyboard navigation must keep the caret on screen. WebKit stops auto-
// revealing the caret after programmatic selection changes (seen with the
// comments pane open), so assert it ourselves once the move has happened.
// Caret to one end of a block's text. End and ⌘→ stop at the end of the visual
// line; in a wrapped paragraph that isn't the end of the paragraph, and nothing
// else gets you there in one press.
function caretToEdgeOf(block, atEnd) {
    const content = block && block.querySelector('.block-content');
    if (!content) return;
    const range = document.createRange();
    range.selectNodeContents(content);
    range.collapse(!atEnd);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
}

const CARET_NAV_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End']);
editor.addEventListener('keydown', (event) => {
    if (!CARET_NAV_KEYS.has(event.key)) return;
    if (state.centerMode) return; // center mode pins the caret line itself
    requestAnimationFrame(revealCaret);
});

editor.addEventListener('keydown', (event) => {
    // Retype navigation (⌘↓ / ⌘↑ / ⌘.)
    if (state.retypeActive && (event.metaKey || event.ctrlKey)) {
        if (event.key === 'ArrowDown') { event.preventDefault(); retypeNext(); return; }
        if (event.key === 'ArrowUp') { event.preventDefault(); retypePrev(); return; }
        if (event.key === '.') { event.preventDefault(); endRetype(); return; }
    }

    // ⌘↓ / ⌘↑ — the ends of the paragraph you're in, not the ends of the
    // document. WebKit's native behaviour throws you to the far end of the file
    // and gives you nothing to find your way back with, so an accidental press
    // costs a hunt. The distance is the problem, not the direction: a move that
    // stays inside the paragraph can't lose your place, so there is nothing to
    // recover from and no state to keep. Fills a real gap too — End and ⌘→ stop
    // at the end of the visual line, which in a wrapped paragraph isn't the end
    // of the paragraph.
    if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey
        && (event.key === 'ArrowDown' || event.key === 'ArrowUp')
        && !state.forwardOnlyMode && !state.blindMode) {
        const block = getCurrentBlock();
        if (!block) return;
        event.preventDefault();
        caretToEdgeOf(block, event.key === 'ArrowDown');
        updateFocusParagraph();
        requestAnimationFrame(revealCaret);
        return;
    }

    // Center mode: prevent cursor from entering spacers
    if (state.centerMode && (event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'Home' || event.key === 'End')) {
        const currentBlock = getCurrentBlock();
        const allBlocks = Array.from(editor.querySelectorAll('.block'));
        if (currentBlock && allBlocks.length > 0) {
            const idx = allBlocks.indexOf(currentBlock);
            if ((event.key === 'ArrowUp' || event.key === 'Home') && idx === 0) {
                const sel = window.getSelection();
                if (sel.rangeCount > 0) {
                    const range = sel.getRangeAt(0);
                    const bc = currentBlock.querySelector('.block-content');
                    if ((range.startOffset === 0 || event.key === 'Home') && bc) {
                        event.preventDefault();
                        const restoreCursor = () => {
                            const r = document.createRange();
                            if (bc.firstChild) r.setStart(bc.firstChild, 0);
                            else { r.selectNodeContents(bc); r.collapse(true); }
                            sel.removeAllRanges(); sel.addRange(r);
                        };
                        restoreCursor();
                        // Retry once more in case contenteditable reflow moved cursor
                        requestAnimationFrame(restoreCursor);
                        return;
                    }
                }
            }
            if ((event.key === 'ArrowDown' || event.key === 'End') && idx === allBlocks.length - 1) {
                const sel = window.getSelection();
                if (sel.rangeCount > 0) {
                    const bc = currentBlock.querySelector('.block-content');
                    if (bc) {
                        const range = sel.getRangeAt(0);
                        const isAtEnd = () => {
                            if (event.key === 'End') return true;
                            const last = bc.lastChild;
                            if (!last) return true;
                            if (range.startContainer === last) return range.startOffset >= (last.nodeType === Node.TEXT_NODE ? last.length : 0);
                            if (range.startContainer === bc) return range.startOffset >= bc.childNodes.length;
                            return false;
                        };
                        if (isAtEnd()) {
                            event.preventDefault();
                            const restoreCursor = () => {
                                const r = document.createRange();
                                if (bc.lastChild) {
                                    const ln = bc.lastChild;
                                    if (ln.nodeType === Node.TEXT_NODE) r.setStart(ln, ln.length);
                                    else r.setStartAfter(ln);
                                } else { r.selectNodeContents(bc); }
                                r.collapse(false); sel.removeAllRanges(); sel.addRange(r);
                            };
                            restoreCursor();
                            requestAnimationFrame(restoreCursor);
                            return;
                        }
                    }
                }
            }
        }
    }

    // Forward-only mode blocks (blind mode enforces the same: no unseen edits)
    if (state.forwardOnlyMode || state.blindMode) {
        if (['Backspace', 'Delete'].includes(event.key)) { event.preventDefault(); return; }
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown', 'Tab'].includes(event.key)) { event.preventDefault(); return; }
        if ((event.ctrlKey || event.metaKey) && event.key === 'a') { event.preventDefault(); return; }
        if (event.shiftKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); return; }
    }

    // Enter — split block
    if (event.key === 'Enter') {
        event.preventDefault();
        const cb = getCurrentBlock(); if (!cb) return;
        const ce = cb.querySelector('.block-content'); if (!ce) return;
        recordCheckpoint();
        const tc = ce.textContent || '';
        const type = cb.dataset.type;

        if (tc.trim().length === 0 && (type === 'bullet' || type === 'numbered')) {
            cb.dataset.type = 'text'; cb.className = 'block block-text';
            const m = cb.querySelector('.block-marker'); if (m) m.remove();
            updateNumberedBlocks(); focusBlock(cb); return;
        }

        const sel = window.getSelection();
        const range = sel.getRangeAt(0);
        const afterRange = range.cloneRange();
        afterRange.selectNodeContents(ce);
        afterRange.setStart(range.startContainer, range.startOffset);
        // Extract as a fragment so inline formatting survives the split
        const fragment = afterRange.extractContents();
        const temp = document.createElement('div');
        temp.appendChild(fragment);
        const afterContent = temp.innerHTML;
        if (ce.childNodes.length === 0) ce.innerHTML = '<br>';

        const newType = (type === 'bullet' || type === 'numbered') ? type : 'text';
        const level = parseInt(cb.dataset.level) || 0;
        const nb = createBlockElement(newType, afterContent, level);
        cb.parentNode.insertBefore(nb, cb.nextSibling);
        if (type === 'numbered' || newType === 'numbered') updateNumberedBlocks();
        focusBlock(nb);
        // Splits don't fire 'input' (the keydown is preventDefaulted) — reflow
        // the comment cards alongside the moved text
        positionCards();
        return;
    }

    // Select-all delete: with center-mode spacers the range roots at the editor
    // itself and WebKit refuses to delete it — perform the wipe ourselves
    if (event.key === 'Backspace' || event.key === 'Delete') {
        const sel = window.getSelection();
        if (sel.rangeCount && !sel.isCollapsed) {
            const r = sel.getRangeAt(0);
            const blocks = editor.querySelectorAll('.block');
            if (r.startContainer === editor && r.endContainer === editor && blocks.length > 0
                && r.intersectsNode(blocks[0]) && r.intersectsNode(blocks[blocks.length - 1])) {
                event.preventDefault();
                recordCheckpoint();
                editor.innerHTML = '';
                const nb = createBlockElement('text', '');
                editor.appendChild(nb);
                if (state.centerMode) addCenterModeSpacers();
                const bc = nb.querySelector('.block-content');
                const nr = document.createRange();
                nr.selectNodeContents(bc); nr.collapse(true);
                sel.removeAllRanges(); sel.addRange(nr);
                autoSave();
                return;
            }
        }
    }

    // Backspace — merge blocks
    if (event.key === 'Backspace') {
        const sel = window.getSelection();
        if (!sel.rangeCount || !sel.isCollapsed) return;
        const cb = getCurrentBlock(); if (!cb) return;
        const ce = cb.querySelector('.block-content'); if (!ce) return;
        const allBlocks = editor.querySelectorAll('.block');
        if (allBlocks.length === 1 && (!ce.textContent || ce.textContent.trim() === '')) { event.preventDefault(); return; }

        const range = sel.getRangeAt(0);
        // At block start: offset 0 and no earlier siblings anywhere up to the content root
        const isAtBlockStart = () => {
            if (range.startOffset !== 0) return false;
            let node = range.startContainer;
            while (node && node !== ce) {
                if (node.previousSibling) return false;
                node = node.parentNode;
            }
            return node === ce;
        };
        if (isAtBlockStart()) {
            event.preventDefault();
            let prev = cb.previousElementSibling;
            // A non-block, non-spacer sibling is editing debris (normalize
            // handles the known shapes, but this is the writer's own gesture
            // for "delete the thing above me" — honor it directly)
            if (prev && !prev.classList.contains('block') && !prev.hasAttribute('data-spacer')) {
                recordCheckpoint();
                prev.remove();
                autoSave();
                positionCards();
                return;
            }
            if (!prev || !prev.classList.contains('block')) return;
            const pce = prev.querySelector('.block-content'); if (!pce) return;
            recordCheckpoint();
            if (pce.lastChild && pce.lastChild.nodeName === 'BR') pce.removeChild(pce.lastChild);

            // Move child nodes across so inline formatting survives the merge
            const anchor = pce.lastChild;
            while (ce.firstChild) {
                if (ce.firstChild.nodeName === 'BR') { ce.removeChild(ce.firstChild); continue; }
                pce.appendChild(ce.firstChild);
            }
            cb.remove();
            if (pce.childNodes.length === 0) pce.innerHTML = '<br>';
            updateNumberedBlocks();

            const r = document.createRange();
            if (anchor && anchor.parentNode === pce) r.setStartAfter(anchor);
            else r.setStart(pce, 0);
            r.collapse(true);
            sel.removeAllRanges(); sel.addRange(r);
            autoSave();
            positionCards();
            return;
        }
    }

    // Forward delete — merge the next block up. Without this the keystroke
    // fell through to WebKit, whose native merge doesn't know the block
    // structure and leaves the debris normalizeBlocks exists to clean up.
    // Mirror of the Backspace merge above.
    if (event.key === 'Delete') {
        const sel = window.getSelection();
        if (!sel.rangeCount || !sel.isCollapsed) return;
        const cb = getCurrentBlock(); if (!cb) return;
        const ce = cb.querySelector('.block-content'); if (!ce) return;

        const range = sel.getRangeAt(0);
        // At block end: nothing after the caret up to the content root, save
        // for the trailing <br> an empty or just-split block carries
        const isAtBlockEnd = () => {
            let node = range.startContainer;
            if (node.nodeType === Node.TEXT_NODE && range.startOffset < node.length) return false;
            if (node.nodeType === Node.ELEMENT_NODE) {
                for (let i = range.startOffset; i < node.childNodes.length; i++) {
                    const c = node.childNodes[i];
                    if (c.nodeName !== 'BR' && (c.textContent || '').length > 0) return false;
                }
            }
            while (node && node !== ce) {
                for (let sib = node.nextSibling; sib; sib = sib.nextSibling) {
                    if (sib.nodeName !== 'BR' && (sib.textContent || '').length > 0) return false;
                }
                node = node.parentNode;
            }
            return node === ce;
        };
        if (isAtBlockEnd()) {
            event.preventDefault();
            const next = cb.nextElementSibling;
            if (!next || next.hasAttribute('data-spacer')) return;
            recordCheckpoint();
            // Debris after the caret is deleted whole, same as backspace above
            if (!next.classList.contains('block')) { next.remove(); autoSave(); positionCards(); return; }
            const nce = next.querySelector('.block-content');
            if (!nce) { next.remove(); autoSave(); positionCards(); return; }

            if (ce.lastChild && ce.lastChild.nodeName === 'BR') ce.removeChild(ce.lastChild);
            const anchor = ce.lastChild;
            while (nce.firstChild) {
                if (nce.firstChild.nodeName === 'BR') { nce.removeChild(nce.firstChild); continue; }
                ce.appendChild(nce.firstChild);
            }
            next.remove();
            if (ce.childNodes.length === 0) ce.innerHTML = '<br>';
            updateNumberedBlocks();

            const r = document.createRange();
            if (anchor && anchor.parentNode === ce) r.setStartAfter(anchor);
            else r.setStart(ce, 0);
            r.collapse(true);
            sel.removeAllRanges(); sel.addRange(r);
            autoSave();
            positionCards();
            return;
        }
    }

    // Left arrow at beginning — jump to prev block
    if (event.key === 'ArrowLeft' && !state.forwardOnlyMode) {
        const sel = window.getSelection();
        if (!sel.rangeCount || !sel.isCollapsed) return;
        const cb = getCurrentBlock(); if (!cb) return;
        const ce = cb.querySelector('.block-content'); if (!ce) return;
        const range = sel.getRangeAt(0);
        const isAtBeginning = (range.startOffset === 0 && range.startContainer.nodeType === Node.TEXT_NODE && range.startContainer === ce.firstChild) || (range.startOffset === 0 && range.startContainer === ce);
        if (isAtBeginning) { event.preventDefault(); const prev = cb.previousElementSibling; if (prev) focusBlock(prev, true); return; }
    }

    // Tab / Shift+Tab
    if (event.key === 'Tab') {
        event.preventDefault();
        const sel = getSelectedBlocks();
        const blocks = sel.length > 1 ? sel : [getCurrentBlock()];
        if (!blocks[0]) return;
        recordCheckpoint();
        blocks.forEach(b => {
            const level = parseInt(b.dataset.level) || 0;
            b.dataset.level = event.shiftKey ? Math.max(0, level - 1) : level + 1;
        });
        updateNumberedBlocks(); autoSave();
        focusBlock(blocks[0], true); return;
    }

    // ArrowUp/Down navigation for multi-line blocks
    if (event.key === 'ArrowUp' && !event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
        const sel = window.getSelection(); if (!sel.rangeCount) return;
        const cb = getCurrentBlock(); if (!cb) return;
        const ce = cb.querySelector('.block-content'); if (!ce) return;
        const rects = sel.getRangeAt(0).getClientRects();
        if (rects.length > 0) {
            const cr = rects[0];
            const lh = parseInt(window.getComputedStyle(ce).lineHeight) || 20;
            // Probe only while the point stays inside this block: in the wider
            // paragraph-spacing gap the hit test snaps back to the caret's own
            // line, and the caret would stall instead of crossing blocks.
            if (cr.top - lh >= ce.getBoundingClientRect().top) {
                const tr = document.caretRangeFromPoint(cr.left, cr.top - lh);
                if (tr && ce.contains(tr.startContainer)) { event.preventDefault(); sel.removeAllRanges(); sel.addRange(tr); return; }
            }
        }
        // Siblings may be non-blocks (center-mode spacers) — only focus real blocks
        let prev = cb.previousElementSibling;
        while (prev && !(prev.classList && prev.classList.contains('block'))) prev = prev.previousElementSibling;
        if (prev) { event.preventDefault(); focusBlock(prev, true); return; }
        // Top of document — park the caret at the start rather than let the browser drop it
        event.preventDefault();
        const r = document.createRange();
        r.selectNodeContents(ce); r.collapse(true);
        sel.removeAllRanges(); sel.addRange(r);
        return;
    }

    if (event.key === 'ArrowDown' && !event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
        const sel = window.getSelection(); if (!sel.rangeCount) return;
        const cb = getCurrentBlock(); if (!cb) return;
        const ce = cb.querySelector('.block-content'); if (!ce) return;
        const rects = sel.getRangeAt(0).getClientRects();
        if (rects.length > 0) {
            const cr = rects[0];
            const lh = parseInt(window.getComputedStyle(ce).lineHeight) || 20;
            // Same guard as ArrowUp: don't let the probe land in the
            // inter-block gap and snap back to the caret's own line
            if (cr.bottom + lh <= ce.getBoundingClientRect().bottom) {
                const tr = document.caretRangeFromPoint(cr.left, cr.bottom + lh);
                if (tr && ce.contains(tr.startContainer)) { event.preventDefault(); sel.removeAllRanges(); sel.addRange(tr); return; }
            }
        }
        // Siblings may be non-blocks (center-mode spacers) — only focus real blocks
        let next = cb.nextElementSibling;
        while (next && !(next.classList && next.classList.contains('block'))) next = next.nextElementSibling;
        if (next) { event.preventDefault(); focusBlock(next, false); return; }
        // End of document — park the caret at the end rather than let the browser drop it
        event.preventDefault();
        const r = document.createRange();
        r.selectNodeContents(ce); r.collapse(false);
        sel.removeAllRanges(); sel.addRange(r);
        return;
    }

    // Alt+Arrow — move blocks
    if (event.altKey && !event.shiftKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault();
        moveBlocks(event.key === 'ArrowUp' ? -1 : 1);
        return;
    }

    // Cmd+Z / Cmd+Shift+Z — undo/redo (blocked in forward-only mode)
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) doRedo(); else doUndo();
        return;
    }

    // Cmd+D — delete block
    if ((event.ctrlKey || event.metaKey) && event.key === 'd') { event.preventDefault(); deleteBlocks(); return; }

    // Cmd+B / Cmd+I — formatting
    if ((event.ctrlKey || event.metaKey) && event.key === 'b') { event.preventDefault(); recordCheckpoint(); applyFormatting('bold'); return; }
    if ((event.ctrlKey || event.metaKey) && event.key === 'i') { event.preventDefault(); recordCheckpoint(); applyFormatting('italic'); return; }

    // Cmd+Alt+M — comment on selection (event.code: Alt+M types 'µ' on mac)
    if ((event.ctrlKey || event.metaKey) && event.altKey && event.code === 'KeyM') { event.preventDefault(); addCommentOnSelection(); return; }

    // Cmd+Alt+. / Cmd+Alt+, — cycle through comments; Cmd+Alt+R — reply to the active one
    if ((event.ctrlKey || event.metaKey) && event.altKey && event.code === 'Period') { event.preventDefault(); cycleComment(1); return; }
    if ((event.ctrlKey || event.metaKey) && event.altKey && event.code === 'Comma') { event.preventDefault(); cycleComment(-1); return; }
    if ((event.ctrlKey || event.metaKey) && event.altKey && event.code === 'KeyR') { event.preventDefault(); replyToActiveComment(); return; }

    // Quick comment mode: typing over a selection comments instead of replacing
    // ('/' stays reserved for the command menu)
    if (event.key.length === 1 && event.key !== '/' && !event.metaKey && !event.ctrlKey && !event.altKey && !state.commandModalOpen) {
        if (quickCommentFromTyping(event.key)) { event.preventDefault(); return; }
    }

    // Font size shortcuts
    if ((event.ctrlKey || event.metaKey) && (event.key === '=' || event.key === '+')) { event.preventDefault(); increaseFontSize(); return; }
    if ((event.ctrlKey || event.metaKey) && (event.key === '-' || event.key === '_')) { event.preventDefault(); decreaseFontSize(); return; }
    if ((event.ctrlKey || event.metaKey) && event.key === ']') { event.preventDefault(); increaseLineHeight(); return; }
    if ((event.ctrlKey || event.metaKey) && event.key === '[') { event.preventDefault(); decreaseLineHeight(); return; }
    if ((event.ctrlKey || event.metaKey) && (event.key === '}' || (event.shiftKey && event.code === 'BracketRight'))) { event.preventDefault(); increaseColumnWidth(); return; }
    if ((event.ctrlKey || event.metaKey) && (event.key === '{' || (event.shiftKey && event.code === 'BracketLeft'))) { event.preventDefault(); decreaseColumnWidth(); return; }

    // Cmd+S — save
    if ((event.metaKey || event.ctrlKey) && event.key === 's') { event.preventDefault(); quickSave(); return; }

    // Cmd+F — find
    if ((event.metaKey || event.ctrlKey) && event.key === 'f') { event.preventDefault(); openFindBar(); return; }

    // F11 — fullscreen
    if (event.key === 'F11') { event.preventDefault(); toggleFullscreen(); return; }

    // Slash — command modal
    const introModal = document.getElementById('intro-modal');
    const guideModalEl = document.getElementById('guide-modal');
    if (event.key === '/' && !state.commandModalOpen && introModal.classList.contains('hidden') && guideModalEl.classList.contains('hidden')) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        const sel = getSelectedBlocks();
        if (sel.length > 1) {
            state.multiBlockSelection = sel;
            const selection = window.getSelection();
            if (selection.rangeCount > 0) state.savedSelection = selection.getRangeAt(0).cloneRange();
            state.slashPosition = null;
            showCommandModal(); return;
        }

        const selection = window.getSelection();
        let range;
        if (selection.rangeCount > 0) { range = selection.getRangeAt(0); state.savedSelection = range.cloneRange(); }
        else { range = document.createRange(); range.selectNodeContents(editor); range.collapse(false); }

        state.slashPosition = { node: range.startContainer, offset: range.startOffset };
        showCommandModal(); return;
    }

    // Space in command modal — insert slash and close
    if (event.key === ' ' && state.commandModalOpen) {
        event.preventDefault();
        if (state.slashPosition && state.slashPosition.node) {
            const s = window.getSelection();
            const r = document.createRange();
            const t = document.createTextNode('/');
            r.setStart(state.slashPosition.node, state.slashPosition.offset);
            r.collapse(true); r.insertNode(t);
            r.setStartAfter(t); r.collapse(true);
            s.removeAllRanges(); s.addRange(r);
        }
        hideCommandModal(); return;
    }

    if (event.key === '/' && state.commandModalOpen) { event.preventDefault(); hideCommandModal(); return; }

    // Arrow nav in command modal
    if (state.commandModalOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault();
        const items = commandList.querySelectorAll('.command-item:not(.no-results)');
        state.selectedCommandIndex = event.key === 'ArrowDown'
            ? (state.selectedCommandIndex + 1) % items.length
            : (state.selectedCommandIndex - 1 + items.length) % items.length;
        items.forEach((it, i) => { it.classList.toggle('selected', i === state.selectedCommandIndex); it.setAttribute('aria-selected', i === state.selectedCommandIndex); });
        items[state.selectedCommandIndex]?.scrollIntoView({ block: 'nearest' });
    }

    if (state.commandModalOpen && event.key === 'Enter') {
        event.preventDefault();
        if (state.filteredCommandsList[state.selectedCommandIndex]) executeCommand(state.filteredCommandsList[state.selectedCommandIndex]);
    }
});

// ──────────────────────────────────
// Auto-convert markdown list syntax
// ──────────────────────────────────
editor.addEventListener('beforeinput', (event) => {
    if (event.isComposing) return;

    if (event.inputType === 'insertText' && event.data === ' ') {
        const cb = getCurrentBlock(); if (!cb) return;
        const ce = cb.querySelector('.block-content'); if (!ce) return;
        const tc = ce.textContent || '';

        if (tc.startsWith('>')) {
            event.preventDefault();
            cb.dataset.type = 'quote'; cb.className = 'block block-quote';
            ce.textContent = tc.slice(1).trimStart();
            focusBlock(cb, true); return;
        }
        if (tc.startsWith('-') || tc.startsWith('*')) {
            event.preventDefault();
            cb.dataset.type = 'bullet'; cb.className = 'block block-bullet';
            ce.textContent = tc.slice(1).trimStart();
            const m = document.createElement('span');
            m.className = 'block-marker bullet-marker'; m.contentEditable = 'false'; m.setAttribute('aria-hidden', 'true'); m.textContent = '•';
            cb.insertBefore(m, ce);
            focusBlock(cb, true); return;
        }
        const nm = tc.match(/^(\d{1,2})\./);
        if (nm) {
            event.preventDefault();
            cb.dataset.type = 'numbered'; cb.className = 'block block-numbered';
            ce.textContent = tc.slice(nm[0].length).trimStart();
            const m = document.createElement('span');
            m.className = 'block-marker number-marker'; m.contentEditable = 'false'; m.setAttribute('aria-hidden', 'true'); m.textContent = '1.';
            cb.insertBefore(m, ce);
            updateNumberedBlocks();
            focusBlock(cb, true); return;
        }
    }
});

// Route native undo/redo (menu or platform gestures) through our history
editor.addEventListener('beforeinput', (event) => {
    if (event.inputType === 'historyUndo') { event.preventDefault(); doUndo(); }
    else if (event.inputType === 'historyRedo') { event.preventDefault(); doRedo(); }
});

// Any edit about to swallow a non-collapsed selection gets a checkpoint FIRST.
// The typing debounce only records state 500ms after a burst ends — text typed
// and then immediately selected-and-replaced would otherwise exist in no
// snapshot, making the replacement unrecoverable by undo.
editor.addEventListener('beforeinput', (event) => {
    if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') return;
    const sel = window.getSelection();
    if (sel && sel.rangeCount && !sel.isCollapsed) recordCheckpoint();
});

// Quick comment mode backstop for insertions that never arrive as plain
// keydowns (Option-key characters, autocorrect replacements): the mode's
// contract is that typing never replaces a selection. Composition insertions
// aren't cancelable, so dead-key input can still replace — the checkpoint
// above keeps even that undoable.
editor.addEventListener('beforeinput', (event) => {
    if (event.isComposing || event.inputType !== 'insertText' || !event.data) return;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) return;
    if (quickCommentFromTyping(event.data)) event.preventDefault();
});

// Prevent typing outside blocks
editor.addEventListener('beforeinput', (event) => {
    if (!event.inputType.startsWith('insert') && !event.inputType.startsWith('delete')) return;
    const sel = window.getSelection();
    if (!sel.rangeCount || !sel.isCollapsed) return;
    let el = sel.getRangeAt(0).startContainer;
    el = el.nodeType === Node.TEXT_NODE ? el.parentElement : el;
    let inside = false;
    while (el && el !== editor) {
        if (el.classList && el.classList.contains('block-content')) { inside = true; break; }
        el = el.parentElement;
    }
    if (!inside) {
        let fb = editor.querySelector('.block');
        if (!fb) { fb = createBlockElement('text', ''); appendBlockToEditor(fb); }
        // Move the caret synchronously (focusBlock's rAF is too late) and let inserts
        // proceed there so the first keystroke isn't swallowed; deletes stay blocked
        const bc = fb.querySelector('.block-content');
        if (bc) {
            const r = document.createRange();
            r.selectNodeContents(bc); r.collapse(true);
            sel.removeAllRanges(); sel.addRange(r);
        }
        if (event.inputType.startsWith('delete')) event.preventDefault();
    }
});

// Editor input handler
editor.addEventListener('input', (event) => {
    // Native edits we didn't intercept (forward delete, cross-block deletions,
    // cut, dictation) can leave DOM that isn't a well-formed block — visible as
    // a blank line nothing can delete. Repair before anything else reads it.
    normalizeBlocks();

    // Deleting everything removes the last block and leaves the caret in the bare
    // editor, above where a first line renders — rebuild immediately, caret inside
    if (!editor.querySelector('.block')) {
        editor.innerHTML = '';
        const nb = createBlockElement('text', '');
        editor.appendChild(nb);
        if (state.centerMode) addCenterModeSpacers();
        const bc = nb.querySelector('.block-content');
        const r = document.createRange();
        r.selectNodeContents(bc); r.collapse(true);
        const s = window.getSelection();
        s.removeAllRanges(); s.addRange(r);
    }
    scheduleCheckpoint();
    if (state.blindMode) updateBlindCount();
    if (!document.getElementById('find-bar').classList.contains('hidden')) closeFindBar(false);

    // Strikethrough trigger (xxxx)
    const sel = window.getSelection();
    if (sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        const node = range.startContainer;
        if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent;
            const cp = range.startOffset;
            if (cp >= 4 && text.substring(cp - 4, cp) === 'xxxx') {
                const br = document.createRange();
                br.setStart(node, cp - 4); br.collapse(true);
                sel.removeAllRanges(); sel.addRange(br);
                strikethroughLastWord();
                const cb = getCurrentBlock();
                if (cb) {
                    const ce = cb.querySelector('.block-content');
                    if (ce) {
                        const walker = document.createTreeWalker(ce, NodeFilter.SHOW_TEXT, null, false);
                        let tn;
                        while (tn = walker.nextNode()) {
                            const idx = tn.textContent.indexOf('xxxx');
                            if (idx !== -1) { tn.textContent = tn.textContent.substring(0, idx) + tn.textContent.substring(idx + 4); break; }
                        }
                    }
                }
                return;
            }
        }
    }

    // Em dash trigger (--)
    if (event.inputType === 'insertText' && event.data === '-' && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        const node = range.startContainer;
        if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent;
            const cp = range.startOffset;
            if (cp >= 2 && text.substring(cp - 2, cp) === '--') {
                node.textContent = text.substring(0, cp - 2) + '—' + text.substring(cp);
                const r = document.createRange();
                r.setStart(node, cp - 1); r.collapse(true);
                sel.removeAllRanges(); sel.addRange(r);
            }
        }
    }

    // Clean up browser-inserted <p> tags
    editor.querySelectorAll(':scope > p').forEach(p => {
        const content = p.innerHTML;
        if (content.trim()) { p.replaceWith(createBlockElement('text', content)); }
        else p.remove();
    });

    // Ensure center mode spacers exist and still bracket the text — native
    // editing surgery can leave a block stranded outside them, where it renders
    // a viewport away from the document and can never be centered
    if (state.centerMode) {
        const top = document.getElementById('center-mode-top-spacer');
        const bottom = document.getElementById('center-mode-bottom-spacer');
        if (top !== editor.firstElementChild || bottom !== editor.lastElementChild) addCenterModeSpacers();
    }

    // Debounced word count
    if (state.wordCountVisible) debouncedWordCount();

    autoSave();
    debouncedUpdateFocusParagraph();
    centerCurrentBlock(true);

    // Enforce ephemeral limit (only on insertions)
    const isDeletion = event.inputType && (event.inputType.startsWith('delete') || event.inputType === 'historyUndo');
    if (!isDeletion) enforceEphemeralLimit();
});

// Copy handler
editor.addEventListener('copy', (event) => {
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const allBlocks = Array.from(editor.querySelectorAll('.block'));
    const range = sel.getRangeAt(0);
    const selected = allBlocks.filter(b => range.intersectsNode(b));
    if (selected.length === 0) return;

    const htmlParts = [];
    const textParts = [];
    const listStack = [];

    selected.forEach(block => {
        const ce = block.querySelector('.block-content'); if (!ce) return;
        const type = block.dataset.type;
        const level = parseInt(block.dataset.level) || 0;
        // innerHTML preserves inline formatting; textContent for the plain-text flavor
        const content = ce.innerHTML === '<br>' ? '' : ce.innerHTML;
        textParts.push(ce.textContent || '');

        if (type === 'bullet' || type === 'numbered') {
            const lt = type === 'bullet' ? 'ul' : 'ol';
            while (listStack.length > 0 && listStack[listStack.length - 1].level >= level) {
                const c = listStack.pop(); htmlParts.push('</li>', `</${c.type}>`);
            }
            if (listStack.length === 0 || listStack[listStack.length - 1].level < level) {
                htmlParts.push(`<${lt}>`); listStack.push({ type: lt, level });
            } else if (listStack.length > 0) htmlParts.push('</li>');
            htmlParts.push(`<li>${content}`);
        } else if (type === 'heading1' || type === 'heading2' || type === 'heading3') {
            while (listStack.length > 0) { const c = listStack.pop(); htmlParts.push('</li>', `</${c.type}>`); }
            const h = `h${type.slice(-1)}`;
            htmlParts.push(`<${h}>${content}</${h}>`);
        } else if (type === 'quote') {
            while (listStack.length > 0) { const c = listStack.pop(); htmlParts.push('</li>', `</${c.type}>`); }
            htmlParts.push(`<blockquote>${content}</blockquote>`);
        } else {
            while (listStack.length > 0) { const c = listStack.pop(); htmlParts.push('</li>', `</${c.type}>`); }
            htmlParts.push(`<p>${content}</p>`);
        }
    });
    while (listStack.length > 0) { const c = listStack.pop(); htmlParts.push('</li>', `</${c.type}>`); }

    event.preventDefault();
    event.clipboardData.setData('text/plain', textParts.join('\n'));
    event.clipboardData.setData('text/html', htmlParts.join(''));
});

// Drop already-sanitized inline HTML in at the caret, replacing any selection.
// Returns false if the caret isn't in the editor, so the caller can fall back
// to making blocks.
function insertInlineAtCaret(html) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return false;
    const range = sel.getRangeAt(0);
    const content = range.commonAncestorContainer;
    const host = content.nodeType === Node.ELEMENT_NODE ? content : content.parentElement;
    if (!host || !host.closest('.block-content')) return false;

    range.deleteContents();
    const frag = document.createRange().createContextualFragment(html);
    const last = frag.lastChild;
    range.insertNode(frag);
    if (last) {
        const after = document.createRange();
        after.setStartAfter(last);
        after.collapse(true);
        sel.removeAllRanges();
        sel.addRange(after);
    }
    return true;
}

// Paste handler
editor.addEventListener('paste', (event) => {
    const cd = event.clipboardData; if (!cd) return;
    recordCheckpoint();

    // Plain-text markdown → convert to blocks
    const html = cd.getData('text/html');
    if (!html || !(html.includes('<ul') || html.includes('<ol'))) {
        const text = cd.getData('text/plain');
        const looksLikeMarkdown = text && text.split('\n').some(l => /^(#{1,3}|[-*]|\d+\.|>)\s/.test(l.trim()));
        if (looksLikeMarkdown) {
            event.preventDefault();
            const blocks = markdownToBlocks(text);
            const cb = getCurrentBlock();
            if (cb && blocks.length > 0) {
                const anchor = cb.nextSibling;
                blocks.forEach(b => cb.parentNode.insertBefore(b, anchor));
                updateNumberedBlocks();
                focusBlock(blocks[blocks.length - 1], true);
                autoSave();
            }
            centerCurrentBlock(true); enforceEphemeralLimit();
            return;
        }
    }

    // Rich paste. The source document's styling — its fonts, sizes, colours,
    // link chrome — is not ours to carry; what survives is the formatting that
    // means something here: bold, italic, strike. See sanitize.js.
    if (html) {
        event.preventDefault();
        const parsed = blocksFromPastedHTML(html);
        if (parsed.length === 0) { centerCurrentBlock(true); enforceEphemeralLimit(); return; }

        // One plain paragraph joins the sentence you're in, rather than
        // becoming a block of its own.
        if (parsed.length === 1 && parsed[0].type === 'text' && insertInlineAtCaret(parsed[0].html)) {
            autoSave();
            centerCurrentBlock(true); enforceEphemeralLimit();
            return;
        }

        const blocks = parsed.map(b => createBlockElement(b.type, b.html, b.level));
        const cb = getCurrentBlock();
        if (cb && blocks.length > 0) {
            const anchor = cb.nextSibling;
            blocks.forEach(b => cb.parentNode.insertBefore(b, anchor));
            updateNumberedBlocks(); focusBlock(blocks[blocks.length - 1], true);
            autoSave();
        }
    }
    centerCurrentBlock(true); enforceEphemeralLimit();
});

// Click / mouse handlers
editor.addEventListener('click', (event) => {
    if (state.forwardOnlyMode || state.blindMode) { event.preventDefault(); return; }
    if (editor.querySelectorAll('.block').length === 0) {
        const fb = createBlockElement('text', ''); appendBlockToEditor(fb); focusBlock(fb);
    }
    updateFocusParagraph(); centerCurrentBlock();
});
editor.addEventListener('mousedown', (event) => { if (state.forwardOnlyMode || state.blindMode) { event.preventDefault(); return; } });
editor.addEventListener('keyup', () => { updateFocusParagraph(); centerCurrentBlock(true); });
editor.addEventListener('selectstart', (event) => { if (state.forwardOnlyMode || state.blindMode) event.preventDefault(); });
editor.addEventListener('contextmenu', (event) => { if (state.forwardOnlyMode || state.blindMode) event.preventDefault(); });

// Selection change
document.addEventListener('selectionchange', () => {
    if (state.fogMode) updateFogBlock();
    if (state.centerMode) {
        const anyModalOpen = ['command-modal', 'font-modal', 'model-modal', 'heading-modal', 'recent-modal', 'intro-modal', 'guide-modal', 'dialog-modal', 'find-bar']
            .some(id => !document.getElementById(id).classList.contains('hidden'));
        if (anyModalOpen) return;

        const sel = window.getSelection();
        if (sel.rangeCount > 0 && sel.isCollapsed && (document.activeElement === editor || editor.contains(document.activeElement))) {
            let node = sel.getRangeAt(0).startContainer;
            let el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
            let insideBlock = false, inTopSpacer = false;
            while (el && el !== editor) {
                if (el.classList && el.classList.contains('block-content')) { insideBlock = true; break; }
                if (el.id === 'center-mode-top-spacer') { inTopSpacer = true; break; }
                if (el.id === 'center-mode-bottom-spacer') break;
                el = el.parentElement;
            }
            if (!insideBlock) {
                const allBlocks = Array.from(editor.querySelectorAll('.block'));
                if (allBlocks.length > 0) focusBlock(inTopSpacer ? allBlocks[0] : allBlocks[allBlocks.length - 1], !inTopSpacer);
            }
        }
    }
    if (state.wordCountVisible) debouncedWordCount();
});

// ──────────────────────────────────
// Modal event wiring (using shared helpers)
// ──────────────────────────────────
const fontModal = document.getElementById('font-modal');
const headingModal = document.getElementById('heading-modal');
const introModal = document.getElementById('intro-modal');
const recentModal = document.getElementById('recent-modal');

// Close on click outside
[fontModal, headingModal, recentModal, document.getElementById('model-modal')].forEach(m => closeOnClickOutside(m));

// Recent files modal
document.getElementById('recent-cancel-button').addEventListener('click', () => closeModal(recentModal));
document.getElementById('recent-search').addEventListener('input', () => {
    state.selectedRecentIndex = 0;
    renderRecentList(filteredRecentFiles());
});

attachModalKeyboardNav(document.getElementById('recent-search'), recentModal, {
    getItems: () => document.getElementById('recent-list').querySelectorAll('.file-item'),
    getSelectedIndex: () => state.selectedRecentIndex,
    setSelectedIndex: (i) => { state.selectedRecentIndex = i; },
    onEnter: (idx) => { const files = filteredRecentFiles(); if (files[idx]) pickRecentFile(files[idx]); },
    onFilter: () => renderRecentList(filteredRecentFiles()),
});

// Find bar
document.getElementById('find-input').addEventListener('input', () => {
    updateFindCount(find.search(document.getElementById('find-input').value));
});
document.getElementById('find-input').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); updateFindCount(event.shiftKey ? find.prev() : find.next()); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); updateFindCount(find.next()); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); updateFindCount(find.prev()); }
    else if (event.key === 'Escape') { event.preventDefault(); closeFindBar(true); }
});

introModal.addEventListener('click', (e) => { if (e.target === introModal) { introModal.classList.add('hidden'); editor.focus(); } });
// Intro's "Shortcuts & Guide" link — close the intro and open the guide
introModal.addEventListener('click', (e) => { if (e.target.closest('#intro-guide-link')) { e.preventDefault(); introModal.classList.add('hidden'); showGuide(); } });

// Font modal
document.getElementById('font-cancel-button').addEventListener('click', closeFontModal);
document.getElementById('font-search').addEventListener('input', () => {
    const term = document.getElementById('font-search').value.toLowerCase();
    const fonts = getAllFonts().filter(f => f.toLowerCase().includes(term));
    state.selectedFontIndex = 0;
    renderFonts(fonts);
});

attachModalKeyboardNav(document.getElementById('font-search'), fontModal, {
    getItems: () => document.getElementById('font-list').querySelectorAll('.font-item'),
    getSelectedIndex: () => state.selectedFontIndex,
    setSelectedIndex: (i) => { state.selectedFontIndex = i; },
    onEnter: () => {
        const term = document.getElementById('font-search').value.trim();
        const fonts = getAllFonts().filter(f => f.toLowerCase().includes(term.toLowerCase()));
        if (fonts.length > 0) applyFont(fonts[state.selectedFontIndex]);
        else if (term) { if (addCustomFont(term)) applyFont(term); else showAlert(`Font "${term}" is not available on your system`); }
    },
    onFilter: () => {
        const items = document.getElementById('font-list').querySelectorAll('.font-item');
        items.forEach((it, i) => { it.classList.toggle('selected', i === state.selectedFontIndex); });
    },
});

// Heading modal
document.getElementById('heading-cancel-button').addEventListener('click', () => closeModal(headingModal));
document.getElementById('heading-search').addEventListener('input', () => {
    const term = document.getElementById('heading-search').value.toLowerCase();
    const headings = extractHeadings().filter(h => h.text.toLowerCase().includes(term));
    state.selectedHeadingIndex = 0;
    renderHeadings(headings);
});

// Claude model modal
document.getElementById('model-cancel-button').addEventListener('click', () => closeModal(document.getElementById('model-modal')));
document.getElementById('model-search').addEventListener('input', () => {
    state.selectedModelIndex = 0;
    renderModels(filteredModels());
});

attachModalKeyboardNav(document.getElementById('model-search'), document.getElementById('model-modal'), {
    getItems: () => document.getElementById('model-list').querySelectorAll('.font-item'),
    getSelectedIndex: () => state.selectedModelIndex,
    setSelectedIndex: (i) => { state.selectedModelIndex = i; },
    onEnter: (idx) => { const m = filteredModels()[idx]; if (m) applyModel(m.id); },
    onFilter: () => renderModels(filteredModels()),
});

attachModalKeyboardNav(document.getElementById('heading-search'), headingModal, {
    getItems: () => document.getElementById('heading-list').querySelectorAll('.heading-item'),
    getSelectedIndex: () => state.selectedHeadingIndex,
    setSelectedIndex: (i) => { state.selectedHeadingIndex = i; },
    onEnter: (idx) => {
        const term = document.getElementById('heading-search').value.trim();
        const headings = extractHeadings().filter(h => h.text.toLowerCase().includes(term.toLowerCase()));
        if (headings[idx]) jumpToHeading(headings[idx].element);
    },
    onFilter: () => {
        const term = document.getElementById('heading-search').value.toLowerCase();
        const headings = extractHeadings().filter(h => h.text.toLowerCase().includes(term));
        renderHeadings(headings);
    },
});

// Close intro modal on Escape or /
document.addEventListener('keydown', (event) => {
    if (!introModal.classList.contains('hidden') && (event.key === 'Escape' || event.key === '/')) { event.preventDefault(); introModal.classList.add('hidden'); editor.focus(); }
});

// Shortcuts & guide modal
const guideModal = document.getElementById('guide-modal');
const guideBody = document.getElementById('guide-body');
const guideExpandToggle = document.getElementById('guide-expand-toggle');

function closeGuide() { closeModal(guideModal); }
function toggleGuideRow(row) { if (row && row.classList.contains('has-detail')) row.classList.toggle('expanded'); }

closeOnClickOutside(guideModal);
guideBody.addEventListener('click', (e) => {
    const head = e.target.closest('.guide-row-head');
    if (head) toggleGuideRow(head.parentElement);
});
guideBody.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const head = e.target.closest('.guide-row-head');
    if (head) { e.preventDefault(); toggleGuideRow(head.parentElement); }
});
guideExpandToggle.addEventListener('click', () => {
    const rows = Array.from(guideModal.querySelectorAll('.guide-row.has-detail'));
    const anyCollapsed = rows.some(r => !r.classList.contains('expanded'));
    rows.forEach(r => r.classList.toggle('expanded', anyCollapsed));
    guideExpandToggle.textContent = anyCollapsed ? 'Collapse all' : 'Expand all';
});
document.addEventListener('keydown', (event) => {
    if (!guideModal.classList.contains('hidden') && (event.key === 'Escape' || event.key === '/')) { event.preventDefault(); event.stopPropagation(); closeGuide(); }
});

// File input fallback
document.getElementById('markdown-file-input').addEventListener('change', (event) => {
    const file = event.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const { prose, comments, raw } = splitComments(e.target.result);
        const blocks = markdownToBlocks(prose);
        editor.innerHTML = '';
        blocks.forEach(b => editor.appendChild(b));
        if (state.centerMode) addCenterModeSpacers();
        updateNumberedBlocks();
        setComments(comments, raw);
        renderCommentUI();
        resetHistory();
        if (blocks.length > 0) focusBlock(blocks[0]);
        document.getElementById('markdown-file-input').value = '';
    };
    reader.readAsText(file);
});

// ──────────────────────────────────
// Initialization
// ──────────────────────────────────
// Load preferences
try { state.commandUsage = JSON.parse(localStorage.getItem('commandUsage')) || {}; } catch (e) { state.commandUsage = {}; }
if (localStorage.getItem('darkMode') === 'true') document.body.classList.add('dark-mode');
if (localStorage.getItem('canvasMode') === 'true') document.body.classList.add('canvas-mode');
if (localStorage.getItem('forwardOnlyMode') === 'true') { state.forwardOnlyMode = true; document.body.classList.add('forward-only-mode'); }
if (localStorage.getItem('centerMode') === 'true') { state.centerMode = true; document.body.classList.add('center-mode'); }
if (localStorage.getItem('focusMode') === 'true') { state.focusMode = true; document.body.classList.add('focus-mode'); }
if (localStorage.getItem('paragraphSpacing') === 'true') { state.paragraphSpacing = true; document.body.classList.add('paragraph-spacing'); }
const savedLimit = localStorage.getItem('ephemeralWordLimit');
if (savedLimit) { const p = parseInt(savedLimit, 10); if (!isNaN(p) && p > 0) state.EPHEMERAL_WORD_LIMIT = p; }
if (localStorage.getItem('wordCountVisible') === 'true') { state.wordCountVisible = true; document.getElementById('word-count-display').classList.remove('hidden'); }
state.commentCountInPill = localStorage.getItem('commentCountInPill') === 'true';
const savedSpellcheck = localStorage.getItem('spellcheck');
editor.spellcheck = savedSpellcheck === null ? true : savedSpellcheck === 'true';
state.currentStage = localStorage.getItem('writingStage');

// Load autosaved content, then re-attach the synced file (if any)
loadContent();
initComments(autoSave);
resetHistory();
resumeRetypeIfActive();

// Reconcile with the disk at the window's focus/blur edges: coming back picks
// up changes other apps made to the file; leaving writes pending edits so
// other apps never read a stale file. No timers, no polling.
window.addEventListener('focus', checkExternalChanges);
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkExternalChanges();
    else flushAutoSave();
});
window.addEventListener('blur', flushAutoSave);

// Native shell pushes file-change events for the open file (the margin writing
// comments back) — reconcile without waiting for a focus edge, so notes arrive
// while you sit and read. Event-driven; the debounce is watcher hygiene.
window.__thesisFileDidChange = debounce(() => checkExternalChanges(), 400);

// Companion pass state, pushed by the shell. Surfaces only in the palette's
// status row — presence you can check, never presence that interrupts.
window.__thesisMarginState = (s) => {
    state.marginActivity = (s === 'reading' || s === 'checking') ? s : null;
    if (state.commandModalOpen) renderStatusHeader();
};

// Keep the optional pill count honest whenever the margin changes
document.addEventListener('thesis:comments-changed', () => {
    if (state.wordCountVisible && state.commentCountInPill) debouncedWordCount();
});
// A reload mid-retype must not reconnect the old file — the fresh draft
// would overwrite it on autosave
// Files opened from Finder (native shim queues any that arrived before now)
if (window.__thesisSetOpenHandler) window.__thesisSetOpenHandler(openExternalFile);
if (!state.retypeActive) setTimeout(() => restoreFileHandle(), 50);

// Show intro on first visit
if (!localStorage.getItem('hasSeenIntro')) {
    setTimeout(() => { showIntro(); localStorage.setItem('hasSeenIntro', 'true'); }, 100);
}

// Fallback: ensure at least one block exists
setTimeout(() => {
    if (editor.children.length === 0 || !editor.querySelector('.block')) {
        const fb = createBlockElement('text', ''); appendBlockToEditor(fb); focusBlock(fb);
    }
}, 100);

loadFont();
loadFontSize();
loadLineHeight();
loadColumnWidth();
loadCustomFonts();

// Native wrapper only: it exposes the Mac's installed font families, which the
// sandboxed webview can't otherwise see or enumerate. A no-op on the web.
if (window.__thesisInstalledFonts) {
    window.__thesisInstalledFonts().then(fonts => { state.installedFonts = fonts; }).catch(() => {});
}

