// IndexedDB operations for persisting file handles across sessions

const DB_NAME = 'thesis-db';
const DB_VERSION = 1;
const STORE_NAME = 'file-handles';

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
            request.onsuccess = () => resolve(request.result);
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
