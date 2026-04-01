// Main application entry point — wires modules together, sets up event listeners

import state from './state.js';
import { debounce } from './utils.js';
import { getEditor, getCurrentBlock, getSelectedBlocks, createBlockElement, updateNumberedBlocks, focusBlock } from './blocks.js';
import { openModal, closeModal, closeOnClickOutside, attachModalKeyboardNav, showAlert, showConfirm } from './modals.js';
import { applyFormatting, strikethroughLastWord, deleteAllStrikethrough } from './formatting.js';
import {
    toggleForwardOnlyMode, toggleCenterMode, toggleFocusMode, toggleDarkMode,
    togglePageStyle, toggleFullscreen, addCenterModeSpacers, removeCenterModeSpacers,
    centerCurrentBlock, updateFocusParagraph, debouncedUpdateFocusParagraph,
    createNewEphemeralDocument, enforceEphemeralLimit, applyEphemeralFading,
    clearEphemeralFading, updateURL, clearURL, getDocIdFromURL,
    updatePageTitle, clearPageTitle,
} from './modes.js';
import {
    loadContent, autoSave, saveContent, saveToFile, saveToNewFile,
    importFromMarkdown, exportAsMarkdown, exportAllAsMarkdown, exportAsWord,
    copyAll, copyAsMarkdown, clearAll, clearStorage,
    getSavedDocuments, setSavedDocuments, performSave, quickSave,
    loadDocumentByName, loadDocumentById, deleteDocumentByName,
    migrateDocumentsWithIds, markdownToBlocks, restoreFileHandle,
} from './io.js';

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

function getAllFonts() { return [...state.customFonts, ...availableFonts]; }

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

function loadCustomFonts() { const saved = localStorage.getItem('customFonts'); if (saved) state.customFonts = JSON.parse(saved); }
function saveCustomFonts() { localStorage.setItem('customFonts', JSON.stringify(state.customFonts)); }
function addCustomFont(fontName) {
    if (!fontName || getAllFonts().some(f => f.toLowerCase() === fontName.toLowerCase())) return false;
    if (isFontAvailable(fontName)) { state.customFonts.unshift(fontName); saveCustomFonts(); return true; }
    return false;
}
function applyFont(font) { editor.style.fontFamily = font; localStorage.setItem('editorFont', font); closeFontModal(); }
function loadFont() { const f = localStorage.getItem('editorFont'); if (f) editor.style.fontFamily = f; }

function increaseFontSize() { state.currentFontSize = Math.min(state.currentFontSize + 2, 40); applyFontSize(); }
function decreaseFontSize() { state.currentFontSize = Math.max(state.currentFontSize - 2, 10); applyFontSize(); }
function applyFontSize() { editor.style.fontSize = state.currentFontSize + 'px'; localStorage.setItem('editorFontSize', state.currentFontSize); }
function loadFontSize() { const s = localStorage.getItem('editorFontSize'); if (s) { state.currentFontSize = parseInt(s); editor.style.fontSize = state.currentFontSize + 'px'; } }

function increaseLineHeight() { state.currentLineHeight = Math.min(state.currentLineHeight + 0.1, 2.5); applyLineHeight(); }
function decreaseLineHeight() { state.currentLineHeight = Math.max(state.currentLineHeight - 0.1, 1.0); applyLineHeight(); }
function applyLineHeight() { editor.style.lineHeight = state.currentLineHeight; localStorage.setItem('editorLineHeight', state.currentLineHeight); }
function loadLineHeight() { const l = localStorage.getItem('editorLineHeight'); if (l) { state.currentLineHeight = parseFloat(l); editor.style.lineHeight = state.currentLineHeight; } }

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
}

const debouncedWordCount = debounce(updateWordCount, 150);

function showWordCountToggle() {
    state.wordCountVisible = !state.wordCountVisible;
    localStorage.setItem('wordCountVisible', state.wordCountVisible);
    const display = document.getElementById('word-count-display');
    if (state.wordCountVisible) { display.classList.remove('hidden'); updateWordCount(); }
    else { display.classList.add('hidden'); }
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
// Document list rendering (shared pattern)
// ──────────────────────────────────
function renderDocList(listEl, docs, selectedIndex, onClick) {
    listEl.innerHTML = '';
    if (docs.length === 0) { listEl.innerHTML = '<div class="no-documents">No documents found</div>'; return; }
    docs.forEach((doc, i) => {
        const item = document.createElement('div');
        item.className = `document-item ${i === selectedIndex ? 'selected' : ''}`;
        item.setAttribute('role', 'option');
        const name = document.createElement('div');
        name.className = 'document-item-name';
        name.textContent = doc.name;
        const date = document.createElement('div');
        date.className = 'document-item-date';
        date.textContent = new Date(doc.timestamp).toLocaleString();
        item.appendChild(name);
        item.appendChild(date);
        item.addEventListener('click', () => onClick(doc));
        listEl.appendChild(item);
    });
}

// ──────────────────────────────────
// Save / Load / Delete document modals
// ──────────────────────────────────
function saveDocumentAs() {
    const modal = document.getElementById('save-modal');
    const input = document.getElementById('save-name-input');
    input.value = '';
    state.selectedSaveIndex = 0;
    renderDocList(document.getElementById('save-list'), getSavedDocuments(), 0, (doc) => { input.value = doc.name; input.focus(); });
    openModal(modal, input);
}

function loadDocument() {
    const docs = getSavedDocuments();
    if (docs.length === 0) { showAlert('No saved documents found.'); return; }
    const modal = document.getElementById('load-modal');
    const search = document.getElementById('load-search');
    search.value = '';
    state.selectedLoadIndex = 0;
    renderDocList(document.getElementById('load-list'), docs, 0, (doc) => loadDocumentByName(doc.name));
    openModal(modal, search);
}

function deleteDocument() {
    const docs = getSavedDocuments();
    if (docs.length === 0) { showAlert('No saved documents found.'); return; }
    const modal = document.getElementById('delete-modal');
    const search = document.getElementById('delete-search');
    search.value = '';
    state.selectedDeleteIndex = 0;
    renderDocList(document.getElementById('delete-list'), docs, 0, (doc) => deleteDocumentByName(doc.name));
    openModal(modal, search);
}

// ──────────────────────────────────
// Ephemeral word limit change
// ──────────────────────────────────
async function changeEphemeralWordLimit() {
    // BUG FIX: use separate local savedSelection (not shadowing global)
    const localSavedSelection = state.savedSelection;
    const commandModal = document.getElementById('command-modal');
    commandModal.classList.add('hidden');

    return new Promise((resolve) => {
        const dialogModal = document.getElementById('dialog-modal');
        const dialogMessage = document.getElementById('dialog-message');
        const dialogConfirmButton = document.getElementById('dialog-confirm-button');
        const dialogCancelButton = document.getElementById('dialog-cancel-button');

        const inputWrapper = document.createElement('div');
        inputWrapper.style.marginTop = '15px';
        const input = document.createElement('input');
        input.type = 'text';
        input.id = 'ephemeral-limit-input';
        input.value = state.EPHEMERAL_WORD_LIMIT;
        input.placeholder = 'Enter word limit...';
        input.setAttribute('autocomplete', 'off');
        input.style.cssText = 'width:100%;padding:14px 16px;font-size:15px;border:1px solid #ddd;border-radius:6px;outline:none;box-sizing:border-box;background:#fff;';
        inputWrapper.appendChild(input);

        dialogMessage.innerHTML = '';
        const title = document.createElement('div');
        title.textContent = 'Change Ephemeral Word Limit';
        title.style.marginBottom = '10px';
        dialogMessage.appendChild(title);
        dialogMessage.appendChild(inputWrapper);
        dialogConfirmButton.textContent = 'Save';
        dialogCancelButton.style.display = 'inline-block';

        const restoreCursor = () => {
            if (localSavedSelection) {
                try { const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(localSavedSelection); }
                catch (e) { editor.focus(); }
            }
        };

        const handleConfirm = async () => {
            const parsedLimit = parseInt(input.value.trim(), 10);
            if (isNaN(parsedLimit) || parsedLimit < 1) {
                dialogModal.classList.add('hidden'); cleanup(); restoreCursor();
                await showAlert('Please enter a valid number greater than 0.');
                resolve(); return;
            }
            state.EPHEMERAL_WORD_LIMIT = parsedLimit;
            localStorage.setItem('ephemeralWordLimit', parsedLimit);
            if (state.currentDocumentIsEphemeral) { updateWordCount(); applyEphemeralFading(); }
            dialogModal.classList.add('hidden'); cleanup(); restoreCursor();
            await showAlert(`Ephemeral word limit changed to ${parsedLimit} words.`);
            resolve();
        };

        const handleCancel = () => { dialogModal.classList.add('hidden'); cleanup(); restoreCursor(); resolve(); };

        const handleKeydown = (event) => {
            if (event.key === 'Enter') { event.preventDefault(); handleConfirm(); }
            else if (event.key === 'Escape') { event.preventDefault(); handleCancel(); }
        };

        const cleanup = () => {
            dialogConfirmButton.removeEventListener('click', handleConfirm);
            dialogCancelButton.removeEventListener('click', handleCancel);
            input.removeEventListener('keydown', handleKeydown);
        };

        dialogConfirmButton.addEventListener('click', handleConfirm);
        dialogCancelButton.addEventListener('click', handleCancel);
        input.addEventListener('keydown', handleKeydown);

        setTimeout(() => {
            dialogModal.classList.remove('hidden');
            setTimeout(() => { input.focus(); input.select(); }, 50);
        }, 100);
    });
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
    let blocksToDelete;
    if (state.multiBlockSelection.length > 0) blocksToDelete = state.multiBlockSelection;
    else { const sel = getSelectedBlocks(); blocksToDelete = sel.length > 0 ? sel : [getCurrentBlock()]; }
    if (!blocksToDelete[0]) return;

    let focusTarget = null;
    const first = blocksToDelete[0];
    if (first.previousElementSibling && first.previousElementSibling.classList.contains('block')) focusTarget = first.previousElementSibling;
    else { const last = blocksToDelete[blocksToDelete.length - 1]; if (last.nextElementSibling && last.nextElementSibling.classList.contains('block')) focusTarget = last.nextElementSibling; }
    blocksToDelete.forEach(b => b.remove());
    if (editor.querySelectorAll('.block').length === 0) { const nb = createBlockElement('text', ''); editor.appendChild(nb); focusTarget = nb; }
    updateNumberedBlocks(); state.multiBlockSelection = [];
    if (focusTarget) focusBlock(focusTarget, false);
    autoSave();
}

// ──────────────────────────────────
// PWA install
// ──────────────────────────────────
async function installApp() {
    if (state.deferredInstallPrompt) {
        state.deferredInstallPrompt.prompt();
        const { outcome } = await state.deferredInstallPrompt.userChoice;
        if (outcome === 'accepted') state.deferredInstallPrompt = null;
    } else if (window.matchMedia('(display-mode: standalone)').matches) {
        await showAlert('thesis is already installed as an app.');
    } else {
        await showAlert('To install thesis as an app, use your browser\'s "Install" or "Add to Home Screen" option.');
    }
}

// ──────────────────────────────────
// Intro
// ──────────────────────────────────
const introHTML = `<p><strong>thesis</strong> is a minimalist text editor.</p><p>It's designed for focus and creativity.</p><p>The whole thing works primarily through the keyboard. You shouldn't have to use the mouse.</p><p>Here are the basics</p><ul><li>Type / to open a popup menu of commands. Use arrow keys or search to pick one. When search returns only one command, pressing [enter] will execute.</li><li>Type / again to close the popup. Press [space] at the empty prompt to keep the /.</li><li>Nothing is sent or saved online. All documents are stored locally in your browser.</li></ul><p>That's enough for now. You can find the rest by exploring. There isn't much - just what's necessary.</p><p><strong>This is a work in progress.</strong> There are still plenty of bugs to fix and improvements to make. Send me a note if you have ideas.</p>`;

function showIntro() {
    document.getElementById('intro-text').innerHTML = introHTML;
    document.getElementById('intro-modal').classList.remove('hidden');
}

// ──────────────────────────────────
// Commands
// ──────────────────────────────────
const commands = [
    { name: 'Save', description: 'Save to current location (file or browser)', action: async () => { const result = await quickSave(); if (result === 'open-save-dialog') saveDocumentAs(); } },
    { name: 'Save to Browser As...', description: 'Save to browser storage with a name', action: saveDocumentAs },
    { name: 'Load from Browser', description: 'Load a document from browser storage', action: loadDocument },
    { name: 'Delete Document', description: 'Delete a saved document', action: deleteDocument },
    { name: 'New Ephemeral Document', description: 'Write in pure flow - oldest words fade away as new thoughts emerge', action: () => createNewEphemeralDocument(autoSave) },
    { name: 'Change Ephemeral Word Limit', description: 'Set how many words linger before fading into the past', action: changeEphemeralWordLimit },
    { name: 'Jump to Heading', description: 'Navigate to a heading in the document', action: openHeadingModal },
    { name: 'Heading 1', description: 'Format current line(s) as large heading', action: () => applyHeading(1) },
    { name: 'Heading 2', description: 'Format current line(s) as medium heading', action: () => applyHeading(2) },
    { name: 'Heading 3', description: 'Format current line(s) as small heading', action: () => applyHeading(3) },
    { name: 'Normal Text', description: 'Convert current line(s) to normal text', action: convertToNormalText },
    { name: 'Bullet List', description: 'Toggle bullet list for current line(s)', action: () => toggleListType('bullet') },
    { name: 'Numbered List', description: 'Toggle numbered list for current line(s)', action: () => toggleListType('numbered') },
    { name: 'Block Quote', description: 'Format current line(s) as a block quote', action: applyBlockQuote },
    { name: 'Strikethrough Last Word', description: 'Apply strikethrough to the last typed word (type xxxx)', action: strikethroughLastWord },
    { name: 'Delete All Strikethrough', description: 'Remove all struck-through words from document', action: deleteAllStrikethrough },
    { name: 'Change Font', description: 'Select font for the editor', action: openFontModal },
    { name: 'Increase Font Size', description: 'Make text larger (Ctrl/Cmd + +)', action: increaseFontSize },
    { name: 'Decrease Font Size', description: 'Make text smaller (Ctrl/Cmd + -)', action: decreaseFontSize },
    { name: 'Increase Line Height', description: 'Make text more spacious (Ctrl/Cmd + ])', action: increaseLineHeight },
    { name: 'Decrease Line Height', description: 'Make text more compact (Ctrl/Cmd + [)', action: decreaseLineHeight },
    { name: 'Toggle Forward-Only Mode', description: 'Prevent backspace, deletion, and cursor movement', action: toggleForwardOnlyMode },
    { name: 'Toggle Center Mode', description: 'Keep active line centered in viewport', action: toggleCenterMode },
    { name: 'Toggle Focus Mode', description: 'Fade non-active paragraphs', action: toggleFocusMode },
    { name: 'Toggle Page Style', description: 'Switch between page and canvas view', action: togglePageStyle },
    { name: 'Toggle Fullscreen', description: 'Enter/exit fullscreen mode (F11)', action: toggleFullscreen },
    { name: 'Toggle Dark Mode', description: 'Switch between light and dark theme', action: toggleDarkMode },
    { name: 'Toggle Word Count', description: 'Show/hide word and character count', action: showWordCountToggle },
    { name: 'New Document', description: 'Start a new document', action: clearAll },
    { name: 'Copy All', description: 'Copy all content to clipboard', action: copyAll },
    { name: 'Export as Word', description: 'Download content as Word (.docx) file', action: exportAsWord },
    { name: 'Export All as Markdown', description: 'Download all saved documents as .md files in a ZIP', action: exportAllAsMarkdown },
    { name: 'Copy as Markdown', description: 'Copy content as Markdown to clipboard', action: copyAsMarkdown },
    { name: 'Open File', description: 'Open and auto-sync with a .md file on disk', action: importFromMarkdown },
    { name: 'Save to File As...', description: 'Save and auto-sync to a .md file on disk', action: saveToNewFile },
    { name: 'Delete Block', description: 'Delete current block or selected blocks', action: deleteBlocks },
    { name: 'Show Intro', description: 'What is this?', action: showIntro },
    { name: 'Clear Storage', description: 'Clear auto-save from browser memory', action: clearStorage },
    { name: 'Install App', description: 'Install thesis as a standalone app (no browser chrome)', action: installApp },
];

// ──────────────────────────────────
// Command modal
// ──────────────────────────────────
const commandModal = document.getElementById('command-modal');
const commandSearch = document.getElementById('command-search');
const commandList = document.getElementById('command-list');
const modeStatus = document.getElementById('mode-status');

function filterCommands(searchTerm) {
    const commandUsage = JSON.parse(localStorage.getItem('commandUsage') || '{}');
    const filtered = commands.filter(cmd =>
        cmd.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        cmd.description.toLowerCase().includes(searchTerm.toLowerCase())
    );
    filtered.sort((a, b) => (commandUsage[b.name] || 0) - (commandUsage[a.name] || 0));

    if (state.currentDocumentName) {
        const qsc = {
            name: `Save to <em style="font-style: italic; opacity: 0.75;">${state.currentDocumentName}</em>`,
            description: 'Quick save to current document (Cmd+S)',
            action: async () => { const result = await quickSave(); if (result === 'open-save-dialog') saveDocumentAs(); },
            isQuickSave: true
        };
        if (!searchTerm || `save to ${state.currentDocumentName}`.toLowerCase().includes(searchTerm.toLowerCase())) {
            filtered.unshift(qsc);
        }
    }

    state.filteredCommandsList = filtered;
    state.selectedCommandIndex = 0;
    renderCommands(filtered);
}

function renderCommands(filteredCommands) {
    commandList.innerHTML = '';
    commandList.setAttribute('role', 'listbox');
    commandList.setAttribute('aria-label', 'Commands');

    if (filteredCommands.length === 0) {
        commandList.innerHTML = '<div class="command-item no-results" role="option">No commands found</div>';
        return;
    }

    filteredCommands.forEach((command, index) => {
        const item = document.createElement('div');
        item.className = `command-item ${index === state.selectedCommandIndex ? 'selected' : ''}`;
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', index === state.selectedCommandIndex);

        const nameEl = document.createElement('div');
        nameEl.className = 'command-name';
        if (command.isQuickSave) nameEl.innerHTML = command.name;
        else nameEl.textContent = command.name;

        const descEl = document.createElement('div');
        descEl.className = 'command-description';
        descEl.textContent = command.description;

        item.appendChild(nameEl);
        item.appendChild(descEl);
        item.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); executeCommand(command); });
        commandList.appendChild(item);
    });
}

function executeCommand(command) {
    if (state.savedSelection) {
        try { const s = window.getSelection(); s.removeAllRanges(); s.addRange(state.savedSelection); state.savedSelection = null; }
        catch (e) { console.error('Error restoring cursor:', e); }
    }
    state.slashPosition = null;
    state.commandModalOpen = false;
    commandModal.classList.add('hidden');
    state.multiBlockSelection = [];

    command.action();

    try {
        const usage = JSON.parse(localStorage.getItem('commandUsage') || '{}');
        usage[command.name] = Date.now();
        localStorage.setItem('commandUsage', JSON.stringify(usage));
    } catch (e) {}

    editor.focus();
}

function showCommandModal() {
    state.commandModalOpen = true;
    commandModal.classList.remove('hidden');
    commandModal.style.opacity = '0';
    commandSearch.value = '';
    filterCommands('');
    state.selectedCommandIndex = 0;

    // Mode status badges
    const modes = [];
    if (state.focusMode) modes.push('Focus');
    if (state.centerMode) modes.push('Center');
    if (state.forwardOnlyMode) modes.push('Forward-Only');
    if (state.currentDocumentIsEphemeral) modes.push('Ephemeral');
    if (document.body.classList.contains('dark-mode')) modes.push('Dark');
    if (state.wordCountVisible) modes.push('Word Count');

    if (modes.length > 0) {
        modeStatus.innerHTML = modes.map(m => `<span class="mode-badge" role="status">${m}</span>`).join('');
        modeStatus.style.display = 'flex';
    } else {
        modeStatus.innerHTML = '';
        modeStatus.style.display = 'none';
    }

    // Position modal near cursor
    setTimeout(() => {
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            let rect = null;
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

            let left = rect.left;
            let top = rect.bottom + 5;
            const modalWidth = 350;
            const modalHeight = commandModal.offsetHeight || 200;
            if (left + modalWidth > window.innerWidth) left = window.innerWidth - modalWidth - 10;
            const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
            if (top + modalHeight > vh) top = rect.top - modalHeight - 5;
            left = Math.max(10, left);
            top = Math.max(10, top);
            if (window.innerWidth < 768 && top > vh - 100) top = Math.max(10, vh - modalHeight - 20);

            commandModal.style.left = `${left}px`;
            commandModal.style.top = `${top}px`;
        }
        commandModal.style.opacity = '1';
        commandSearch.focus();
        commandSearch.setSelectionRange(0, 0);
    }, 0);
}

function hideCommandModal() {
    state.commandModalOpen = false;
    commandModal.classList.add('hidden');
    state.slashPosition = null;
    state.multiBlockSelection = [];

    if (state.savedSelection) {
        try { const s = window.getSelection(); s.removeAllRanges(); s.addRange(state.savedSelection); state.savedSelection = null; }
        catch (e) { editor.focus(); }
    } else { editor.focus(); }
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
editor.addEventListener('keydown', (event) => {
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
                        // BUG FIX: use retry approach for cursor restoration
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

    // Forward-only mode blocks
    if (state.forwardOnlyMode) {
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
        const afterContent = afterRange.toString();
        afterRange.deleteContents();
        if (ce.childNodes.length === 0) ce.innerHTML = '<br>';

        const newType = (type === 'bullet' || type === 'numbered') ? type : 'text';
        const level = parseInt(cb.dataset.level) || 0;
        const nb = createBlockElement(newType, afterContent, level);
        cb.parentNode.insertBefore(nb, cb.nextSibling);
        if (type === 'numbered' || newType === 'numbered') updateNumberedBlocks();
        focusBlock(nb);
        return;
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
        if (range.startOffset === 0 && range.startContainer === ce.firstChild) {
            event.preventDefault();
            const prev = cb.previousElementSibling;
            if (!prev) return;
            const pce = prev.querySelector('.block-content'); if (!pce) return;
            const prevLen = pce.textContent?.length || 0;
            if (pce.lastChild && pce.lastChild.nodeName === 'BR') pce.removeChild(pce.lastChild);
            const cc = ce.textContent || '';
            if (cc.length > 0) pce.appendChild(document.createTextNode(cc));
            cb.remove();
            updateNumberedBlocks();

            requestAnimationFrame(() => {
                let targetNode = null, targetOffset = prevLen, currentOffset = 0;
                for (const child of pce.childNodes) {
                    if (child.nodeType === Node.TEXT_NODE) {
                        const nl = child.textContent.length;
                        if (currentOffset + nl >= prevLen) { targetNode = child; targetOffset = prevLen - currentOffset; break; }
                        currentOffset += nl;
                    }
                }
                if (!targetNode) { targetNode = document.createTextNode(''); pce.appendChild(targetNode); targetOffset = 0; }
                const r = document.createRange(); r.setStart(targetNode, targetOffset); r.collapse(true);
                sel.removeAllRanges(); sel.addRange(r);
            });
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
        const rects = sel.getRangeAt(0).getClientRects(); if (rects.length === 0) return;
        const cr = rects[0];
        const lh = parseInt(window.getComputedStyle(ce).lineHeight) || 20;
        const tr = document.caretRangeFromPoint(cr.left, cr.top - lh);
        if (tr && ce.contains(tr.startContainer)) { event.preventDefault(); sel.removeAllRanges(); sel.addRange(tr); return; }
        const prev = cb.previousElementSibling;
        if (prev) { event.preventDefault(); focusBlock(prev, true); return; }
    }

    if (event.key === 'ArrowDown' && !event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
        const sel = window.getSelection(); if (!sel.rangeCount) return;
        const cb = getCurrentBlock(); if (!cb) return;
        const ce = cb.querySelector('.block-content'); if (!ce) return;
        const rects = sel.getRangeAt(0).getClientRects(); if (rects.length === 0) return;
        const cr = rects[0];
        const lh = parseInt(window.getComputedStyle(ce).lineHeight) || 20;
        const tr = document.caretRangeFromPoint(cr.left, cr.bottom + lh);
        if (tr && ce.contains(tr.startContainer)) { event.preventDefault(); sel.removeAllRanges(); sel.addRange(tr); return; }
        const next = cb.nextElementSibling;
        if (next) { event.preventDefault(); focusBlock(next, false); return; }
    }

    // Alt+Arrow — move blocks
    if (event.altKey && !event.shiftKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault();
        let blocks;
        if (state.multiBlockSelection.length > 0) blocks = state.multiBlockSelection;
        else { const sel = getSelectedBlocks(); blocks = sel.length > 1 ? sel : [getCurrentBlock()]; }
        if (!blocks[0]) return;

        if (event.key === 'ArrowUp') {
            if (!blocks[0].previousElementSibling) return;
            const target = blocks[0].previousElementSibling;
            for (let i = 0; i < blocks.length; i++) editor.insertBefore(blocks[i], target);
        } else {
            const last = blocks[blocks.length - 1];
            if (!last.nextElementSibling) return;
            const nextBlock = last.nextElementSibling;
            const targetPos = nextBlock.nextElementSibling;
            for (let i = blocks.length - 1; i >= 0; i--) {
                if (targetPos) editor.insertBefore(blocks[i], targetPos);
                else editor.appendChild(blocks[i]);
            }
        }
        updateNumberedBlocks(); autoSave();
        if (blocks.length === 1) focusBlock(blocks[0]);
        return;
    }

    // Cmd+D — delete block
    if ((event.ctrlKey || event.metaKey) && event.key === 'd') { event.preventDefault(); deleteBlocks(); return; }

    // Cmd+B / Cmd+I — formatting
    if ((event.ctrlKey || event.metaKey) && event.key === 'b') { event.preventDefault(); applyFormatting('bold'); return; }
    if ((event.ctrlKey || event.metaKey) && event.key === 'i') { event.preventDefault(); applyFormatting('italic'); return; }

    // Font size shortcuts
    if ((event.ctrlKey || event.metaKey) && (event.key === '=' || event.key === '+')) { event.preventDefault(); increaseFontSize(); return; }
    if ((event.ctrlKey || event.metaKey) && (event.key === '-' || event.key === '_')) { event.preventDefault(); decreaseFontSize(); return; }
    if ((event.ctrlKey || event.metaKey) && event.key === ']') { event.preventDefault(); increaseLineHeight(); return; }
    if ((event.ctrlKey || event.metaKey) && event.key === '[') { event.preventDefault(); decreaseLineHeight(); return; }

    // Cmd+S — save
    if ((event.metaKey || event.ctrlKey) && event.key === 's') { event.preventDefault(); quickSave().then(r => { if (r === 'open-save-dialog') saveDocumentAs(); }); return; }

    // F11 — fullscreen
    if (event.key === 'F11') { event.preventDefault(); toggleFullscreen(); return; }

    // Slash — command modal
    const introModal = document.getElementById('intro-modal');
    const deletedDocModal = document.getElementById('deleted-doc-modal');
    if (event.key === '/' && !state.commandModalOpen && introModal.classList.contains('hidden') && deletedDocModal.classList.contains('hidden')) {
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
        event.preventDefault();
        const fb = editor.querySelector('.block');
        if (fb) focusBlock(fb);
        else { const nb = createBlockElement('text', ''); editor.appendChild(nb); focusBlock(nb); }
    }
});

// Editor input handler
editor.addEventListener('input', (event) => {
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

    // Clean up browser-inserted <p> tags
    editor.querySelectorAll(':scope > p').forEach(p => {
        const content = p.innerHTML;
        if (content.trim()) { p.replaceWith(createBlockElement('text', content)); }
        else p.remove();
    });

    // Ensure center mode spacers
    if (state.centerMode && !document.getElementById('center-mode-top-spacer')) addCenterModeSpacers();

    // Debounced word count
    if (state.wordCountVisible) debouncedWordCount();

    autoSave();
    debouncedUpdateFocusParagraph();
    centerCurrentBlock(true);

    // Enforce ephemeral limit (only on insertions)
    const isDeletion = event.inputType && (event.inputType.startsWith('delete') || event.inputType === 'historyUndo');
    if (!isDeletion) enforceEphemeralLimit();

    applyEphemeralFading();
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
        const content = ce.textContent || '';
        textParts.push(content);

        if (type === 'bullet' || type === 'numbered') {
            const lt = type === 'bullet' ? 'ul' : 'ol';
            while (listStack.length > 0 && listStack[listStack.length - 1].level >= level) {
                const c = listStack.pop(); htmlParts.push('</li>', `</${c.type}>`);
            }
            if (listStack.length === 0 || listStack[listStack.length - 1].level < level) {
                htmlParts.push(`<${lt}>`); listStack.push({ type: lt, level });
            } else if (listStack.length > 0) htmlParts.push('</li>');
            htmlParts.push(`<li>${content}`);
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

// Paste handler
editor.addEventListener('paste', (event) => {
    const cd = event.clipboardData; if (!cd) return;
    const html = cd.getData('text/html');
    if (html && (html.includes('<ul') || html.includes('<ol'))) {
        event.preventDefault();
        const temp = document.createElement('div'); temp.innerHTML = html;
        const blocks = [];
        const convert = (node, level = 0) => {
            if (node.nodeName === 'UL' || node.nodeName === 'OL') {
                const type = node.nodeName === 'UL' ? 'bullet' : 'numbered';
                Array.from(node.children).forEach(child => {
                    if (child.nodeName === 'LI') {
                        let text = '';
                        Array.from(child.childNodes).forEach(n => { if (n.nodeType === Node.TEXT_NODE) text += n.textContent; });
                        if (text.trim()) blocks.push(createBlockElement(type, text.trim(), level));
                        Array.from(child.children).forEach(n => { if (n.nodeName === 'UL' || n.nodeName === 'OL') convert(n, level + 1); });
                    }
                });
            } else if (node.nodeName === 'P' || node.nodeName === 'DIV') {
                const text = node.textContent.trim();
                if (text) blocks.push(createBlockElement('text', text, 0));
            }
        };
        Array.from(temp.children).forEach(c => convert(c));

        const cb = getCurrentBlock();
        if (cb && blocks.length > 0) {
            blocks.forEach(b => cb.parentNode.insertBefore(b, cb.nextSibling));
            updateNumberedBlocks(); focusBlock(blocks[blocks.length - 1], true);
        }
    }
    centerCurrentBlock(true); enforceEphemeralLimit(); applyEphemeralFading();
});

// Click / mouse handlers
editor.addEventListener('click', (event) => {
    if (state.forwardOnlyMode) { event.preventDefault(); return; }
    if (editor.querySelectorAll('.block').length === 0) {
        const fb = createBlockElement('text', ''); editor.appendChild(fb); focusBlock(fb);
    }
    updateFocusParagraph(); centerCurrentBlock();
});
editor.addEventListener('mousedown', (event) => { if (state.forwardOnlyMode) { event.preventDefault(); return; } });
editor.addEventListener('keyup', () => { updateFocusParagraph(); centerCurrentBlock(true); });
editor.addEventListener('selectstart', (event) => { if (state.forwardOnlyMode) event.preventDefault(); });
editor.addEventListener('contextmenu', (event) => { if (state.forwardOnlyMode) event.preventDefault(); });

// Selection change
document.addEventListener('selectionchange', () => {
    if (state.centerMode) {
        const anyModalOpen = ['command-modal', 'save-modal', 'load-modal', 'delete-modal', 'font-modal', 'heading-modal', 'intro-modal', 'dialog-modal', 'deleted-doc-modal']
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
const saveModal = document.getElementById('save-modal');
const loadModal = document.getElementById('load-modal');
const deleteModal = document.getElementById('delete-modal');
const fontModal = document.getElementById('font-modal');
const headingModal = document.getElementById('heading-modal');
const introModal = document.getElementById('intro-modal');
const deletedDocModal = document.getElementById('deleted-doc-modal');

// Close on click outside
[saveModal, loadModal, deleteModal, fontModal, headingModal].forEach(m => closeOnClickOutside(m));

introModal.addEventListener('click', (e) => { if (e.target === introModal) { introModal.classList.add('hidden'); editor.focus(); } });
deletedDocModal.addEventListener('click', (e) => { if (e.target === deletedDocModal) { deletedDocModal.classList.add('hidden'); editor.focus(); } });

// Save modal
document.getElementById('save-confirm-button').addEventListener('click', performSave);
document.getElementById('save-name-input').addEventListener('input', () => {
    const term = document.getElementById('save-name-input').value.toLowerCase();
    const docs = getSavedDocuments().filter(d => d.name.toLowerCase().includes(term));
    state.selectedSaveIndex = 0;
    renderDocList(document.getElementById('save-list'), docs, 0, (doc) => { document.getElementById('save-name-input').value = doc.name; document.getElementById('save-name-input').focus(); });
});
document.getElementById('save-cancel-button').addEventListener('click', () => closeModal(saveModal));

attachModalKeyboardNav(document.getElementById('save-name-input'), saveModal, {
    getItems: () => document.getElementById('save-list').querySelectorAll('.document-item'),
    getSelectedIndex: () => state.selectedSaveIndex,
    setSelectedIndex: (i) => { state.selectedSaveIndex = i; },
    onEnter: () => {
        if (document.getElementById('save-name-input').value.trim()) performSave();
        else {
            const docs = getSavedDocuments();
            if (docs[state.selectedSaveIndex]) document.getElementById('save-name-input').value = docs[state.selectedSaveIndex].name;
        }
    },
    onFilter: () => {
        const term = document.getElementById('save-name-input').value.toLowerCase();
        const docs = getSavedDocuments().filter(d => d.name.toLowerCase().includes(term));
        renderDocList(document.getElementById('save-list'), docs, state.selectedSaveIndex, (doc) => { document.getElementById('save-name-input').value = doc.name; });
    },
});

// Load modal
document.getElementById('load-cancel-button').addEventListener('click', () => closeModal(loadModal));
document.getElementById('load-search').addEventListener('input', () => {
    const term = document.getElementById('load-search').value.toLowerCase();
    const docs = getSavedDocuments().filter(d => d.name.toLowerCase().includes(term));
    state.selectedLoadIndex = 0;
    renderDocList(document.getElementById('load-list'), docs, 0, (doc) => loadDocumentByName(doc.name));
});

attachModalKeyboardNav(document.getElementById('load-search'), loadModal, {
    getItems: () => document.getElementById('load-list').querySelectorAll('.document-item'),
    getSelectedIndex: () => state.selectedLoadIndex,
    setSelectedIndex: (i) => { state.selectedLoadIndex = i; },
    onEnter: (idx) => {
        const term = document.getElementById('load-search').value.toLowerCase();
        const docs = getSavedDocuments().filter(d => d.name.toLowerCase().includes(term));
        if (docs.length === 1) loadDocumentByName(docs[0].name);
        else if (docs[idx]) loadDocumentByName(docs[idx].name);
    },
    onFilter: () => {
        const term = document.getElementById('load-search').value.toLowerCase();
        const docs = getSavedDocuments().filter(d => d.name.toLowerCase().includes(term));
        renderDocList(document.getElementById('load-list'), docs, state.selectedLoadIndex, (doc) => loadDocumentByName(doc.name));
    },
});

// Delete modal
document.getElementById('delete-cancel-button').addEventListener('click', () => closeModal(deleteModal));
document.getElementById('delete-search').addEventListener('input', () => {
    const term = document.getElementById('delete-search').value.toLowerCase();
    const docs = getSavedDocuments().filter(d => d.name.toLowerCase().includes(term));
    state.selectedDeleteIndex = 0;
    renderDocList(document.getElementById('delete-list'), docs, 0, (doc) => deleteDocumentByName(doc.name));
});

attachModalKeyboardNav(document.getElementById('delete-search'), deleteModal, {
    getItems: () => document.getElementById('delete-list').querySelectorAll('.document-item'),
    getSelectedIndex: () => state.selectedDeleteIndex,
    setSelectedIndex: (i) => { state.selectedDeleteIndex = i; },
    onEnter: (idx) => {
        const term = document.getElementById('delete-search').value.toLowerCase();
        const docs = getSavedDocuments().filter(d => d.name.toLowerCase().includes(term));
        if (docs.length === 1) deleteDocumentByName(docs[0].name);
        else if (docs[idx]) deleteDocumentByName(docs[idx].name);
    },
    onFilter: () => {
        const term = document.getElementById('delete-search').value.toLowerCase();
        const docs = getSavedDocuments().filter(d => d.name.toLowerCase().includes(term));
        renderDocList(document.getElementById('delete-list'), docs, state.selectedDeleteIndex, (doc) => deleteDocumentByName(doc.name));
    },
});

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

// Deleted doc modal
document.getElementById('deleted-doc-ok-button').addEventListener('click', () => { deletedDocModal.classList.add('hidden'); editor.focus(); });

// Close intro / deleted doc modal on Escape or /
document.addEventListener('keydown', (event) => {
    if (!introModal.classList.contains('hidden') && (event.key === 'Escape' || event.key === '/')) { event.preventDefault(); introModal.classList.add('hidden'); editor.focus(); }
    if (!deletedDocModal.classList.contains('hidden') && (event.key === 'Escape' || event.key === '/')) { event.preventDefault(); deletedDocModal.classList.add('hidden'); editor.focus(); }
});

// File input fallback
document.getElementById('markdown-file-input').addEventListener('change', (event) => {
    const file = event.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const blocks = markdownToBlocks(e.target.result);
        editor.innerHTML = '';
        blocks.forEach(b => editor.appendChild(b));
        updateNumberedBlocks();
        if (blocks.length > 0) focusBlock(blocks[0]);
        document.getElementById('markdown-file-input').value = '';
    };
    reader.readAsText(file);
});

// Mobile tap handler
function handleMobileCanvasTap(event) {
    if (window.innerWidth >= 768) return;
    const target = event.target || (event.changedTouches && event.changedTouches[0]?.target);
    if (!target) return;
    if (target.classList?.contains('block-content') || target.closest('.block-content')) return;
    if (!commandModal.classList.contains('hidden') || !introModal.classList.contains('hidden')) return;

    state.commandModalOpen = true;
    commandModal.classList.remove('hidden');
    commandSearch.value = '';
    filterCommands('');
    state.selectedCommandIndex = 0;

    setTimeout(() => {
        const mw = 350;
        const left = Math.max(10, (window.innerWidth - mw) / 2);
        const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
        commandModal.style.left = `${left}px`;
        commandModal.style.top = `${Math.max(10, Math.min(60, vh * 0.1))}px`;
        commandSearch.blur();
    }, 0);
}
editor.addEventListener('click', handleMobileCanvasTap);
editor.addEventListener('touchend', handleMobileCanvasTap);

if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
        if (!commandModal.classList.contains('hidden')) {
            const vh = window.visualViewport.height;
            const mh = commandModal.offsetHeight || 200;
            let top = parseInt(commandModal.style.top) || 10;
            if (top + mh > vh) commandModal.style.top = `${Math.max(10, vh - mh - 20)}px`;
        }
    });
}

// ──────────────────────────────────
// Initialization
// ──────────────────────────────────
// Load preferences
if (localStorage.getItem('darkMode') === 'true') document.body.classList.add('dark-mode');
if (localStorage.getItem('canvasMode') === 'true') document.body.classList.add('canvas-mode');
if (localStorage.getItem('forwardOnlyMode') === 'true') { state.forwardOnlyMode = true; document.body.classList.add('forward-only-mode'); }
if (localStorage.getItem('centerMode') === 'true') { state.centerMode = true; document.body.classList.add('center-mode'); }
if (localStorage.getItem('focusMode') === 'true') { state.focusMode = true; document.body.classList.add('focus-mode'); }
const savedLimit = localStorage.getItem('ephemeralWordLimit');
if (savedLimit) { const p = parseInt(savedLimit, 10); if (!isNaN(p) && p > 0) state.EPHEMERAL_WORD_LIMIT = p; }
if (localStorage.getItem('wordCountVisible') === 'true') { state.wordCountVisible = true; document.getElementById('word-count-display').classList.remove('hidden'); }

// Load content
loadContent();
migrateDocumentsWithIds();

// Check URL for document ID
const docIdFromURL = getDocIdFromURL();
if (docIdFromURL) {
    setTimeout(() => loadDocumentById(docIdFromURL), 50);
} else {
    setTimeout(() => restoreFileHandle(), 50);
}

// Show intro on first visit
if (!localStorage.getItem('hasSeenIntro')) {
    setTimeout(() => { showIntro(); localStorage.setItem('hasSeenIntro', 'true'); }, 100);
}

// Fallback: ensure at least one block exists
setTimeout(() => {
    if (editor.children.length === 0 || !editor.querySelector('.block')) {
        const fb = createBlockElement('text', ''); editor.appendChild(fb); focusBlock(fb);
    }
}, 100);

loadFont();
loadFontSize();
loadLineHeight();
loadCustomFonts();

// Register service worker
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
        .then(() => console.log('Service worker registered'))
        .catch((err) => console.log('Service worker registration failed:', err));
}

// PWA install prompt
window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    state.deferredInstallPrompt = event;
});

document.addEventListener('fullscreenchange', () => {});
