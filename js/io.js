// File I/O, document persistence, markdown conversion, import/export

import state from './state.js';
import { getEditor, createBlockElement, updateNumberedBlocks, focusBlock } from './blocks.js';
import { saveFileHandleToDB, loadFileHandleFromDB, clearFileHandleFromDB } from './db.js';
import { generateDocumentId, generateTimestampedFilename } from './utils.js';
import { sanitizeHTML } from './sanitize.js';
import { showAlert, showConfirm } from './modals.js';
import {
    updateURL, clearURL, updatePageTitle, clearPageTitle,
    addCenterModeSpacers, centerCurrentBlock, clearEphemeralFading, applyEphemeralFading,
} from './modes.js';

// ──────────────────────────────────
// Auto-save with debouncing
// ──────────────────────────────────
export function saveContent() {
    const editor = getEditor();
    const content = editor.innerHTML;
    try {
        const saveData = {
            content: content,
            isEphemeral: state.currentDocumentIsEphemeral,
        };
        localStorage.setItem('editorContent', JSON.stringify(saveData));
    } catch (e) {
        // localStorage quota exceeded
        console.error('Failed to save: storage quota exceeded', e);
    }
}

export function autoSave() {
    clearTimeout(state.saveTimeout);
    state.saveTimeout = setTimeout(async () => {
        saveContent();
        if (state.currentFileHandle) {
            await saveToFile();
        }
    }, 1000);
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
            // BUG FIX: sanitize HTML before injecting into DOM
            editor.innerHTML = sanitizeHTML(parsed.content);
            state.currentDocumentIsEphemeral = parsed.isEphemeral || false;
        } catch (e) {
            editor.innerHTML = sanitizeHTML(savedData);
            state.currentDocumentIsEphemeral = false;
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

        // Normalize loaded blocks
        const blocks = Array.from(editor.querySelectorAll('.block'));
        blocks.forEach(block => {
            const markers = block.querySelectorAll('.block-marker');
            markers.forEach(marker => { marker.contentEditable = 'false'; });

            let contentEl = block.querySelector('.block-content');
            if (!contentEl) {
                contentEl = document.createElement('div');
                contentEl.className = 'block-content';
                contentEl.contentEditable = 'true';
                Array.from(block.childNodes).forEach(child => {
                    if (!child.classList || !child.classList.contains('block-marker')) {
                        contentEl.appendChild(child.cloneNode(true));
                    }
                });
                const marker = block.querySelector('.block-marker');
                block.innerHTML = '';
                if (marker) block.appendChild(marker);
                block.appendChild(contentEl);
            }

            contentEl.contentEditable = 'true';
            if (!block.dataset.level) block.dataset.level = '0';
            if (contentEl.childNodes.length === 0 || contentEl.innerHTML.trim() === '') {
                contentEl.innerHTML = '<br>';
            }
        });

        // Clean up loose nodes
        Array.from(editor.childNodes).forEach(node => {
            if (node.nodeType === Node.TEXT_NODE && node.textContent.trim() !== '') {
                node.remove();
            } else if (node.nodeType === Node.ELEMENT_NODE && !node.classList.contains('block')) {
                node.remove();
            }
        });

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

    applyEphemeralFading();
}

// ──────────────────────────────────
// File operations
// ──────────────────────────────────
export async function saveToFile() {
    if (!state.currentFileHandle) return;
    try {
        const markdown = blocksToMarkdown();
        const writable = await state.currentFileHandle.createWritable();
        await writable.write(markdown);
        await writable.close();
    } catch (error) {
        console.error('Error saving to file:', error);
        if (error.name === 'NotAllowedError') {
            state.currentFileHandle = null;
            state.currentFileName = null;
            clearPageTitle();
        }
    }
}

export async function saveToNewFile() {
    try {
        if ('showSaveFilePicker' in window) {
            const fileHandle = await window.showSaveFilePicker({
                types: [{ description: 'Markdown Files', accept: { 'text/markdown': ['.md'] } }],
                suggestedName: state.currentFileName || 'document.md'
            });

            const markdown = blocksToMarkdown();
            const writable = await fileHandle.createWritable();
            await writable.write(markdown);
            await writable.close();

            const file = await fileHandle.getFile();
            state.currentFileHandle = fileHandle;
            state.currentFileName = file.name;
            await saveFileHandleToDB(fileHandle, file.name);

            state.currentDocumentName = null;
            clearURL();
            updatePageTitle(file.name);
        } else {
            exportAsMarkdown();
        }
    } catch (error) {
        if (error.name !== 'AbortError') console.error('Error saving file:', error);
    }
}

export async function importFromMarkdown() {
    try {
        if ('showOpenFilePicker' in window) {
            const [fileHandle] = await window.showOpenFilePicker({
                types: [{ description: 'Markdown Files', accept: { 'text/markdown': ['.md', '.markdown'] } }],
                multiple: false
            });

            const file = await fileHandle.getFile();
            const markdownContent = await file.text();
            const blocks = markdownToBlocks(markdownContent);

            const editor = getEditor();
            editor.innerHTML = '';
            blocks.forEach(block => editor.appendChild(block));
            updateNumberedBlocks();

            state.currentFileHandle = fileHandle;
            state.currentFileName = file.name;
            // BUG FIX: clear ephemeral flag when loading from file
            state.currentDocumentIsEphemeral = false;
            clearEphemeralFading();

            await saveFileHandleToDB(fileHandle, file.name);
            state.currentDocumentName = null;
            clearURL();
            updatePageTitle(file.name);
        } else {
            document.getElementById('markdown-file-input').click();
        }
    } catch (error) {
        if (error.name !== 'AbortError') console.error('Error opening file:', error);
    }
}

// ──────────────────────────────────
// Document management (localStorage)
// ──────────────────────────────────
export function getSavedDocuments() {
    const docsJson = localStorage.getItem('savedDocuments');
    const docs = docsJson ? JSON.parse(docsJson) : [];
    docs.sort((a, b) => b.timestamp - a.timestamp);
    return docs;
}

export function setSavedDocuments(docs) {
    localStorage.setItem('savedDocuments', JSON.stringify(docs));
}

export function performSave() {
    const docName = document.getElementById('save-name-input').value.trim();
    if (!docName) return;

    // BUG FIX: saving always makes document permanent
    state.currentDocumentIsEphemeral = false;
    clearEphemeralFading();

    const editor = getEditor();
    const content = editor.innerHTML;
    const docs = getSavedDocuments();

    let docId;
    const existingIndex = docs.findIndex(d => d.name === docName);
    if (existingIndex >= 0) {
        docs[existingIndex].timestamp = Date.now();
        docs[existingIndex].isEphemeral = false;
        docId = docs[existingIndex].id;
    } else {
        docId = generateDocumentId();
        docs.push({ id: docId, name: docName, timestamp: Date.now(), isEphemeral: false });
    }

    try {
        localStorage.setItem(`doc_${docName}`, content);
        localStorage.setItem(`docById_${docId}`, JSON.stringify({ name: docName, content, isEphemeral: false }));
    } catch (e) {
        console.error('Failed to save: storage quota exceeded', e);
    }
    setSavedDocuments(docs);
    state.currentDocumentName = docName;

    updateURL(docId);
    updatePageTitle(docName);

    document.getElementById('save-modal').classList.add('hidden');

    // Restore cursor
    if (state.savedSelection) {
        const selection = window.getSelection();
        try {
            selection.removeAllRanges();
            selection.addRange(state.savedSelection);
        } catch (e) {
            editor.focus();
        }
        state.savedSelection = null;
    } else {
        editor.focus();
    }
}

export async function quickSave() {
    // BUG FIX: saving always makes document permanent
    state.currentDocumentIsEphemeral = false;
    clearEphemeralFading();

    if (state.currentFileHandle) {
        await saveToFile();
        return;
    }

    if (state.currentDocumentName) {
        const editor = getEditor();
        const content = editor.innerHTML;
        const docs = getSavedDocuments();

        const existingIndex = docs.findIndex(d => d.name === state.currentDocumentName);
        if (existingIndex >= 0) {
            docs[existingIndex].timestamp = Date.now();
            docs[existingIndex].isEphemeral = false;
            const docId = docs[existingIndex].id;

            try {
                localStorage.setItem(`doc_${state.currentDocumentName}`, content);
                localStorage.setItem(`docById_${docId}`, JSON.stringify({
                    name: state.currentDocumentName, content, isEphemeral: false
                }));
            } catch (e) {
                console.error('Failed to save: storage quota exceeded', e);
            }
            setSavedDocuments(docs);
            updateURL(docId);
            updatePageTitle(state.currentDocumentName);
        } else {
            try {
                localStorage.setItem(`doc_${state.currentDocumentName}`, content);
            } catch (e) {
                console.error('Failed to save: storage quota exceeded', e);
            }
            setSavedDocuments(docs);
        }
        return;
    }

    // Nothing active — open save dialog (handled in commands)
    return 'open-save-dialog';
}

export async function loadDocumentByName(docName) {
    const content = localStorage.getItem(`doc_${docName}`);
    if (content) {
        const editor = getEditor();
        editor.innerHTML = sanitizeHTML(content);
        state.currentDocumentName = docName;
        // BUG FIX: loaded documents are always permanent
        state.currentDocumentIsEphemeral = false;
        clearEphemeralFading();

        const docs = getSavedDocuments();
        const doc = docs.find(d => d.name === docName);
        if (doc && doc.id) updateURL(doc.id);

        updatePageTitle(docName);
        document.getElementById('load-modal').classList.add('hidden');
        editor.focus();

        if (state.centerMode) {
            requestAnimationFrame(() => {
                addCenterModeSpacers();
                requestAnimationFrame(() => centerCurrentBlock(true));
            });
        }
    } else {
        await showAlert(`Document "${docName}" not found.`);
    }
}

export async function loadDocumentById(docId) {
    const docData = localStorage.getItem(`docById_${docId}`);
    if (docData) {
        try {
            const { name, content } = JSON.parse(docData);
            const docs = getSavedDocuments();
            const doc = docs.find(d => d.id === docId);
            if (doc) {
                const editor = getEditor();
                editor.innerHTML = sanitizeHTML(content);
                state.currentDocumentName = name;
                state.currentDocumentIsEphemeral = false;
                clearEphemeralFading();
                updatePageTitle(name);

                if (state.centerMode) {
                    requestAnimationFrame(() => {
                        addCenterModeSpacers();
                        requestAnimationFrame(() => centerCurrentBlock(true));
                    });
                }
            } else {
                showDeletedDocModal();
                clearURL();
            }
        } catch (e) {
            console.error('Error loading document:', e);
            showDeletedDocModal();
            clearURL();
        }
    } else {
        showDeletedDocModal();
        clearURL();
    }
}

function showDeletedDocModal() {
    document.getElementById('deleted-doc-modal').classList.remove('hidden');
}

export async function deleteDocumentByName(docName) {
    const confirmed = await showConfirm(`Delete document "${docName}"? This cannot be undone.`);
    if (confirmed) {
        const docs = getSavedDocuments();
        const doc = docs.find(d => d.name === docName);

        localStorage.removeItem(`doc_${docName}`);
        if (doc && doc.id) localStorage.removeItem(`docById_${doc.id}`);

        setSavedDocuments(docs.filter(d => d.name !== docName));

        if (state.currentDocumentName === docName) {
            state.currentDocumentName = null;
            clearURL();
            clearPageTitle();
        }

        document.getElementById('delete-modal').classList.add('hidden');

        if (state.savedSelection) {
            const selection = window.getSelection();
            try {
                selection.removeAllRanges();
                selection.addRange(state.savedSelection);
            } catch (e) {
                getEditor().focus();
            }
            state.savedSelection = null;
        } else {
            getEditor().focus();
        }
    }
}

export async function clearAll() {
    const confirmed = await showConfirm('Start a new document?');
    if (confirmed) {
        const editor = getEditor();
        editor.innerHTML = '';
        state.currentDocumentName = null;
        state.currentDocumentIsEphemeral = false;
        clearEphemeralFading();
        state.currentFileHandle = null;
        state.currentFileName = null;
        await clearFileHandleFromDB();
        clearURL();
        clearPageTitle();

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
    const confirmed = await showConfirm('Are you sure you want to clear all saved content from browser memory?');
    if (confirmed) {
        localStorage.removeItem('editorContent');
    }
}

export function migrateDocumentsWithIds() {
    const docs = getSavedDocuments();
    let migrated = false;

    docs.forEach(doc => {
        if (!doc.id) {
            doc.id = generateDocumentId();
            migrated = true;
            const content = localStorage.getItem(`doc_${doc.name}`);
            if (content) {
                localStorage.setItem(`docById_${doc.id}`, JSON.stringify({ name: doc.name, content }));
            }
        }
    });

    if (migrated) setSavedDocuments(docs);
}

// ──────────────────────────────────
// Markdown conversion
// ──────────────────────────────────
export function blocksToMarkdown() {
    return htmlToMarkdown(getEditor().innerHTML);
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
        const content = contentEl ? contentEl.textContent.trim() : '';

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

export function markdownToBlocks(markdown) {
    const lines = markdown.split('\n');
    const blocks = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const leadingSpaces = line.match(/^ */)[0].length;
        const level = Math.floor(leadingSpaces / 2);
        const trimmed = line.trim();

        if (trimmed === '') {
            blocks.push(createBlockElement('text', '', 0));
            continue;
        }

        if (trimmed.startsWith('### '))      blocks.push(createBlockElement('heading3', trimmed.substring(4), 0));
        else if (trimmed.startsWith('## '))   blocks.push(createBlockElement('heading2', trimmed.substring(3), 0));
        else if (trimmed.startsWith('# '))    blocks.push(createBlockElement('heading1', trimmed.substring(2), 0));
        else if (trimmed.startsWith('> '))    blocks.push(createBlockElement('quote', trimmed.substring(2), 0));
        else if (trimmed.match(/^[-*]\s+/))   blocks.push(createBlockElement('bullet', trimmed.replace(/^[-*]\s+/, ''), level));
        else if (trimmed.match(/^\d+\.\s+/))  blocks.push(createBlockElement('numbered', trimmed.replace(/^\d+\.\s+/, ''), level));
        else                                  blocks.push(createBlockElement('text', trimmed, 0));
    }

    return blocks;
}

// Inline markdown formatting
export function processInlineFormatting(text) {
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/__(.+?)__/g, '<strong>$1</strong>');
    text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
    text = text.replace(/_(.+?)_/g, '<em>$1</em>');
    return text;
}

// ──────────────────────────────────
// Export functions
// ──────────────────────────────────
export function exportAsMarkdown() {
    const markdown = htmlToMarkdown(getEditor().innerHTML);
    downloadBlob(new Blob([markdown], { type: 'text/markdown' }), generateTimestampedFilename('md'));
}

export async function exportAllAsMarkdown() {
    const docs = getSavedDocuments();
    if (docs.length === 0) {
        await showAlert('No saved documents to export.');
        return;
    }

    const files = [];
    docs.forEach(doc => {
        const htmlContent = localStorage.getItem(`doc_${doc.name}`);
        if (htmlContent) {
            const markdown = htmlToMarkdown(htmlContent);
            const safeFilename = doc.name.replace(/[^a-z0-9_-]/gi, '_');
            files.push({ name: `${safeFilename}.md`, content: markdown });
        }
    });

    const zipBlob = createZipBlob(files);
    const now = new Date();
    const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    downloadBlob(zipBlob, `thesis_documents_${timestamp}.zip`);
}

export async function copyAsMarkdown() {
    const blocks = getEditor().querySelectorAll('.block');
    let markdown = '';
    let numberedCounters = {};

    blocks.forEach(block => {
        const type = block.dataset.type || 'text';
        const level = parseInt(block.dataset.level) || 0;
        const contentEl = block.querySelector('.block-content');
        const content = contentEl ? contentEl.textContent.trim() : '';

        if (!content && type === 'text') { numberedCounters = {}; markdown += '\n'; return; }
        const indent = '  '.repeat(level);

        switch (type) {
            case 'heading1': numberedCounters = {}; markdown += '# ' + content + '\n'; break;
            case 'heading2': numberedCounters = {}; markdown += '## ' + content + '\n'; break;
            case 'heading3': numberedCounters = {}; markdown += '### ' + content + '\n'; break;
            case 'bullet':   numberedCounters = {}; markdown += indent + '- ' + content + '\n'; break;
            case 'numbered':
                if (!numberedCounters[level]) numberedCounters[level] = 1;
                else numberedCounters[level]++;
                Object.keys(numberedCounters).forEach(l => { if (parseInt(l) > level) delete numberedCounters[l]; });
                markdown += indent + numberedCounters[level] + '. ' + content + '\n';
                break;
            case 'quote': numberedCounters = {}; markdown += '> ' + content + '\n'; break;
            default:      numberedCounters = {}; markdown += content + '\n'; break;
        }
    });

    try {
        await navigator.clipboard.writeText(markdown.replace(/\n{3,}/g, '\n\n').trim());
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
// File handle restoration on page load
// ──────────────────────────────────
export async function restoreFileHandle() {
    const savedFile = await loadFileHandleFromDB();
    if (!savedFile || !savedFile.handle) return;

    try {
        let permission = await savedFile.handle.queryPermission({ mode: 'readwrite' });
        if (permission !== 'granted') {
            permission = await savedFile.handle.requestPermission({ mode: 'readwrite' });
        }

        if (permission === 'granted') {
            const file = await savedFile.handle.getFile();
            const markdownContent = await file.text();
            const blocks = markdownToBlocks(markdownContent);

            const editor = getEditor();
            editor.innerHTML = '';
            blocks.forEach(block => editor.appendChild(block));
            updateNumberedBlocks();

            state.currentFileHandle = savedFile.handle;
            state.currentFileName = savedFile.fileName;
            // BUG FIX: file-loaded documents are never ephemeral
            state.currentDocumentIsEphemeral = false;
            updatePageTitle(savedFile.fileName);

            if (state.centerMode) {
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => centerCurrentBlock(true));
                });
            }
        } else {
            await clearFileHandleFromDB();
        }
    } catch (error) {
        console.error('Error restoring file:', error);
        await clearFileHandleFromDB();
    }
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
function generateDocxXml(blocks) {
    let xml = '';
    let numberedCounters = {};

    blocks.forEach(block => {
        const type = block.dataset.type || 'text';
        const level = parseInt(block.dataset.level) || 0;
        const contentEl = block.querySelector('.block-content');
        const content = contentEl ? contentEl.textContent.trim() : '';

        if (!content && type === 'text') { numberedCounters = {}; xml += '<w:p><w:pPr></w:pPr></w:p>'; return; }

        const escaped = content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
        const indentLeft = level * 720;

        switch (type) {
            case 'heading1': numberedCounters = {}; xml += `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${escaped}</w:t></w:r></w:p>`; break;
            case 'heading2': numberedCounters = {}; xml += `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>${escaped}</w:t></w:r></w:p>`; break;
            case 'heading3': numberedCounters = {}; xml += `<w:p><w:pPr><w:pStyle w:val="Heading3"/></w:pPr><w:r><w:t>${escaped}</w:t></w:r></w:p>`; break;
            case 'bullet': numberedCounters = {}; xml += `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="1"/></w:numPr><w:ind w:left="${indentLeft}"/></w:pPr><w:r><w:t>${escaped}</w:t></w:r></w:p>`; break;
            case 'numbered':
                if (!numberedCounters[level]) numberedCounters[level] = 1; else numberedCounters[level]++;
                Object.keys(numberedCounters).forEach(l => { if (parseInt(l) > level) delete numberedCounters[l]; });
                xml += `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="2"/></w:numPr><w:ind w:left="${indentLeft}"/></w:pPr><w:r><w:t>${escaped}</w:t></w:r></w:p>`;
                break;
            case 'quote': numberedCounters = {}; xml += `<w:p><w:pPr><w:pStyle w:val="Quote"/></w:pPr><w:r><w:t>${escaped}</w:t></w:r></w:p>`; break;
            default: numberedCounters = {}; if (content) xml += `<w:p><w:r><w:t>${escaped}</w:t></w:r></w:p>`; break;
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
