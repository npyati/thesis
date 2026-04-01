// Centralized application state
// All mutable state lives here — mutations go through update() so they're traceable.

const state = {
    commandModalOpen: false,
    slashPosition: null,
    wordCountVisible: false,
    saveTimeout: null,
    savedSelection: null,
    selectedSaveIndex: 0,
    selectedLoadIndex: 0,
    selectedDeleteIndex: 0,
    selectedFontIndex: 0,
    selectedHeadingIndex: 0,
    customFonts: [],
    currentFontSize: 18,
    currentLineHeight: 1.6,
    forwardOnlyMode: false,
    centerMode: false,
    focusMode: false,
    ephemeralMode: false,
    EPHEMERAL_WORD_LIMIT: 100,
    multiBlockSelection: [],
    currentDocumentName: null,
    currentDocumentIsEphemeral: false,
    filteredCommandsList: [],
    currentFileHandle: null,
    currentFileName: null,
    deferredInstallPrompt: null,
    selectedCommandIndex: 0,
};

// Simple getter/setter with optional debug logging
export function get(key) {
    return state[key];
}

export function set(key, value) {
    if (!(key in state)) {
        console.warn(`State: unknown key "${key}"`);
    }
    state[key] = value;
}

// Batch update multiple keys
export function update(patch) {
    for (const [key, value] of Object.entries(patch)) {
        set(key, value);
    }
}

export default state;
