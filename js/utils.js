// Shared utility functions

// Debounce: delay fn execution until wait ms after last call
export function debounce(fn, wait) {
    let timer;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), wait);
    };
}

// Read and parse a JSON localStorage entry, tolerating corrupt values
export function readJSON(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
        console.error(`Corrupt localStorage entry "${key}":`, e);
        return fallback;
    }
}

// Generate timestamped filename
export function generateTimestampedFilename(ext) {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `document_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}.${ext}`;
}

// Save/restore selection helpers
export function saveSelection() {
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
        return selection.getRangeAt(0).cloneRange();
    }
    return null;
}

export function restoreSelection(saved) {
    if (!saved) return false;
    try {
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(saved);
        return true;
    } catch (e) {
        console.error('Error restoring selection:', e);
        return false;
    }
}
