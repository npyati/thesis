// Retype mode — redraft by retyping. The old draft shows one paragraph at a
// time in a bar above a fresh document; nothing survives unless it's retyped.
// Skipping a paragraph (⌘↓ without typing) is deletion by omission.

import state from './state.js';
import { getEditor, createBlockElement, focusBlock } from './blocks.js';
import { htmlToMarkdown, autoSave, setSaveStatus } from './io.js';
import { clearFileHandleFromDB } from './db.js';
import { clearPageTitle } from './modes.js';
import { resetHistory } from './history.js';

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
    try {
        const saved = JSON.parse(localStorage.getItem('retypeSource'));
        if (!saved || !Array.isArray(saved.lines) || saved.lines.length === 0) {
            localStorage.removeItem('retypeActive');
            return;
        }
        sourceLines = saved.lines;
        index = Math.min(saved.index || 0, sourceLines.length);
        state.retypeActive = true;
        document.body.classList.add('retype-mode');
        renderBar();
    } catch (e) {
        localStorage.removeItem('retypeActive');
    }
}
