// Centralized application state — all modules import and mutate this object directly.

const state = {
    commandModalOpen: false,
    slashPosition: null,
    wordCountVisible: false,
    paragraphNumbers: false,
    sentenceNumbers: false,
    saveTimeout: null,
    autoSavePending: false,
    savedSelection: null,
    selectedFontIndex: 0,
    selectedHeadingIndex: 0,
    selectedModelIndex: 0,
    customFonts: [],
    currentFontSize: 18,
    currentLineHeight: 1.6,
    currentColumnWidth: 700,
    forwardOnlyMode: false,
    centerMode: false,
    focusMode: false,
    blindMode: false,
    fogMode: false,
    retypeActive: false,
    EPHEMERAL_WORD_LIMIT: 100,
    multiBlockSelection: [],
    currentDocumentIsEphemeral: false,
    filteredCommandsList: [],
    // How many times each command has been run (by name), for ranking search
    // results toward what you actually use. Persisted to localStorage.
    commandUsage: {},
    currentFileHandle: null,
    currentFileName: null,
    externalFileOpened: false,
    saveStatus: 'hidden',
    currentStage: null,
    selectedRecentIndex: 0,
    selectedCommandIndex: 0,
    comments: [],
    commentsRaw: null,
    activeCommentId: null,
    commentsVisible: true,
    showResolvedComments: false,
    quickCommentMode: false,
    // Claude-in-the-margin: per-file invitation + brief, stored in the file's
    // thesis:margin block. null when the file has no block.
    margin: null,
    marginRaw: null,
    // Comments/replies from another author that arrived via external merge,
    // not yet surfaced to the writer (palette badge / pill)
    newClaudeArrivals: 0,
    commentCountInPill: false,
    // 'reading' / 'checking' while the hosted companion runs a pass (palette
    // line only)
    marginActivity: null,
};

export default state;
