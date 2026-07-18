// Centralized application state — all modules import and mutate this object directly.

const state = {
    commandModalOpen: false,
    slashPosition: null,
    wordCountVisible: false,
    saveTimeout: null,
    savedSelection: null,
    selectedFontIndex: 0,
    selectedHeadingIndex: 0,
    customFonts: [],
    currentFontSize: 18,
    currentLineHeight: 1.6,
    forwardOnlyMode: false,
    centerMode: false,
    focusMode: false,
    EPHEMERAL_WORD_LIMIT: 100,
    multiBlockSelection: [],
    currentDocumentIsEphemeral: false,
    filteredCommandsList: [],
    currentFileHandle: null,
    currentFileName: null,
    currentStage: null,
    selectedRecentIndex: 0,
    deferredInstallPrompt: null,
    selectedCommandIndex: 0,
};

export default state;
