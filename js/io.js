// File I/O, autosave persistence, markdown conversion, import/export

import state from './state.js';
import { getEditor, createBlockElement, updateNumberedBlocks, focusBlock, normalizeBlocks } from './blocks.js';
import { saveFileHandleToDB, loadFileHandleFromDB, clearFileHandleFromDB, addRecentFile, removeRecentFile } from './db.js';
import { generateTimestampedFilename } from './utils.js';
import { sanitizeHTML } from './sanitize.js';
import { showAlert, showConfirm } from './modals.js';
import { resetHistory } from './history.js';
import {
    updatePageTitle, clearPageTitle,
    addCenterModeSpacers, centerCurrentBlock,
} from './modes.js';
import {
    splitComments, getCommentBlock, setComments,
    getMarginBlock, setMargin, noteArrivals,
    syncAnchorsFromDOM, unwrapMarks, renderCommentUI,
} from './comments.js';

// ──────────────────────────────────
// Auto-save with debouncing
// ──────────────────────────────────
export function saveContent() {
    // Comment highlights may have been edited along with the text — refresh the
    // stored anchors from the live marks before persisting anything
    syncAnchorsFromDOM();
    // Serialize without center-mode spacers or comment marks so neither leaks
    // into stored content — highlights are re-derived from anchors on load
    const clone = getEditor().cloneNode(true);
    clone.querySelectorAll('[data-spacer]').forEach(spacer => spacer.remove());
    unwrapMarks(clone);
    try {
        const saveData = {
            content: clone.innerHTML,
            isEphemeral: state.currentDocumentIsEphemeral,
            comments: state.comments,
            commentsRaw: state.commentsRaw,
            margin: state.margin,
            marginRaw: state.marginRaw,
        };
        localStorage.setItem('editorContent', JSON.stringify(saveData));
    } catch (e) {
        console.error('Failed to save: storage quota exceeded', e);
    }
}

export function autoSave() {
    clearTimeout(state.saveTimeout);
    state.autoSavePending = true;
    state.saveTimeout = setTimeout(async () => {
        state.autoSavePending = false;
        saveContent();
        if (state.currentFileHandle) {
            await saveToFile();
        }
    }, 1000);
}

// Write any pending edits immediately — called when the window loses focus,
// so another app never reads a file that's behind the editor
export function flushAutoSave() {
    if (!state.autoSavePending) return;
    clearTimeout(state.saveTimeout);
    state.autoSavePending = false;
    saveContent();
    if (state.currentFileHandle) saveToFile();
}

// ──────────────────────────────────
// Load content from localStorage
// ──────────────────────────────────
export function loadContent() {
    const editor = getEditor();
    const savedData = localStorage.getItem('editorContent');

    if (savedData) {
        try {
            const parsed = JSON.parse(savedData);
            editor.innerHTML = sanitizeHTML(parsed.content);
            state.currentDocumentIsEphemeral = parsed.isEphemeral || false;
            state.comments = Array.isArray(parsed.comments) ? parsed.comments : [];
            state.commentsRaw = parsed.commentsRaw || null;
            state.margin = parsed.margin || null;
            state.marginRaw = parsed.marginRaw || null;
        } catch (e) {
            editor.innerHTML = sanitizeHTML(savedData);
            state.currentDocumentIsEphemeral = false;
            state.comments = [];
            state.commentsRaw = null;
            state.margin = null;
            state.marginRaw = null;
        }

        if (editor.children.length === 0) {
            editor.appendChild(createBlockElement('text', ''));
            return;
        }

        if (!editor.querySelector('.block')) {
            editor.innerHTML = '';
            editor.appendChild(createBlockElement('text', ''));
            return;
        }

        // Repair any malformed structure in the loaded HTML — same invariant,
        // same fixer, as the per-input repair
        normalizeBlocks();

        updateNumberedBlocks();
        const firstBlock = editor.querySelector('.block');
        if (firstBlock) focusBlock(firstBlock);
    } else {
        editor.appendChild(createBlockElement('text', ''));
        focusBlock(editor.querySelector('.block'));
    }

    if (state.centerMode) {
        requestAnimationFrame(() => {
            addCenterModeSpacers();
            requestAnimationFrame(() => centerCurrentBlock(true));
        });
    }
}

// ──────────────────────────────────
// Save-state — surfaced in the command palette, not on the canvas
// ──────────────────────────────────
export function setSaveStatus(status) { // 'synced' | 'saving' | 'detached' | 'hidden'
    state.saveStatus = status;
}

// ──────────────────────────────────
// File operations
// ──────────────────────────────────
// External-change tracking. No timers: the window's focus/blur edges and each
// save are the sync points where thesis reconciles with the disk.
let lastDiskText = null;    // file content as last read from / written to disk
let lastSerialized = null;  // this document's serialization at that same moment
let conflictOpen = false;
let refreshInFlight = false;

function rememberFileState(disk, serialized) {
    lastDiskText = disk;
    lastSerialized = serialized;
}

async function readDisk() {
    const file = await state.currentFileHandle.getFile();
    return await file.text();
}

// ── The margin companion (native shell only) ──
// The shell hosts the reader: whenever the open file is invited, a companion
// process is attached to it; whenever it isn't, there is none. Called after
// every event that can change that truth — load, save-as, invite/revoke,
// external margin-block change, close, detach.
export function syncMarginProcess() {
    if (!window.__thesisStartMargin) return;   // web build — companion runs by hand
    const h = state.currentFileHandle;
    const invited = !!(state.margin && state.margin.invited) && !state.marginRaw;
    if (h && h.isNativePath && invited && !state.currentDocumentIsEphemeral) {
        window.__thesisStartMargin(h.path, localStorage.getItem('marginModel') || '');
    } else {
        window.__thesisStopMargin();
    }
}

// ── Comment-only external changes ──
// The margin companion (and any other tool that speaks the format) writes
// comments while thesis may
// hold unsaved prose edits. When the disk change left the prose alone, merge
// the comment blocks in place — no reload, no dialog, the caret never moves.

// One comment merged three ways: base = as last seen on disk, ext = disk now,
// local = the editor. External wins where it moved relative to base; local
// wins otherwise (its anchors are the live truth).
function mergeComment(base, ext, local) {
    const merged = { ...local };
    const rKey = (r) => `${r.author}|${r.created}|${r.body}`;
    const seen = new Set((local.replies || []).map(rKey));
    merged.replies = [...(local.replies || [])];
    for (const r of (ext.replies || [])) {
        if (!seen.has(rKey(r))) { merged.replies.push(r); seen.add(rKey(r)); }
    }
    merged.replies.sort((a, b) => String(a.created).localeCompare(String(b.created)));
    if (!base || ext.resolved !== base.resolved) merged.resolved = ext.resolved;
    if (!base || ext.body !== base.body) merged.body = ext.body;
    if (ext.fix && !local.fix) merged.fix = ext.fix;
    return merged;
}

function tryAdoptExternalComments(diskText) {
    if (lastDiskText === null) return false;
    const base = splitComments(lastDiskText);
    const ext = splitComments(diskText);
    // Only safe when parsing is clean on all sides and the prose is untouched
    if (ext.raw || base.raw || state.commentsRaw) return false;
    if (ext.prose !== base.prose) return false;

    syncAnchorsFromDOM();
    const localById = new Map((state.comments || []).map(c => [c.id, c]));
    const baseById = new Map((base.comments || []).map(c => [c.id, c]));
    let arrivals = 0;
    const arrivedCards = [];
    const arrivedReplies = [];
    const rKey = (r) => `${r.author}|${r.created}|${r.body}`;
    const merged = [];
    for (const e of (ext.comments || [])) {
        const l = localById.get(e.id);
        if (l) {
            const m = mergeComment(baseById.get(e.id), e, l);
            const had = new Set((l.replies || []).map(rKey));
            for (const r of (m.replies || [])) {
                if (r.author && r.author !== 'me' && !had.has(rKey(r))) {
                    arrivals++;
                    arrivedReplies.push(`${m.id}|${r.author}|${r.created}`);
                }
            }
            merged.push(m);
            localById.delete(e.id);
        } else if (!baseById.has(e.id)) {
            merged.push(e);   // new external comment
            if (e.author && e.author !== 'me') { arrivals++; arrivedCards.push(e.id); }
        }
        // else: the writer deleted it locally since base — it stays deleted
    }
    // Comments only the editor has: new local (unsaved yet) — keep them.
    for (const c of (state.comments || [])) {
        if (localById.has(c.id)) merged.push(c);
    }
    state.comments = merged;
    // An externally edited margin block (brief, invitation) rides along
    if (JSON.stringify(ext.margin || null) !== JSON.stringify(base.margin || null)) {
        setMargin(ext.margin, ext.marginRaw);
        syncMarginProcess();
    }
    if (arrivals > 0) state.newClaudeArrivals += arrivals;
    noteArrivals(arrivedCards, arrivedReplies);
    lastDiskText = diskText;
    renderCommentUI();
    saveContent();
    return true;
}

// Both sides changed — never pick silently, and give the choice real labels:
// this is the one dialog in the app where a misread button loses writing.
async function resolveConflict(diskText) {
    if (conflictOpen) return;
    conflictOpen = true;
    const useDisk = await showConfirm(
        'This file was changed by another app while you also have unsaved edits here. ' +
        'Which version should win? Loading the file’s version discards your unsaved ' +
        'edits; keeping yours overwrites the file.',
        { okText: 'Load file’s version', cancelText: 'Keep mine' }
    );
    conflictOpen = false;
    if (useDisk) {
        await loadFileIntoEditor(state.currentFileHandle, state.currentFileName);
        resetHistory();
    } else {
        lastDiskText = diskText;   // treat the disk state as seen, then overwrite it
        await saveToFile();
    }
}

// Re-read the connected file if another app changed it. Reloads silently when
// the editor has nothing unsaved; asks when both sides changed.
export async function checkExternalChanges() {
    if (!state.currentFileHandle || refreshInFlight || conflictOpen) return;
    refreshInFlight = true;
    try {
        const disk = await readDisk();
        if (lastDiskText === null || disk === lastDiskText) return;
        if (tryAdoptExternalComments(disk)) return;
        if (serializeDocument() === lastSerialized) {
            const editor = getEditor();
            const scroll = editor.scrollTop;
            await loadFileIntoEditor(state.currentFileHandle, state.currentFileName);
            resetHistory();
            editor.scrollTop = scroll;
        } else {
            await resolveConflict(disk);
        }
    } catch (error) {
        console.error('External change check failed:', error);
    } finally {
        refreshInFlight = false;
    }
}

// Manual refresh (the "Reload File" command)
export async function reloadFromFile() {
    if (!state.currentFileHandle) {
        await showAlert('Not connected to a file — open one first.');
        return;
    }
    flushAutoSave();               // capture in-flight local edits first
    await checkExternalChanges();  // then reload or resolve, as needed
}

export async function saveToFile() {
    if (!state.currentFileHandle) return false;
    try {
        // Another app may have written the file since we last touched it —
        // never blind-overwrite outside changes (comment replies, agent edits).
        // A comment-only change merges in and the save proceeds with it.
        if (lastDiskText !== null) {
            const disk = await readDisk();
            if (disk !== lastDiskText && !tryAdoptExternalComments(disk)) {
                resolveConflict(disk);
                return false;
            }
        }
        setSaveStatus('saving');
        const markdown = serializeDocument();
        const writable = await state.currentFileHandle.createWritable();
        await writable.write(markdown);
        await writable.close();
        rememberFileState(markdown, markdown);
        setSaveStatus('synced');
        return true;
    } catch (error) {
        console.error('Error saving to file:', error);
        if (error.name === 'NotAllowedError') {
            state.currentFileHandle = null;
            state.currentFileName = null;
            rememberFileState(null, null);
            if (window.__thesisUnwatchFile) window.__thesisUnwatchFile();
            syncMarginProcess();
            clearPageTitle();
            setSaveStatus('detached');
            showAlert('The connection to your file was lost (permission revoked). Your draft is still autosaved in the browser — use Save to reattach it to a file.');
        }
        return false;
    }
}

// A successful save makes the document permanent
function markSavedPermanent() {
    if (state.currentDocumentIsEphemeral) {
        state.currentDocumentIsEphemeral = false;
        saveContent();
    }
}

export async function saveToNewFile() {
    try {
        if ('showSaveFilePicker' in window) {
            const fileHandle = await window.showSaveFilePicker({
                types: [{ description: 'Markdown Files', accept: { 'text/markdown': ['.md'] } }],
                suggestedName: state.currentFileName || 'document.md'
            });

            const markdown = serializeDocument();
            const writable = await fileHandle.createWritable();
            await writable.write(markdown);
            await writable.close();
            rememberFileState(markdown, markdown);

            const file = await fileHandle.getFile();
            state.currentFileHandle = fileHandle;
            state.currentFileName = file.name;
            await saveFileHandleToDB(fileHandle, file.name);
            await addRecentFile(fileHandle, file.name);
            updatePageTitle(file.name);
            setSaveStatus('synced');
            markSavedPermanent();
            if (window.__thesisWatchFile && fileHandle.isNativePath) window.__thesisWatchFile(fileHandle.path);
            syncMarginProcess();
        } else {
            exportAsMarkdown();
        }
    } catch (error) {
        if (error.name !== 'AbortError') console.error('Error saving file:', error);
    }
}

export async function quickSave() {
    if (state.currentFileHandle) {
        if (await saveToFile()) markSavedPermanent();
        return;
    }
    await saveToNewFile();
}

async function loadFileIntoEditor(fileHandle, fileName = null) {
    const file = await fileHandle.getFile();
    const markdownContent = await file.text();
    // Lift the comment and margin blocks out before parsing — comments
    // render as margin notes, never as prose
    const { prose, comments, raw, margin, marginRaw } = splitComments(markdownContent);
    const blocks = markdownToBlocks(prose);

    const editor = getEditor();
    editor.innerHTML = '';
    blocks.forEach(block => editor.appendChild(block));
    updateNumberedBlocks();
    setComments(comments, raw);
    setMargin(margin, marginRaw);
    renderCommentUI();

    state.currentFileHandle = fileHandle;
    state.currentFileName = fileName || file.name;
    // Native shell: watch the file so outside changes (the margin writing
    // comments) arrive while the window stays focused — event-driven, no polling
    if (window.__thesisWatchFile && fileHandle.isNativePath) window.__thesisWatchFile(fileHandle.path);
    syncMarginProcess();
    rememberFileState(markdownContent, serializeDocument());
    state.currentDocumentIsEphemeral = false;
    updatePageTitle(state.currentFileName);
    setSaveStatus('synced');
    saveContent();
    await addRecentFile(fileHandle, state.currentFileName);
    resetHistory();

    const firstBlock = editor.querySelector('.block');
    if (firstBlock) focusBlock(firstBlock);

    if (state.centerMode) {
        requestAnimationFrame(() => {
            addCenterModeSpacers();
            requestAnimationFrame(() => centerCurrentBlock(true));
        });
    }
}

export async function importFromMarkdown() {
    try {
        if ('showOpenFilePicker' in window) {
            const [fileHandle] = await window.showOpenFilePicker({
                types: [{ description: 'Markdown Files', accept: { 'text/markdown': ['.md', '.markdown'] } }],
                multiple: false
            });
            await loadFileIntoEditor(fileHandle);
            await saveFileHandleToDB(fileHandle, state.currentFileName);
        } else {
            document.getElementById('markdown-file-input').click();
        }
    } catch (error) {
        if (error.name !== 'AbortError') console.error('Error opening file:', error);
    }
}

// A file handed to us from outside — Finder double-click via the native shim.
// Same flow as Open File, minus the picker.
export async function openExternalFile(fileHandle) {
    state.externalFileOpened = true;   // startup restore must not race/override this
    try {
        await loadFileIntoEditor(fileHandle);
        await saveFileHandleToDB(fileHandle, state.currentFileName);
    } catch (error) {
        console.error('Error opening external file:', error);
        await showAlert(`Couldn't open "${fileHandle.name || 'file'}".`);
    }
}

export async function clearAll() {
    const confirmed = await showConfirm('Start a new document?');
    if (confirmed) {
        const editor = getEditor();
        editor.innerHTML = '';
        state.currentDocumentIsEphemeral = false;
        state.currentFileHandle = null;
        state.currentFileName = null;
        rememberFileState(null, null);
        if (window.__thesisUnwatchFile) window.__thesisUnwatchFile();
        setComments([]);
        setMargin(null);
        syncMarginProcess();
        renderCommentUI();
        await clearFileHandleFromDB();
        clearPageTitle();
        setSaveStatus('hidden');

        const firstBlock = createBlockElement('text', '');
        editor.appendChild(firstBlock);
        autoSave();
        focusBlock(firstBlock);

        if (state.centerMode) {
            setTimeout(() => {
                addCenterModeSpacers();
                setTimeout(() => centerCurrentBlock(true), 50);
            }, 50);
        }
    }
}

export async function clearStorage() {
    const confirmed = await showConfirm('Clear the autosaved draft from browser memory? Documents saved to files are not affected.');
    if (confirmed) {
        localStorage.removeItem('editorContent');
    }
}

// ──────────────────────────────────
// File handle restoration on page load
// ──────────────────────────────────
export async function restoreFileHandle() {
    if (state.externalFileOpened) return;
    const savedFile = await loadFileHandleFromDB();
    if (!savedFile || !savedFile.handle) return;

    try {
        const permission = await savedFile.handle.queryPermission({ mode: 'readwrite' });
        // Re-check: a Finder-opened file may have landed during the awaits above
        if (state.externalFileOpened) return;
        if (permission === 'granted') {
            await loadFileIntoEditor(savedFile.handle, savedFile.fileName);
        } else if (permission === 'denied') {
            await clearFileHandleFromDB();
        } else {
            // requestPermission() requires a user gesture, so wait for the first one
            deferPermissionRequest(savedFile);
        }
    } catch (error) {
        console.error('Error restoring file:', error);
    }
}

// Open a file from the recent list (called from a click/keypress, so
// requestPermission has the user gesture it needs)
export async function openRecentFile(entry) {
    try {
        let permission = await entry.handle.queryPermission({ mode: 'readwrite' });
        if (permission !== 'granted') {
            permission = await entry.handle.requestPermission({ mode: 'readwrite' });
        }
        if (permission !== 'granted') return;
        await loadFileIntoEditor(entry.handle, entry.fileName);
        await saveFileHandleToDB(entry.handle, entry.fileName);
    } catch (error) {
        console.error('Error opening recent file:', error);
        await removeRecentFile(entry.handle);
        await showAlert(`Couldn't open "${entry.fileName}" — it may have been moved or deleted.`);
    }
}

function deferPermissionRequest(savedFile) {
    const requestOnGesture = async () => {
        window.removeEventListener('pointerdown', requestOnGesture, true);
        window.removeEventListener('keydown', requestOnGesture, true);
        try {
            const permission = await savedFile.handle.requestPermission({ mode: 'readwrite' });
            if (permission === 'granted') {
                await loadFileIntoEditor(savedFile.handle, savedFile.fileName);
            } else {
                await clearFileHandleFromDB();
            }
        } catch (error) {
            // Keep the stored handle so the next session can try again
            console.error('Error restoring file:', error);
        }
    };
    window.addEventListener('pointerdown', requestOnGesture, true);
    window.addEventListener('keydown', requestOnGesture, true);
}

// ──────────────────────────────────
// Markdown conversion
// ──────────────────────────────────
export function blocksToMarkdown() {
    return htmlToMarkdown(getEditor().innerHTML);
}

// Full document for file writes: prose plus the comment and margin
// blocks (if any). Clipboard copies and Word export stay prose-only.
export function serializeDocument() {
    syncAnchorsFromDOM();
    return blocksToMarkdown() + getCommentBlock() + getMarginBlock();
}

// Serialize element content to markdown, preserving inline formatting
function inlineMarkdown(node) {
    let out = '';
    node.childNodes.forEach(child => {
        if (child.nodeType === Node.TEXT_NODE) { out += child.textContent; return; }
        if (child.nodeType !== Node.ELEMENT_NODE) return;
        const inner = inlineMarkdown(child);
        if (!inner) return;
        switch (child.tagName) {
            case 'STRONG': case 'B': out += `**${inner}**`; break;
            case 'EM': case 'I': out += `*${inner}*`; break;
            case 'STRIKE': case 'S': case 'DEL': out += `~~${inner}~~`; break;
            default: out += inner; break;
        }
    });
    return out;
}

export function htmlToMarkdown(htmlContent) {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = htmlContent;
    const blocks = tempDiv.querySelectorAll('.block');
    let markdown = '';
    let numberedCounters = {};

    blocks.forEach(block => {
        const type = block.dataset.type || 'text';
        const level = parseInt(block.dataset.level) || 0;
        const contentEl = block.querySelector('.block-content');
        const content = contentEl ? inlineMarkdown(contentEl).trim() : '';

        if (!content && type === 'text') {
            numberedCounters = {};
            markdown += '\n';
            return;
        }

        const indent = '  '.repeat(level);

        switch (type) {
            case 'heading1': numberedCounters = {}; markdown += '# ' + content + '\n'; break;
            case 'heading2': numberedCounters = {}; markdown += '## ' + content + '\n'; break;
            case 'heading3': numberedCounters = {}; markdown += '### ' + content + '\n'; break;
            case 'bullet':   numberedCounters = {}; markdown += indent + '- ' + content + '\n'; break;
            case 'numbered':
                if (!numberedCounters[level]) numberedCounters[level] = 1;
                else numberedCounters[level]++;
                Object.keys(numberedCounters).forEach(l => {
                    if (parseInt(l) > level) delete numberedCounters[l];
                });
                markdown += indent + numberedCounters[level] + '. ' + content + '\n';
                break;
            case 'quote': numberedCounters = {}; markdown += '> ' + content + '\n'; break;
            default:      numberedCounters = {}; markdown += content + '\n'; break;
        }
    });

    return markdown.trimEnd();
}

// Escape HTML special characters so file content can't inject markup
function escapeHTML(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function markdownToBlocks(markdown) {
    const lines = markdown.split('\n');
    const blocks = [];
    const inline = (text) => processInlineFormatting(escapeHTML(text));

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const leadingSpaces = line.match(/^ */)[0].length;
        const level = Math.floor(leadingSpaces / 2);
        const trimmed = line.trim();

        if (trimmed === '') {
            blocks.push(createBlockElement('text', '', 0));
            continue;
        }

        if (trimmed.startsWith('### '))      blocks.push(createBlockElement('heading3', inline(trimmed.substring(4)), 0));
        else if (trimmed.startsWith('## '))   blocks.push(createBlockElement('heading2', inline(trimmed.substring(3)), 0));
        else if (trimmed.startsWith('# '))    blocks.push(createBlockElement('heading1', inline(trimmed.substring(2)), 0));
        else if (trimmed.startsWith('> '))    blocks.push(createBlockElement('quote', inline(trimmed.substring(2)), 0));
        else if (trimmed.match(/^[-*]\s+/))   blocks.push(createBlockElement('bullet', inline(trimmed.replace(/^[-*]\s+/, '')), level));
        else if (trimmed.match(/^\d+\.\s+/))  blocks.push(createBlockElement('numbered', inline(trimmed.replace(/^\d+\.\s+/, '')), level));
        else                                  blocks.push(createBlockElement('text', inline(trimmed), 0));
    }

    return blocks;
}

// Inline markdown formatting (bold, italic, strikethrough)
export function processInlineFormatting(text) {
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/__(.+?)__/g, '<strong>$1</strong>');
    text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
    text = text.replace(/_(.+?)_/g, '<em>$1</em>');
    text = text.replace(/~~(.+?)~~/g, '<strike>$1</strike>');
    return text;
}

// ──────────────────────────────────
// Export functions
// ──────────────────────────────────
export function exportAsMarkdown() {
    const markdown = serializeDocument();
    downloadBlob(new Blob([markdown], { type: 'text/markdown' }), generateTimestampedFilename('md'));
}

export async function copyAsMarkdown() {
    const markdown = blocksToMarkdown().replace(/\n{3,}/g, '\n\n').trim();
    try {
        await navigator.clipboard.writeText(markdown);
    } catch (err) {
        console.error('Failed to copy to clipboard:', err);
    }
}

export function copyAll() {
    const editor = getEditor();
    const text = editor.innerText || editor.textContent || '';
    navigator.clipboard.writeText(text).catch(err => console.error('Failed to copy:', err));
}

// ──────────────────────────────────
// Word export (DOCX)
// ──────────────────────────────────
export function exportAsWord() {
    const blocks = getEditor().querySelectorAll('.block');
    const bodyContent = generateDocxXml(blocks);
    const documentXml = generateDocumentXml(bodyContent);

    const files = [
        { name: '[Content_Types].xml', content: generateContentTypes() },
        { name: '_rels/.rels', content: generateRootRels() },
        { name: 'word/document.xml', content: documentXml },
        { name: 'word/_rels/document.xml.rels', content: generateDocumentRels() },
        { name: 'word/styles.xml', content: generateStyles() },
        { name: 'word/numbering.xml', content: generateNumbering() }
    ];

    downloadBlob(createZipBlob(files), generateTimestampedFilename('docx'));
}

// Helper: trigger a download
function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ──────────────────────────────────
// ZIP generator (no dependencies)
// ──────────────────────────────────
function createZipBlob(files) {
    const textEncoder = new TextEncoder();
    const str2bytes = (str) => textEncoder.encode(str);

    function crc32(bytes) {
        let crc = 0xFFFFFFFF;
        const table = [];
        for (let i = 0; i < 256; i++) {
            let c = i;
            for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            table[i] = c;
        }
        for (let i = 0; i < bytes.length; i++) crc = table[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
        return (crc ^ 0xFFFFFFFF) >>> 0;
    }

    const write32 = (v) => new Uint8Array([v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF]);
    const write16 = (v) => new Uint8Array([v & 0xFF, (v >>> 8) & 0xFF]);

    const zipParts = [];
    const centralDir = [];
    let offset = 0;

    files.forEach(file => {
        const nameBytes = str2bytes(file.name);
        const contentBytes = str2bytes(file.content);
        const crc = crc32(contentBytes);

        const localHeader = new Uint8Array(30 + nameBytes.length);
        let pos = 0;
        localHeader.set([0x50, 0x4B, 0x03, 0x04], pos); pos += 4;
        localHeader.set(write16(20), pos); pos += 2;
        localHeader.set(write16(0), pos); pos += 2;
        localHeader.set(write16(0), pos); pos += 2;
        localHeader.set(write16(0), pos); pos += 2;
        localHeader.set(write16(0), pos); pos += 2;
        localHeader.set(write32(crc), pos); pos += 4;
        localHeader.set(write32(contentBytes.length), pos); pos += 4;
        localHeader.set(write32(contentBytes.length), pos); pos += 4;
        localHeader.set(write16(nameBytes.length), pos); pos += 2;
        localHeader.set(write16(0), pos); pos += 2;
        localHeader.set(nameBytes, pos);

        zipParts.push(localHeader);
        zipParts.push(contentBytes);

        const centralHeader = new Uint8Array(46 + nameBytes.length);
        pos = 0;
        centralHeader.set([0x50, 0x4B, 0x01, 0x02], pos); pos += 4;
        centralHeader.set(write16(20), pos); pos += 2;
        centralHeader.set(write16(20), pos); pos += 2;
        centralHeader.set(write16(0), pos); pos += 2;
        centralHeader.set(write16(0), pos); pos += 2;
        centralHeader.set(write16(0), pos); pos += 2;
        centralHeader.set(write16(0), pos); pos += 2;
        centralHeader.set(write32(crc), pos); pos += 4;
        centralHeader.set(write32(contentBytes.length), pos); pos += 4;
        centralHeader.set(write32(contentBytes.length), pos); pos += 4;
        centralHeader.set(write16(nameBytes.length), pos); pos += 2;
        centralHeader.set(write16(0), pos); pos += 2;
        centralHeader.set(write16(0), pos); pos += 2;
        centralHeader.set(write16(0), pos); pos += 2;
        centralHeader.set(write16(0), pos); pos += 2;
        centralHeader.set(write32(0), pos); pos += 4;
        centralHeader.set(write32(offset), pos); pos += 4;
        centralHeader.set(nameBytes, pos);

        centralDir.push(centralHeader);
        offset += localHeader.length + contentBytes.length;
    });

    const centralDirSize = centralDir.reduce((sum, arr) => sum + arr.length, 0);
    const eocd = new Uint8Array(22);
    let pos = 0;
    eocd.set([0x50, 0x4B, 0x05, 0x06], pos); pos += 4;
    eocd.set(write16(0), pos); pos += 2;
    eocd.set(write16(0), pos); pos += 2;
    eocd.set(write16(files.length), pos); pos += 2;
    eocd.set(write16(files.length), pos); pos += 2;
    eocd.set(write32(centralDirSize), pos); pos += 4;
    eocd.set(write32(offset), pos); pos += 4;
    eocd.set(write16(0), pos);

    const totalLength = zipParts.reduce((sum, arr) => sum + arr.length, 0) + centralDirSize + eocd.length;
    const zipData = new Uint8Array(totalLength);
    let currentOffset = 0;
    zipParts.forEach(part => { zipData.set(part, currentOffset); currentOffset += part.length; });
    centralDir.forEach(part => { zipData.set(part, currentOffset); currentOffset += part.length; });
    zipData.set(eocd, currentOffset);

    return new Blob([zipData], { type: 'application/zip' });
}

// ──────────────────────────────────
// DOCX XML generators
// ──────────────────────────────────
function escapeXml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// One <w:r> per formatting context, so bold/italic/strike survive the export
// the same way inlineMarkdown carries them into .md
function docxRuns(node, fmt = { b: false, i: false, s: false }) {
    let xml = '';
    node.childNodes.forEach(child => {
        if (child.nodeType === Node.TEXT_NODE) {
            if (!child.textContent) return;
            const props = (fmt.b ? '<w:b/>' : '') + (fmt.i ? '<w:i/>' : '') + (fmt.s ? '<w:strike/>' : '');
            const rPr = props ? `<w:rPr>${props}</w:rPr>` : '';
            xml += `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(child.textContent)}</w:t></w:r>`;
            return;
        }
        if (child.nodeType !== Node.ELEMENT_NODE) return;
        const tag = child.tagName;
        if (tag === 'BR') { xml += '<w:r><w:br/></w:r>'; return; }
        xml += docxRuns(child, {
            b: fmt.b || tag === 'STRONG' || tag === 'B',
            i: fmt.i || tag === 'EM' || tag === 'I',
            s: fmt.s || tag === 'STRIKE' || tag === 'S' || tag === 'DEL',
        });
    });
    return xml;
}

function generateDocxXml(blocks) {
    let xml = '';
    let numberedCounters = {};

    blocks.forEach(block => {
        const type = block.dataset.type || 'text';
        const level = parseInt(block.dataset.level) || 0;
        const contentEl = block.querySelector('.block-content');
        const content = contentEl ? contentEl.textContent.trim() : '';

        if (!content && type === 'text') { numberedCounters = {}; xml += '<w:p><w:pPr></w:pPr></w:p>'; return; }

        const runs = contentEl ? docxRuns(contentEl) : '';
        const indentLeft = level * 720;

        switch (type) {
            case 'heading1': numberedCounters = {}; xml += `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>${runs}</w:p>`; break;
            case 'heading2': numberedCounters = {}; xml += `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr>${runs}</w:p>`; break;
            case 'heading3': numberedCounters = {}; xml += `<w:p><w:pPr><w:pStyle w:val="Heading3"/></w:pPr>${runs}</w:p>`; break;
            case 'bullet': numberedCounters = {}; xml += `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="1"/></w:numPr><w:ind w:left="${indentLeft}"/></w:pPr>${runs}</w:p>`; break;
            case 'numbered':
                if (!numberedCounters[level]) numberedCounters[level] = 1; else numberedCounters[level]++;
                Object.keys(numberedCounters).forEach(l => { if (parseInt(l) > level) delete numberedCounters[l]; });
                xml += `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="2"/></w:numPr><w:ind w:left="${indentLeft}"/></w:pPr>${runs}</w:p>`;
                break;
            case 'quote': numberedCounters = {}; xml += `<w:p><w:pPr><w:pStyle w:val="Quote"/></w:pPr>${runs}</w:p>`; break;
            default: numberedCounters = {}; if (content) xml += `<w:p>${runs}</w:p>`; break;
        }
    });

    return xml;
}

function generateDocumentXml(bodyContent) {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${bodyContent}</w:body></w:document>`;
}

function generateContentTypes() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>`;
}

function generateRootRels() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
}

function generateDocumentRels() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>`;
}

function generateStyles() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="Heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="Heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="200" w:after="100"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="Heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="160" w:after="80"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720"/></w:pPr><w:rPr><w:i/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/></w:style></w:styles>`;
}

function generateNumbering() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl><w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="○"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl><w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="■"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="2160" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl><w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%2."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl><w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%3."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="2160" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`;
}
