// IndexedDB operations for persisting file handles across sessions

const DB_NAME = 'thesis-db';
const DB_VERSION = 1;
const STORE_NAME = 'file-handles';

// The native macOS wrapper stores plain {path, name} records in place of real
// FileSystemFileHandles; its shim revives them. A no-op on the web.
function reviveHandle(handle) {
    return window.__thesisRehydrateHandle ? window.__thesisRehydrateHandle(handle) : handle;
}

function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
    });
}

export async function saveFileHandleToDB(handle, fileName) {
    try {
        const db = await initDB();
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        await store.put({ handle, fileName }, 'currentFile');
    } catch (error) {
        console.error('Error saving file handle:', error);
    }
}

export async function loadFileHandleFromDB() {
    try {
        const db = await initDB();
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        return new Promise((resolve, reject) => {
            const request = store.get('currentFile');
            request.onsuccess = () => {
                const result = request.result;
                if (result && result.handle) result.handle = reviveHandle(result.handle);
                resolve(result);
            };
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        console.error('Error loading file handle:', error);
        return null;
    }
}

export async function clearFileHandleFromDB() {
    try {
        const db = await initDB();
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        await store.delete('currentFile');
    } catch (error) {
        console.error('Error clearing file handle:', error);
    }
}

// ──────────────────────────────────
// Recent files — a short list of {handle, fileName, timestamp}
// ──────────────────────────────────
const RECENT_KEY = 'recentFiles';
const MAX_RECENT = 8;

function getFromStore(key) {
    return initDB().then(db => new Promise((resolve, reject) => {
        const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    }));
}

function putInStore(value, key) {
    return initDB().then(db => new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        transaction.objectStore(STORE_NAME).put(value, key);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    }));
}

export async function getRecentFiles() {
    try {
        const list = (await getFromStore(RECENT_KEY)) || [];
        return list.map(entry => entry && entry.handle
            ? { ...entry, handle: reviveHandle(entry.handle) }
            : entry);
    } catch (error) {
        console.error('Error reading recent files:', error);
        return [];
    }
}

export async function addRecentFile(handle, fileName) {
    try {
        const list = await getRecentFiles();
        // isSameEntry is async, so dedup outside the transaction
        const kept = [];
        for (const entry of list) {
            try {
                if (entry.handle && !(await handle.isSameEntry(entry.handle))) kept.push(entry);
            } catch (e) { /* drop broken entries */ }
        }
        kept.unshift({ handle, fileName, timestamp: Date.now() });
        await putInStore(kept.slice(0, MAX_RECENT), RECENT_KEY);
    } catch (error) {
        console.error('Error saving recent file:', error);
    }
}

export async function removeRecentFile(handle) {
    try {
        const list = await getRecentFiles();
        const kept = [];
        for (const entry of list) {
            try {
                if (entry.handle && !(await handle.isSameEntry(entry.handle))) kept.push(entry);
            } catch (e) { /* drop broken entries */ }
        }
        await putInStore(kept, RECENT_KEY);
    } catch (error) {
        console.error('Error removing recent file:', error);
    }
}
