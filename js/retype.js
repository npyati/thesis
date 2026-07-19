// Retype mode — redraft by retyping. The old draft shows one paragraph at a
// time in a bar above a fresh document; nothing survives unless it's retyped.
// Skipping a paragraph (⌘↓ without typing) is deletion by omission.

import state from './state.js';
import { getEditor, createBlockElement, focusBlock, updateNumberedBlocks } from './blocks.js';
import { htmlToMarkdown, markdownToBlocks, autoSave, setSaveStatus } from './io.js';
import { clearFileHandleFromDB } from './db.js';
import { clearPageTitle } from './modes.js';
import { resetHistory, recordCheckpoint } from './history.js';

function readSavedSource() {
    try {
        const saved = JSON.parse(localStorage.getItem('retypeSource'));
        if (saved && Array.isArray(saved.lines) && saved.lines.length > 0) return saved;
    } catch (e) { /* corrupt entry */ }
    return null;
}

let sourceLines = [];
let index = 0;

// Persist across reloads: the old draft only exists here once the editor is cleared
function persist() {
    try {
        localStorage.setItem('retypeSource', JSON.stringify({ lines: sourceLines, index }));
        localStorage.setItem('retypeActive', 'true');
    } catch (e) {
        console.error('Failed to persist retype source:', e);
    }
}

function renderBar() {
    const bar = document.getElementById('retype-bar');
    const text = document.getElementById('retype-text');
    const counter = document.getElementById('retype-counter');
    bar.classList.remove('hidden');
    if (index >= sourceLines.length) {
        text.textContent = 'End of draft — finish with ⌘.';
        counter.textContent = `${sourceLines.length}/${sourceLines.length}`;
    } else {
        text.textContent = sourceLines[index];
        counter.textContent = `${index + 1}/${sourceLines.length}`;
    }
}

export async function startRetype(showAlertFn) {
    const editor = getEditor();
    const blocks = Array.from(editor.querySelectorAll('.block'));
    const lines = blocks
        .map(b => htmlToMarkdown(b.outerHTML).trim())
        .filter(l => l.length > 0);
    if (lines.length === 0) {
        if (showAlertFn) await showAlertFn('Nothing to retype — the document is empty.');
        return false;
    }
    sourceLines = lines;
    index = 0;

    // The new draft is a fresh, unsaved document; the original file (if any)
    // stays untouched on disk
    state.currentFileHandle = null;
    state.currentFileName = null;
    await clearFileHandleFromDB();
    clearPageTitle();
    setSaveStatus('hidden');
    state.currentDocumentIsEphemeral = false;

    editor.innerHTML = '';
    const first = createBlockElement('text', '');
    editor.appendChild(first);
    resetHistory();
    autoSave();
    focusBlock(first);

    state.retypeActive = true;
    document.body.classList.add('retype-mode');
    persist();
    renderBar();
    return true;
}

export function retypeNext() {
    if (!state.retypeActive) return;
    if (index < sourceLines.length) { index++; persist(); renderBar(); }
}

export function retypePrev() {
    if (!state.retypeActive) return;
    if (index > 0) { index--; persist(); renderBar(); }
}

export function endRetype() {
    if (!state.retypeActive) return;
    state.retypeActive = false;
    document.body.classList.remove('retype-mode');
    document.getElementById('retype-bar').classList.add('hidden');
    localStorage.removeItem('retypeActive');
    // retypeSource stays behind as a one-slot archive of the old draft
    getEditor().focus();
}

// Re-enter retype after a reload mid-session
export function resumeRetypeIfActive() {
    if (localStorage.getItem('retypeActive') !== 'true') return;
    const saved = readSavedSource();
    if (!saved) {
        localStorage.removeItem('retypeActive');
        return;
    }
    enterRetype(saved);
}

// Reopen the source bar where it was left — undoes an accidental ⌘.
// Works until the next retype overwrites the stored source.
export async function resumeRetype(showAlertFn) {
    if (state.retypeActive) return;
    const saved = readSavedSource();
    if (!saved) {
        if (showAlertFn) await showAlertFn('No retype session to resume.');
        return;
    }
    enterRetype(saved);
}

function enterRetype(saved) {
    sourceLines = saved.lines;
    index = Math.min(saved.index || 0, sourceLines.length);
    state.retypeActive = true;
    document.body.classList.add('retype-mode');
    persist();
    renderBar();
}

// Load the old draft from the last retype back into the editor.
// Undoable via Cmd+Z (a checkpoint is recorded before replacing).
export async function recoverLastSource(showAlertFn, showConfirmFn) {
    const saved = readSavedSource();
    if (!saved) {
        if (showAlertFn) await showAlertFn('No saved retype source found.');
        return;
    }
    if (showConfirmFn) {
        const confirmed = await showConfirmFn('Replace the current document with the last retype source? (Cmd+Z undoes this.)');
        if (!confirmed) return;
    }

    if (state.retypeActive) endRetype();
    recordCheckpoint();

    // The recovered draft is fresh and unsaved — detach any synced file so
    // autosave can't overwrite it with the old draft
    state.currentFileHandle = null;
    state.currentFileName = null;
    await clearFileHandleFromDB();
    clearPageTitle();
    setSaveStatus('hidden');
    state.currentDocumentIsEphemeral = false;

    const editor = getEditor();
    const blocks = markdownToBlocks(sourceLinesToMarkdown(saved.lines));
    editor.innerHTML = '';
    blocks.forEach(b => editor.appendChild(b));
    updateNumberedBlocks();
    autoSave();
    const firstBlock = editor.querySelector('.block');
    if (firstBlock) focusBlock(firstBlock);
}

function sourceLinesToMarkdown(lines) {
    return lines.join('\n');
}
