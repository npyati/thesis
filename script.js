const editor = document.getElementById("editor");

// DOM-ONLY BLOCK SYSTEM - No separate data array

// Get current block element (returns DOM element, not data object)
function getCurrentBlock() {
    const selection = window.getSelection();
    if (selection.rangeCount === 0) return null;

    const node = selection.getRangeAt(0).startContainer;
    let element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;

    // Find the block div
    while (element && element !== editor) {
        if (element.classList && element.classList.contains('block')) {
            return element;
        }
        element = element.parentElement;
    }
    return null;
}

// Function to get all blocks in current selection
function getSelectedBlocks() {
    const selection = window.getSelection();
    if (!selection.rangeCount) return [];

    const range = selection.getRangeAt(0);
    const allBlocks = Array.from(editor.querySelectorAll('.block'));

    // Find blocks that intersect with the selection
    const selectedBlocks = allBlocks.filter(block => {
        return range.intersectsNode(block);
    });

    return selectedBlocks;
}

// Create a new block DOM element
function createBlockElement(type = 'text', content = '', level = 0) {
    const block = document.createElement('div');
    block.className = `block block-${type}`;
    block.dataset.type = type;
    block.dataset.level = level;

    let html = '';

    // Add visual markers for bullets and numbers (non-editable)
    if (type === 'bullet') {
        html += '<span class="block-marker bullet-marker" contenteditable="false">•</span>';
    } else if (type === 'numbered') {
        html += '<span class="block-marker number-marker" contenteditable="false">1.</span>';
    }

    // Empty blocks need <br> for cursor placement
    const contentHtml = content || '<br>';
    html += `<div class="block-content" contenteditable="true">${contentHtml}</div>`;

    block.innerHTML = html;
    return block;
}

// Update all numbered block markers with hierarchical numbering
function updateNumberedBlocks() {
    const allBlocks = Array.from(editor.querySelectorAll('.block'));
    const counters = []; // Track counters for each level

    allBlocks.forEach(block => {
        if (block.dataset.type === 'numbered') {
            const level = parseInt(block.dataset.level) || 0;

            // Ensure counters array is large enough
            while (counters.length <= level) {
                counters.push(0);
            }

            // Increment counter at this level
            counters[level]++;

            // Reset all deeper level counters
            for (let i = level + 1; i < counters.length; i++) {
                counters[i] = 0;
            }

            // Build number string (e.g., "1.", "1.1.", "1.1.1.")
            const numberParts = counters.slice(0, level + 1).filter(n => n > 0);
            const numberString = numberParts.join('.') + '.';

            // Update marker
            const marker = block.querySelector('.number-marker');
            if (marker) {
                marker.textContent = numberString;
            }
        } else {
            // Reset all counters when we hit a non-numbered block
            counters.length = 0;
        }
    });
}

// Focus a block element
function focusBlock(blockElement, atEnd = false) {
    if (!blockElement) return;

    // Clear selection first to prevent flashing
    const selection = window.getSelection();
    selection.removeAllRanges();

    // Small delay to let DOM settle
    requestAnimationFrame(() => {
        const contentEl = blockElement.querySelector('.block-content');
        if (!contentEl) return;

        const range = document.createRange();

        if (atEnd) {
            // Place cursor at the absolute end of all content
            // This handles multiple text nodes, formatting, etc.
            try {
                range.selectNodeContents(contentEl);
                range.collapse(false); // false = collapse to end
                selection.removeAllRanges();
                selection.addRange(range);
            } catch (e) {
                console.error('Focus error:', e);
            }
        } else {
            // Place cursor at the beginning
            // Ensure there's a text node to focus
            let textNode;
            if (contentEl.childNodes.length === 0) {
                // No children - add empty text node
                textNode = document.createTextNode('');
                contentEl.appendChild(textNode);
            } else if (contentEl.childNodes.length === 1 && contentEl.firstChild.nodeName === 'BR') {
                // Only a BR tag - add text node before it
                textNode = document.createTextNode('');
                contentEl.insertBefore(textNode, contentEl.firstChild);
            } else {
                // Find first text node or create one
                textNode = Array.from(contentEl.childNodes).find(n => n.nodeType === Node.TEXT_NODE);
                if (!textNode) {
                    textNode = document.createTextNode('');
                    contentEl.insertBefore(textNode, contentEl.firstChild);
                }
            }

            try {
                range.setStart(textNode, 0);
                range.collapse(true);
                selection.removeAllRanges();
                selection.addRange(range);
            } catch (e) {
                console.error('Focus error:', e);
            }
        }
    });
}

// Note: Initialization happens in loadContent() which is called at page load

const commandModal = document.getElementById("command-modal");
const commandSearch = document.getElementById("command-search");
const commandList = document.getElementById("command-list");
const wordCountDisplay = document.getElementById("word-count-display");
const wordCountSpan = document.getElementById("word-count");
const charCountSpan = document.getElementById("char-count");
const saveModal = document.getElementById("save-modal");
const saveNameInput = document.getElementById("save-name-input");
const saveList = document.getElementById("save-list");
const saveConfirmButton = document.getElementById("save-confirm-button");
const saveCancelButton = document.getElementById("save-cancel-button");
const loadModal = document.getElementById("load-modal");
const loadSearch = document.getElementById("load-search");
const loadList = document.getElementById("load-list");
const loadCancelButton = document.getElementById("load-cancel-button");
const fontModal = document.getElementById("font-modal");
const fontSearch = document.getElementById("font-search");
const fontList = document.getElementById("font-list");
const fontCancelButton = document.getElementById("font-cancel-button");
const headingModal = document.getElementById("heading-modal");
const headingSearch = document.getElementById("heading-search");
const headingList = document.getElementById("heading-list");
const headingCancelButton = document.getElementById("heading-cancel-button");
const introModal = document.getElementById("intro-modal");
const introText = document.getElementById("intro-text");
const markdownFileInput = document.getElementById("markdown-file-input");
const dialogModal = document.getElementById("dialog-modal");
const dialogMessage = document.getElementById("dialog-message");
const dialogConfirmButton = document.getElementById("dialog-confirm-button");
const dialogCancelButton = document.getElementById("dialog-cancel-button");
const deletedDocModal = document.getElementById("deleted-doc-modal");
const deletedDocMessage = document.getElementById("deleted-doc-message");
const deletedDocOkButton = document.getElementById("deleted-doc-ok-button");

let commandModalOpen = false;
let slashPosition = null;
let wordCountVisible = false;
let saveTimeout = null;
let savedSelection = null;
let selectedSaveIndex = 0;
let selectedLoadIndex = 0;
let selectedFontIndex = 0;
let selectedHeadingIndex = 0;
let customFonts = [];
let currentFontSize = 18; // Default font size in pixels
let currentLineHeight = 1.6; // Default line height
let typewriterMode = false;
let focusMode = false;
let multiBlockSelection = []; // Store blocks when multi-block operation is triggered
let currentDocumentName = null; // Track the currently loaded/saved document
let filteredCommandsList = []; // Store the currently filtered commands for keyboard navigation

// Available fonts
const availableFonts = [
    'Arial',
    'Helvetica',
    'Times New Roman',
    'Times',
    'Courier New',
    'Courier',
    'Verdana',
    'Georgia',
    'Palatino',
    'Garamond',
    'Bookman',
    'Comic Sans MS',
    'Trebuchet MS',
    'Arial Black',
    'Impact',
    'Lucida Sans Unicode',
    'Tahoma',
    'Lucida Console',
    'Monaco',
    'Brush Script MT',
    'Copperplate',
    'Papyrus',
    'Cambria',
    'Calibri',
    'Consolas',
    'Segoe UI',
    'Franklin Gothic Medium',
    'Century Gothic',
    'Gill Sans',
    'Optima',
    'Futura',
    'Baskerville',
    'Didot',
    'Rockwell',
    'Andale Mono',
    'system-ui',
    'ui-serif',
    'ui-sans-serif',
    'ui-monospace',
    'serif',
    'sans-serif',
    'monospace',
    'cursive',
    'fantasy'
];

// Intro content
const introHTML = `<p><strong>thesis</strong> is a minimalist text editor.</p>
<p>It's designed for focus and creativity.</p>
<p>The whole thing works primarily through the keyboard. You shouldn't have to use the mouse.</p>
<p>Here are the basics</p>
<ul>
<li>Type / to open a popup menu of commands. Use arrow keys or search to pick one. When search returns only one command, pressing [enter] will execute.</li>
<li>Type / again to close the popup. Press [space] at the empty prompt to keep the /.</li>
<li>Nothing is sent or saved online. All documents are stored locally in your browser.</li>
</ul>
<p>That's enough for now. You can find the rest by exploring. There isn't much - just what's necessary.</p>
<p><strong>This is a work in progress.</strong> There are still plenty of bugs to fix and improvements to make. Send me a note if you have ideas.</p>`;

// Available commands
const commands = [
    {
        name: "Save Document As...",
        description: "Save current document with a name",
        action: saveDocumentAs
    },
    {
        name: "Load Document",
        description: "Load a previously saved document",
        action: loadDocument
    },
    {
        name: "Delete Document",
        description: "Delete a saved document",
        action: deleteDocument
    },
    {
        name: "Jump to Heading",
        description: "Navigate to a heading in the document",
        action: openHeadingModal
    },
    {
        name: "Heading 1",
        description: "Format current line(s) as large heading",
        action: () => applyHeading(1)
    },
    {
        name: "Heading 2",
        description: "Format current line(s) as medium heading",
        action: () => applyHeading(2)
    },
    {
        name: "Heading 3",
        description: "Format current line(s) as small heading",
        action: () => applyHeading(3)
    },
    {
        name: "Normal Text",
        description: "Convert current line(s) to normal text",
        action: () => {
            // Get blocks to operate on (multi-selection or current block)
            const blocksToConvert = multiBlockSelection.length > 0 ? multiBlockSelection : [getCurrentBlock()];
            if (blocksToConvert[0] === null) return;

            blocksToConvert.forEach(block => {
                const contentEl = block.querySelector('.block-content');
                if (!contentEl) return;

                // Remove any markers
                const marker = block.querySelector('.block-marker');
                if (marker) marker.remove();

                // Convert to text
                block.dataset.type = 'text';
                block.dataset.level = '0';
                block.className = 'block block-text';
            });

            // Update numbering in case we converted from numbered lists
            updateNumberedBlocks();

            // Clear multi-block selection
            multiBlockSelection = [];

            // Restore focus to first block
            if (blocksToConvert.length > 0) {
                focusBlock(blocksToConvert[0], true);
            }
        }
    },
    {
        name: "Bullet List",
        description: "Toggle bullet list for current line(s)",
        action: () => {
            // Get blocks to operate on (multi-selection or current block)
            const blocksToToggle = multiBlockSelection.length > 0 ? multiBlockSelection : [getCurrentBlock()];
            if (blocksToToggle[0] === null) return;

            blocksToToggle.forEach(currentBlock => {
                const contentEl = currentBlock.querySelector('.block-content');
                if (!contentEl) return;

                const currentType = currentBlock.dataset.type;

                if (currentType === 'bullet') {
                    // Already bullet - convert to text
                    currentBlock.dataset.type = 'text';
                    currentBlock.className = 'block block-text';
                    const marker = currentBlock.querySelector('.block-marker');
                    if (marker) marker.remove();
                } else {
                    // Convert to bullet (from text or numbered)
                    currentBlock.dataset.type = 'bullet';
                    currentBlock.className = 'block block-bullet';

                    // Remove any existing marker
                    const existingMarker = currentBlock.querySelector('.block-marker');
                    if (existingMarker) existingMarker.remove();

                    // Add bullet marker
                    const marker = document.createElement('span');
                    marker.className = 'block-marker bullet-marker';
                    marker.contentEditable = 'false';
                    marker.textContent = '•';
                    currentBlock.insertBefore(marker, contentEl);
                }
            });

            // Update numbering in case we're converting from/to numbered
            updateNumberedBlocks();

            // Clear multi-block selection
            multiBlockSelection = [];

            // Restore focus to first block
            if (blocksToToggle.length > 0) {
                focusBlock(blocksToToggle[0], true);
            }
        }
    },
    {
        name: "Numbered List",
        description: "Toggle numbered list for current line(s)",
        action: () => {
            // Get blocks to operate on (multi-selection or current block)
            const blocksToToggle = multiBlockSelection.length > 0 ? multiBlockSelection : [getCurrentBlock()];
            if (blocksToToggle[0] === null) return;

            blocksToToggle.forEach(currentBlock => {
                const contentEl = currentBlock.querySelector('.block-content');
                if (!contentEl) return;

                const currentType = currentBlock.dataset.type;

                if (currentType === 'numbered') {
                    // Already numbered - convert to text
                    currentBlock.dataset.type = 'text';
                    currentBlock.className = 'block block-text';
                    const marker = currentBlock.querySelector('.block-marker');
                    if (marker) marker.remove();
                } else {
                    // Convert to numbered (from text or bullet)
                    currentBlock.dataset.type = 'numbered';
                    currentBlock.className = 'block block-numbered';

                    // Remove any existing marker
                    const existingMarker = currentBlock.querySelector('.block-marker');
                    if (existingMarker) existingMarker.remove();

                    // Add numbered marker
                    const marker = document.createElement('span');
                    marker.className = 'block-marker number-marker';
                    marker.contentEditable = 'false';
                    marker.textContent = '1.';
                    currentBlock.insertBefore(marker, contentEl);
                }
            });

            // Update numbering for all numbered blocks
            updateNumberedBlocks();

            // Clear multi-block selection
            multiBlockSelection = [];

            // Restore focus to first block
            if (blocksToToggle.length > 0) {
                focusBlock(blocksToToggle[0], true);
            }
        }
    },
    {
        name: "Block Quote",
        description: "Format current line(s) as a block quote",
        action: applyBlockQuote
    },
    {
        name: "Strikethrough Last Word",
        description: "Apply strikethrough to the last typed word (type xxxx)",
        action: strikethroughLastWord
    },
    {
        name: "Delete All Strikethrough",
        description: "Remove all struck-through words from document",
        action: deleteAllStrikethrough
    },
    {
        name: "Change Font",
        description: "Select font for the editor",
        action: openFontModal
    },
    {
        name: "Increase Font Size",
        description: "Make text larger (Ctrl/Cmd + +)",
        action: increaseFontSize
    },
    {
        name: "Decrease Font Size",
        description: "Make text smaller (Ctrl/Cmd + -)",
        action: decreaseFontSize
    },
    {
        name: "Increase Line Height",
        description: "Make text more spacious (Ctrl/Cmd + ])",
        action: increaseLineHeight
    },
    {
        name: "Decrease Line Height",
        description: "Make text more compact (Ctrl/Cmd + [)",
        action: decreaseLineHeight
    },
    {
        name: "Toggle Typewriter Mode",
        description: "Enable/disable forward-only writing",
        action: toggleTypewriterMode
    },
    {
        name: "Toggle Focus Mode",
        description: "Fade non-active paragraphs",
        action: toggleFocusMode
    },
    {
        name: "Toggle Page Style",
        description: "Switch between page and canvas view",
        action: togglePageStyle
    },
    {
        name: "Toggle Fullscreen",
        description: "Enter/exit fullscreen mode (F11)",
        action: toggleFullscreen
    },
    {
        name: "Toggle Dark Mode",
        description: "Switch between light and dark theme",
        action: toggleDarkMode
    },
    {
        name: "Toggle Word Count",
        description: "Show/hide word and character count",
        action: showWordCount
    },
    {
        name: "Clear All",
        description: "Clear all text from the editor",
        action: clearAll
    },
    {
        name: "Copy All",
        description: "Copy all content to clipboard",
        action: copyAll
    },
    {
        name: "Export as Markdown",
        description: "Download content as Markdown file",
        action: exportAsMarkdown
    },
    {
        name: "Export as Word",
        description: "Download content as Word (.docx) file",
        action: exportAsWord
    },
    {
        name: "Export All as Markdown",
        description: "Download all saved documents as .md files in a ZIP",
        action: exportAllAsMarkdown
    },
    {
        name: "Copy as Markdown",
        description: "Copy content as Markdown to clipboard",
        action: copyAsMarkdown
    },
    {
        name: "Import from Markdown",
        description: "Load content from Markdown file",
        action: importFromMarkdown
    },
    {
        name: "Delete Block",
        description: "Delete current block or selected blocks (⌘D)",
        action: deleteBlocks
    },
    {
        name: "Show Intro",
        description: "What is this?",
        action: showIntro
    },
    {
        name: "Clear Storage",
        description: "Clear auto-save from browser memory",
        action: clearStorage
    }
];

let selectedCommandIndex = 0;

// Function to apply formatting (bold or italic)
function applyFormatting(command) {
    document.execCommand(command, false, null);
    editor.focus();
}

// Function to delete all struck-through text in the document
function deleteAllStrikethrough() {
    const allBlocks = Array.from(editor.querySelectorAll('.block'));

    allBlocks.forEach(block => {
        const contentEl = block.querySelector('.block-content');
        if (!contentEl) return;

        // Find all strike elements
        const strikes = contentEl.querySelectorAll('strike, s');

        strikes.forEach(strike => {
            // Remove the strike element completely (including its content)
            strike.remove();
        });
    });

    editor.focus();
}

// Function to strikethrough the last typed word
function strikethroughLastWord(savedCursorOffset = null) {
    const selection = window.getSelection();
    if (!selection.rangeCount) return;

    // Get the current block
    const currentBlock = getCurrentBlock();
    if (!currentBlock) return;

    const contentEl = currentBlock.querySelector('.block-content');
    if (!contentEl) return;

    // Get all text content from the block
    const fullText = contentEl.textContent;

    // Get cursor position in the full text
    const range = selection.getRangeAt(0);
    let cursorOffset = savedCursorOffset;

    if (cursorOffset === null) {
        cursorOffset = 0;
        // Calculate cursor position relative to the block content
        const walker = document.createTreeWalker(
            contentEl,
            NodeFilter.SHOW_TEXT,
            null,
            false
        );

        let currentNode;
        let found = false;
        while (currentNode = walker.nextNode()) {
            if (currentNode === range.startContainer) {
                cursorOffset += range.startOffset;
                found = true;
                break;
            }
            cursorOffset += currentNode.textContent.length;
        }

        if (!found) {
            cursorOffset = fullText.length;
        }
    }

    // Find the last word before cursor (allowing trailing whitespace)
    const textBeforeCursor = fullText.substring(0, cursorOffset);

    // Match the last sequence of non-whitespace characters
    const wordMatch = textBeforeCursor.match(/\S+(?=\s*$)/);

    if (!wordMatch) return;

    const word = wordMatch[0].trim(); // Extra safety: trim any whitespace
    const wordStartOffset = textBeforeCursor.lastIndexOf(word);
    const wordEndOffset = wordStartOffset + word.length;

    // Double-check that we're not including whitespace
    const extractedWord = fullText.substring(wordStartOffset, wordEndOffset);
    if (extractedWord !== word || /\s/.test(extractedWord)) {
        console.error('Word boundary error:', { word, extracted: extractedWord });
        return;
    }

    // Now find the actual text nodes and positions for this word
    let startNode = null, startOffset = 0;
    let endNode = null, endOffset = 0;
    let currentOffset = 0;

    const walker2 = document.createTreeWalker(
        contentEl,
        NodeFilter.SHOW_TEXT,
        null,
        false
    );

    while (currentNode = walker2.nextNode()) {
        const nodeLength = currentNode.textContent.length;

        if (startNode === null && currentOffset + nodeLength > wordStartOffset) {
            startNode = currentNode;
            startOffset = wordStartOffset - currentOffset;
        }

        if (currentOffset + nodeLength >= wordEndOffset) {
            endNode = currentNode;
            endOffset = wordEndOffset - currentOffset;
            break;
        }

        currentOffset += nodeLength;
    }

    if (!startNode || !endNode) return;

    // Insert a marker element at cursor position to save it
    const marker = document.createElement('span');
    marker.id = 'cursor-marker-temp';
    marker.style.display = 'inline';
    marker.textContent = '';

    const markerRange = range.cloneRange();
    markerRange.collapse(true);
    markerRange.insertNode(marker);

    // Create a range for the word and select it
    const wordRange = document.createRange();
    wordRange.setStart(startNode, startOffset);
    wordRange.setEnd(endNode, endOffset);

    selection.removeAllRanges();
    selection.addRange(wordRange);

    // Apply strikethrough formatting
    document.execCommand('strikethrough', false, null);

    // Find the marker and restore cursor there
    try {
        const foundMarker = contentEl.querySelector('#cursor-marker-temp');
        if (foundMarker && foundMarker.parentNode) {
            // Insert a zero-width space before the marker to break formatting
            const breakSpace = document.createTextNode('\u200B');
            foundMarker.parentNode.insertBefore(breakSpace, foundMarker);

            // Place cursor after the zero-width space
            const finalRange = document.createRange();
            finalRange.setStartAfter(breakSpace);
            finalRange.collapse(true);
            selection.removeAllRanges();
            selection.addRange(finalRange);

            // Remove the marker
            foundMarker.remove();
        }
    } catch (e) {
        console.error('Error restoring cursor:', e);
    }

    editor.focus();
}

// Function to apply heading style
function applyHeading(level) {
    // Get blocks to operate on (multi-selection or current block)
    const blocksToConvert = multiBlockSelection.length > 0 ? multiBlockSelection : [getCurrentBlock()];
    if (blocksToConvert[0] === null) return;

    const headingType = `heading${level}`;

    blocksToConvert.forEach(block => {
        const contentEl = block.querySelector('.block-content');
        if (!contentEl) return;

        // Remove any markers (from lists)
        const marker = block.querySelector('.block-marker');
        if (marker) marker.remove();

        // Convert to heading
        block.dataset.type = headingType;
        block.dataset.level = '0'; // Headings don't indent
        block.className = `block block-${headingType}`;
    });

    // Update numbering in case we converted from numbered lists
    updateNumberedBlocks();

    // Clear multi-block selection
    multiBlockSelection = [];

    // Restore focus to first block
    if (blocksToConvert.length > 0) {
        focusBlock(blocksToConvert[0], true);
    }
}

// Function to apply block quote (toggle)
function applyBlockQuote() {
    // Get blocks to operate on (multi-selection or current block)
    const blocksToConvert = multiBlockSelection.length > 0 ? multiBlockSelection : [getCurrentBlock()];
    if (blocksToConvert[0] === null) return;

    blocksToConvert.forEach(block => {
        const contentEl = block.querySelector('.block-content');
        if (!contentEl) return;

        const currentType = block.dataset.type;

        if (currentType === 'quote') {
            // Already a quote - convert to text
            block.dataset.type = 'text';
            block.dataset.level = '0';
            block.className = 'block block-text';
        } else {
            // Remove any markers (from lists)
            const marker = block.querySelector('.block-marker');
            if (marker) marker.remove();

            // Convert to quote
            block.dataset.type = 'quote';
            block.dataset.level = '0'; // Quotes don't indent
            block.className = 'block block-quote';
        }
    });

    // Update numbering in case we converted from numbered lists
    updateNumberedBlocks();

    // Clear multi-block selection
    multiBlockSelection = [];

    // Restore focus to first block
    if (blocksToConvert.length > 0) {
        focusBlock(blocksToConvert[0], true);
    }
}

// Function to delete blocks
function deleteBlocks() {
    // Get blocks to delete (multi-selection or selected blocks or current block)
    let blocksToDelete;

    if (multiBlockSelection.length > 0) {
        // Use stored multi-block selection from "/" command
        blocksToDelete = multiBlockSelection;
    } else {
        // Check for any selected blocks
        const selectedBlocks = getSelectedBlocks();
        blocksToDelete = selectedBlocks.length > 0 ? selectedBlocks : [getCurrentBlock()];
    }

    if (blocksToDelete[0] === null) return;

    // Find the block that should get focus after deletion
    let focusTarget = null;
    const firstBlock = blocksToDelete[0];

    // Try to focus the block before the first deleted block
    if (firstBlock.previousElementSibling && firstBlock.previousElementSibling.classList.contains('block')) {
        focusTarget = firstBlock.previousElementSibling;
    }
    // Otherwise, focus the block after the last deleted block
    else {
        const lastBlock = blocksToDelete[blocksToDelete.length - 1];
        if (lastBlock.nextElementSibling && lastBlock.nextElementSibling.classList.contains('block')) {
            focusTarget = lastBlock.nextElementSibling;
        }
    }

    // Delete all blocks
    blocksToDelete.forEach(block => {
        block.remove();
    });

    // If no blocks remain, create a new empty block
    if (editor.querySelectorAll('.block').length === 0) {
        const newBlock = createBlockElement('text', '');
        editor.appendChild(newBlock);
        focusTarget = newBlock;
    }

    // Update numbering in case we deleted numbered blocks
    updateNumberedBlocks();

    // Clear multi-block selection
    multiBlockSelection = [];

    // Focus appropriate block
    if (focusTarget) {
        focusBlock(focusTarget, false);
    }

    // Trigger autosave
    autoSave();
}

// Helper function to detect list patterns
function detectListPattern(text, cursorPosition) {
    // Only check if space was just typed (cursor is after the space)
    // Get text before cursor
    const textBeforeCursor = text.substring(0, cursorPosition);

    // Bullet patterns: "- " or "* "
    if (/^[-*]\s$/.test(textBeforeCursor)) {
        return { type: 'bullet', patternLength: 2 }; // "- ".length
    }

    // Numbered pattern: "1. " through "99. "
    const numberedMatch = textBeforeCursor.match(/^(\d{1,2})\.\s$/);
    if (numberedMatch) {
        return { type: 'numbered', patternLength: numberedMatch[0].length };
    }

    return { type: null, patternLength: 0 };
}

// Helper function to check if cursor is at line beginning
function isAtLineBeginning(range, patternLength) {
    const node = range.startContainer;
    const cursorPosition = range.startOffset;

    // If cursor is not at position after the pattern, not at beginning
    if (node.nodeType === Node.TEXT_NODE) {
        const textContent = node.textContent;
        const textBeforePattern = textContent.substring(0, cursorPosition - patternLength);

        // Check if there's only whitespace before the pattern
        if (textBeforePattern.trim().length > 0) {
            return false;
        }

        // Check if there are previous sibling text nodes with content
        let prevNode = node.previousSibling;
        while (prevNode) {
            if (prevNode.nodeType === Node.TEXT_NODE) {
                if (prevNode.textContent.trim().length > 0) {
                    return false;
                }
            } else if (prevNode.nodeType === Node.ELEMENT_NODE) {
                // If there's a previous element (like <br>, <span>), not at beginning
                return false;
            }
            prevNode = prevNode.previousSibling;
        }

        return true;
    }

    return false;
}

// Helper function to get all selected block elements
function getSelectedBlockElements(range) {
    const blocks = [];

    // Find start and end block elements
    let startNode = range.startContainer;
    let endNode = range.endContainer;

    if (startNode.nodeType === Node.TEXT_NODE) {
        startNode = startNode.parentElement;
    }
    if (endNode.nodeType === Node.TEXT_NODE) {
        endNode = endNode.parentElement;
    }

    // Find block elements
    let startBlock = startNode.closest('p, li, h1, h2, h3, blockquote, ul, ol');
    let endBlock = endNode.closest('p, li, h1, h2, h3, blockquote, ul, ol');

    // Convert LI to their parent UL/OL for single-item lists
    if (startBlock && startBlock.tagName === 'LI') {
        const list = startBlock.parentNode;
        if (list && (list.tagName === 'UL' || list.tagName === 'OL') && list.children.length === 1) {
            startBlock = list;
        }
    }
    if (endBlock && endBlock.tagName === 'LI') {
        const list = endBlock.parentNode;
        if (list && (list.tagName === 'UL' || list.tagName === 'OL') && list.children.length === 1) {
            endBlock = list;
        }
    }

    if (!startBlock || !endBlock) {
        return blocks;
    }

    // If same block, return just that one
    if (startBlock === endBlock) {
        blocks.push(startBlock);
        return blocks;
    }

    // Collect all blocks from start to end
    let current = startBlock;
    blocks.push(current);

    while (current && current !== endBlock) {
        current = current.nextElementSibling;
        if (current && current.matches('p, li, h1, h2, h3, blockquote, ul, ol')) {
            blocks.push(current);
            if (current === endBlock) break;
        }
    }

    return blocks;
}

// Helper function to remove pattern and preserve text
function removePatternAndPreserveText(node, cursorPosition, patternLength) {
    if (node.nodeType === Node.TEXT_NODE) {
        const textContent = node.textContent;

        // Remove pattern from beginning
        const newText = textContent.substring(0, cursorPosition - patternLength) +
                       textContent.substring(cursorPosition);
        node.textContent = newText;

        // Return new cursor position (accounting for removed pattern)
        return cursorPosition - patternLength;
    }
    return 0;
}

// Function to save content to localStorage
function saveContent() {
    const content = editor.innerHTML;
    localStorage.setItem("editorContent", content);
    console.log("Content saved");
}

// Function to load content from localStorage
function loadContent() {
    const savedContent = localStorage.getItem("editorContent");
    if (savedContent) {
        editor.innerHTML = savedContent;

        // Ensure we have at least one block
        if (editor.children.length === 0) {
            const firstBlock = createBlockElement('text', '');
            editor.appendChild(firstBlock);
            return;
        }

        // Check if content is in block format (has .block elements)
        const hasBlocks = editor.querySelector('.block') !== null;
        if (!hasBlocks) {
            // Old format detected - clear and start fresh
            console.log("Old format detected, starting fresh");
            editor.innerHTML = '';
            const firstBlock = createBlockElement('text', '');
            editor.appendChild(firstBlock);
            return;
        }

        // Normalize loaded blocks to ensure proper structure
        const blocks = Array.from(editor.querySelectorAll('.block'));
        blocks.forEach(block => {
            // Ensure markers have contenteditable="false"
            const markers = block.querySelectorAll('.block-marker');
            markers.forEach(marker => {
                marker.contentEditable = 'false';
            });

            // Ensure block-content exists
            let contentEl = block.querySelector('.block-content');
            if (!contentEl) {
                // Missing block-content - create it and move all content into it
                contentEl = document.createElement('div');
                contentEl.className = 'block-content';
                contentEl.contentEditable = 'true';
                // Move all non-marker children into contentEl
                Array.from(block.childNodes).forEach(child => {
                    if (!child.classList || !child.classList.contains('block-marker')) {
                        contentEl.appendChild(child.cloneNode(true));
                    }
                });
                // Clear and rebuild block structure
                const marker = block.querySelector('.block-marker');
                block.innerHTML = '';
                if (marker) {
                    block.appendChild(marker);
                }
                block.appendChild(contentEl);
            }

            // Ensure block-content is contenteditable
            contentEl.contentEditable = 'true';

            // Ensure block has a level attribute
            if (!block.dataset.level) {
                block.dataset.level = '0';
            }

            // Ensure empty blocks have <br> or text node
            if (contentEl.childNodes.length === 0 || contentEl.innerHTML.trim() === '') {
                contentEl.innerHTML = '<br>';
            }
        });

        // Clean up any loose text nodes in the editor (text not inside blocks)
        Array.from(editor.childNodes).forEach(node => {
            if (node.nodeType === Node.TEXT_NODE && node.textContent.trim() !== '') {
                console.log("Removing loose text node:", node.textContent);
                node.remove();
            } else if (node.nodeType === Node.ELEMENT_NODE && !node.classList.contains('block')) {
                console.log("Removing non-block element:", node);
                node.remove();
            }
        });

        // Update numbered blocks
        updateNumberedBlocks();

        // Focus the first block
        const firstBlock = editor.querySelector('.block');
        if (firstBlock) {
            focusBlock(firstBlock);
        }
    } else {
        // No saved content - initialize with one empty block
        const firstBlock = createBlockElement('text', '');
        editor.appendChild(firstBlock);
        focusBlock(firstBlock);
    }
}

// Function to auto-save with debouncing
function autoSave() {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
        saveContent();
    }, 1000); // Save 1 second after user stops typing
}

// Function to toggle dark mode
function toggleDarkMode() {
    document.body.classList.toggle("dark-mode");
    // Save preference to localStorage
    const isDarkMode = document.body.classList.contains("dark-mode");
    localStorage.setItem("darkMode", isDarkMode);
}

// Function to toggle page style
function togglePageStyle() {
    document.body.classList.toggle("canvas-mode");
    // Save preference to localStorage
    const isCanvasMode = document.body.classList.contains("canvas-mode");
    localStorage.setItem("canvasMode", isCanvasMode);
}

// Function to toggle fullscreen
function toggleFullscreen() {
    if (!document.fullscreenElement) {
        // Enter fullscreen
        document.documentElement.requestFullscreen().catch(err => {
            console.error(`Error attempting to enable fullscreen: ${err.message}`);
        });
    } else {
        // Exit fullscreen
        if (document.exitFullscreen) {
            document.exitFullscreen();
        }
    }
}

// Function to update word count display
function updateWordCount() {
    let text;
    const selection = window.getSelection();

    // Check if there's selected text
    if (selection && !selection.isCollapsed && editor.contains(selection.anchorNode)) {
        text = selection.toString();
    } else {
        // No selection, use full editor content
        text = editor.innerText || editor.textContent || "";
    }

    const words = text.trim().split(/\s+/).filter(w => w.length > 0).length;
    const chars = text.length;

    wordCountSpan.textContent = `${words} ${words === 1 ? 'word' : 'words'}`;
    charCountSpan.textContent = `${chars} ${chars === 1 ? 'character' : 'characters'}`;
}

// Function to toggle word count display
function showWordCount() {
    wordCountVisible = !wordCountVisible;

    if (wordCountVisible) {
        wordCountDisplay.classList.remove("hidden");
        updateWordCount();
    } else {
        wordCountDisplay.classList.add("hidden");
    }
}

// Function to clear all text
async function clearAll() {
    const confirmed = await showConfirm("Are you sure you want to clear all text?");
    if (confirmed) {
        editor.innerHTML = "";
        currentDocumentName = null; // Clear current document pointer

        // Clear URL parameter
        clearURL();

        // Clear page title
        clearPageTitle();

        // Create a new empty block
        const firstBlock = createBlockElement('text', '');
        editor.appendChild(firstBlock);

        // Trigger autosave
        autoSave();

        // Focus the new block
        focusBlock(firstBlock);
    }
}

// Function to copy all content
function copyAll() {
    const text = editor.innerText || editor.textContent || "";
    navigator.clipboard.writeText(text).then(() => {
        // Could show a toast notification here
        console.log("Content copied to clipboard");
    }).catch(err => {
        console.error("Failed to copy:", err);
    });
}

// Function to show alert modal
function showAlert(message) {
    return new Promise((resolve) => {
        dialogMessage.textContent = message;
        dialogConfirmButton.textContent = 'OK';
        dialogCancelButton.style.display = 'none';
        dialogModal.classList.remove('hidden');

        const handleConfirm = () => {
            dialogModal.classList.add('hidden');
            cleanup();
            resolve();
        };

        const handleKeydown = (event) => {
            if (event.key === 'Enter' || event.key === 'Escape') {
                event.preventDefault();
                handleConfirm();
            }
        };

        const cleanup = () => {
            dialogConfirmButton.removeEventListener('click', handleConfirm);
            document.removeEventListener('keydown', handleKeydown);
        };

        dialogConfirmButton.addEventListener('click', handleConfirm);
        document.addEventListener('keydown', handleKeydown);

        // Focus the OK button
        setTimeout(() => dialogConfirmButton.focus(), 0);
    });
}

// Function to show confirm modal
function showConfirm(message) {
    return new Promise((resolve) => {
        dialogMessage.textContent = message;
        dialogConfirmButton.textContent = 'OK';
        dialogCancelButton.style.display = 'inline-block';
        dialogModal.classList.remove('hidden');

        const handleConfirm = () => {
            dialogModal.classList.add('hidden');
            cleanup();
            resolve(true);
        };

        const handleCancel = () => {
            dialogModal.classList.add('hidden');
            cleanup();
            resolve(false);
        };

        const handleKeydown = (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                // Check which button has focus
                if (document.activeElement === dialogCancelButton) {
                    handleCancel();
                } else {
                    handleConfirm();
                }
            } else if (event.key === 'Escape') {
                event.preventDefault();
                handleCancel();
            }
        };

        const cleanup = () => {
            dialogConfirmButton.removeEventListener('click', handleConfirm);
            dialogCancelButton.removeEventListener('click', handleCancel);
            document.removeEventListener('keydown', handleKeydown);
        };

        dialogConfirmButton.addEventListener('click', handleConfirm);
        dialogCancelButton.addEventListener('click', handleCancel);
        document.addEventListener('keydown', handleKeydown);

        // Focus the OK button by default
        setTimeout(() => dialogConfirmButton.focus(), 0);
    });
}

// Function to show intro content in modal
function showIntro() {
    introText.innerHTML = introHTML;
    introModal.classList.remove("hidden");
}

// Function to clear saved content from storage
async function clearStorage() {
    const confirmed = await showConfirm("Are you sure you want to clear all saved content from browser memory?");
    if (confirmed) {
        localStorage.removeItem("editorContent");
        console.log("Storage cleared");
    }
}

// Function to convert HTML to Markdown
function htmlToMarkdown(element, listDepth = 0) {
    let markdown = '';

    // Process each child node
    for (const node of element.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
            markdown += node.textContent;
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            const tagName = node.tagName.toLowerCase();

            switch (tagName) {
                case 'h1':
                    markdown += '# ' + getTextContent(node).trim() + '\n\n';
                    break;
                case 'h2':
                    markdown += '## ' + getTextContent(node).trim() + '\n\n';
                    break;
                case 'h3':
                    markdown += '### ' + getTextContent(node).trim() + '\n\n';
                    break;
                case 'strong':
                case 'b':
                    markdown += '**' + getTextContent(node) + '**';
                    break;
                case 'em':
                case 'i':
                    markdown += '*' + getTextContent(node) + '*';
                    break;
                case 'p':
                    markdown += htmlToMarkdown(node, listDepth).trim() + '\n\n';
                    break;
                case 'blockquote':
                    const lines = getTextContent(node).trim().split('\n');
                    markdown += lines.map(line => '> ' + line).join('\n') + '\n\n';
                    break;
                case 'ul':
                    markdown += processList(node, false, listDepth);
                    if (listDepth === 0) markdown += '\n';
                    break;
                case 'ol':
                    markdown += processList(node, true, listDepth);
                    if (listDepth === 0) markdown += '\n';
                    break;
                case 'li':
                    // Handled by processList
                    markdown += htmlToMarkdown(node, listDepth);
                    break;
                case 'br':
                    markdown += '\n';
                    break;
                case 'div':
                    markdown += htmlToMarkdown(node, listDepth);
                    if (htmlToMarkdown(node, listDepth).trim()) {
                        markdown += '\n';
                    }
                    break;
                default:
                    markdown += htmlToMarkdown(node, listDepth);
            }
        }
    }

    return markdown;
}

// Helper to get text content with formatting
function getTextContent(node) {
    let text = '';
    for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
            text += child.textContent;
        } else if (child.nodeType === Node.ELEMENT_NODE) {
            const tag = child.tagName.toLowerCase();
            if (tag === 'strong' || tag === 'b') {
                text += '**' + getTextContent(child) + '**';
            } else if (tag === 'em' || tag === 'i') {
                text += '*' + getTextContent(child) + '*';
            } else if (tag !== 'ul' && tag !== 'ol') {
                text += getTextContent(child);
            }
        }
    }
    return text;
}

// Process list with proper nesting
function processList(listNode, isOrdered, depth) {
    let markdown = '';
    let counter = 0;
    const indent = '  '.repeat(depth);
    const children = Array.from(listNode.children);

    for (let i = 0; i < children.length; i++) {
        const child = children[i];
        const tag = child.tagName.toLowerCase();

        if (tag === 'li') {
            counter++;

            // Get item text (excluding nested lists)
            let itemText = '';
            for (const liChild of child.childNodes) {
                if (liChild.nodeType === Node.TEXT_NODE) {
                    itemText += liChild.textContent;
                } else if (liChild.nodeType === Node.ELEMENT_NODE) {
                    const liTag = liChild.tagName.toLowerCase();
                    if (liTag === 'strong' || liTag === 'b') {
                        itemText += '**' + getTextContent(liChild) + '**';
                    } else if (liTag === 'em' || liTag === 'i') {
                        itemText += '*' + getTextContent(liChild) + '*';
                    } else if (liTag !== 'ul' && liTag !== 'ol') {
                        itemText += getTextContent(liChild);
                    }
                }
            }

            // Write the list item
            const marker = isOrdered ? `${counter}. ` : '- ';
            markdown += indent + marker + itemText.trim() + '\n';

            // Check if next sibling is a nested list (malformed HTML from contenteditable)
            if (i + 1 < children.length) {
                const nextChild = children[i + 1];
                const nextTag = nextChild.tagName.toLowerCase();
                if (nextTag === 'ul' || nextTag === 'ol') {
                    // Process the nested list
                    markdown += processList(nextChild, nextTag === 'ol', depth + 1);
                    // Skip the nested list in the main loop
                    i++;
                }
            }

            // Also check for properly nested lists (inside the LI)
            for (const liChild of child.children) {
                const liTag = liChild.tagName.toLowerCase();
                if (liTag === 'ul') {
                    markdown += processList(liChild, false, depth + 1);
                } else if (liTag === 'ol') {
                    markdown += processList(liChild, true, depth + 1);
                }
            }
        } else if (tag === 'ul' || tag === 'ol') {
            // Orphaned nested list (shouldn't happen if previous code works, but handle it anyway)
            markdown += processList(child, tag === 'ol', depth);
        }
    }

    return markdown;
}

// Function to generate filename with date/time
function generateMarkdownFilename() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');

    return `document_${year}-${month}-${day}_${hours}-${minutes}-${seconds}.md`;
}

// Helper function to convert HTML content to Markdown
function htmlToMarkdown(htmlContent) {
    // Create a temporary container to parse the HTML
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = htmlContent;
    const blocks = tempDiv.querySelectorAll('.block');
    let markdown = '';
    let numberedCounters = {}; // Track counters for each level

    blocks.forEach(block => {
        const type = block.dataset.type || 'text';
        const level = parseInt(block.dataset.level) || 0;
        const contentEl = block.querySelector('.block-content');
        const content = contentEl ? contentEl.textContent.trim() : '';

        // Empty text blocks should reset numbered counters and add spacing
        if (!content && type === 'text') {
            numberedCounters = {};
            markdown += '\n';
            return;
        }

        // Create indentation (2 spaces per level)
        const indent = '  '.repeat(level);

        switch (type) {
            case 'heading1':
                // Reset numbered counters when hitting non-numbered block
                numberedCounters = {};
                markdown += '# ' + content + '\n\n';
                break;
            case 'heading2':
                // Reset numbered counters when hitting non-numbered block
                numberedCounters = {};
                markdown += '## ' + content + '\n\n';
                break;
            case 'heading3':
                // Reset numbered counters when hitting non-numbered block
                numberedCounters = {};
                markdown += '### ' + content + '\n\n';
                break;
            case 'bullet':
                // Reset numbered counters when hitting non-numbered block
                numberedCounters = {};
                markdown += indent + '- ' + content + '\n';
                break;
            case 'numbered':
                // Initialize counter for this level if needed
                if (!numberedCounters[level]) {
                    numberedCounters[level] = 1;
                } else {
                    numberedCounters[level]++;
                }
                // Reset counters for deeper levels
                Object.keys(numberedCounters).forEach(l => {
                    if (parseInt(l) > level) {
                        delete numberedCounters[l];
                    }
                });
                markdown += indent + numberedCounters[level] + '. ' + content + '\n';
                break;
            case 'quote':
                // Reset numbered counters when hitting non-numbered block
                numberedCounters = {};
                markdown += '> ' + content + '\n\n';
                break;
            case 'text':
            default:
                // Reset numbered counters when hitting non-numbered block
                numberedCounters = {};
                if (content) {
                    markdown += content + '\n\n';
                }
                break;
        }
    });

    // Clean up excessive line breaks (more than 2 consecutive newlines)
    return markdown.replace(/\n{3,}/g, '\n\n').trim();
}

// Function to export as Markdown
function exportAsMarkdown() {
    const markdown = htmlToMarkdown(editor.innerHTML);

    // Create blob
    const blob = new Blob([markdown], { type: 'text/markdown' });

    // Create download link
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = generateMarkdownFilename();

    // Trigger download
    document.body.appendChild(a);
    a.click();

    // Cleanup
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    console.log('Markdown exported successfully');
}

// Function to export all saved documents as Markdown files in a ZIP
async function exportAllAsMarkdown() {
    const docs = getSavedDocuments();

    if (docs.length === 0) {
        await showAlert("No saved documents to export.");
        return;
    }

    const files = [];

    // Convert each saved document to markdown
    docs.forEach(doc => {
        const htmlContent = localStorage.getItem(`doc_${doc.name}`);
        if (htmlContent) {
            const markdown = htmlToMarkdown(htmlContent);
            // Create safe filename (replace invalid characters)
            const safeFilename = doc.name.replace(/[^a-z0-9_-]/gi, '_');
            files.push({
                name: `${safeFilename}.md`,
                content: markdown
            });
        }
    });

    // Create ZIP blob using the existing ZIP generator
    const zipBlob = createZipBlob(files);

    // Generate filename with timestamp
    const now = new Date();
    const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const zipFilename = `thesis_documents_${timestamp}.zip`;

    // Create download link
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = zipFilename;

    // Trigger download
    document.body.appendChild(a);
    a.click();

    // Cleanup
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    console.log(`Exported ${files.length} documents as ${zipFilename}`);
}

// Function to copy content as Markdown to clipboard
async function copyAsMarkdown() {
    // Convert blocks to Markdown (same logic as exportAsMarkdown)
    const blocks = editor.querySelectorAll('.block');
    let markdown = '';
    let numberedCounters = {}; // Track counters for each level

    blocks.forEach(block => {
        const type = block.dataset.type || 'text';
        const level = parseInt(block.dataset.level) || 0;
        const contentEl = block.querySelector('.block-content');
        const content = contentEl ? contentEl.textContent.trim() : '';

        // Empty text blocks should reset numbered counters and add spacing
        if (!content && type === 'text') {
            numberedCounters = {};
            markdown += '\n';
            return;
        }

        // Create indentation (2 spaces per level)
        const indent = '  '.repeat(level);

        switch (type) {
            case 'heading1':
                // Reset numbered counters when hitting non-numbered block
                numberedCounters = {};
                markdown += '# ' + content + '\n\n';
                break;
            case 'heading2':
                // Reset numbered counters when hitting non-numbered block
                numberedCounters = {};
                markdown += '## ' + content + '\n\n';
                break;
            case 'heading3':
                // Reset numbered counters when hitting non-numbered block
                numberedCounters = {};
                markdown += '### ' + content + '\n\n';
                break;
            case 'bullet':
                // Reset numbered counters when hitting non-numbered block
                numberedCounters = {};
                markdown += indent + '- ' + content + '\n';
                break;
            case 'numbered':
                // Initialize counter for this level if needed
                if (!numberedCounters[level]) {
                    numberedCounters[level] = 1;
                } else {
                    numberedCounters[level]++;
                }
                // Reset counters for deeper levels
                Object.keys(numberedCounters).forEach(l => {
                    if (parseInt(l) > level) {
                        delete numberedCounters[l];
                    }
                });
                markdown += indent + numberedCounters[level] + '. ' + content + '\n';
                break;
            case 'quote':
                // Reset numbered counters when hitting non-numbered block
                numberedCounters = {};
                markdown += '> ' + content + '\n\n';
                break;
            case 'text':
            default:
                // Reset numbered counters when hitting non-numbered block
                numberedCounters = {};
                if (content) {
                    markdown += content + '\n\n';
                }
                break;
        }
    });

    // Clean up excessive line breaks (more than 2 consecutive newlines)
    const cleanedMarkdown = markdown.replace(/\n{3,}/g, '\n\n').trim();

    // Copy to clipboard
    try {
        await navigator.clipboard.writeText(cleanedMarkdown);
        console.log('Markdown copied to clipboard');
    } catch (err) {
        console.error('Failed to copy to clipboard:', err);
    }
}

// ===== DOCX Export Functions =====

// Minimal ZIP file generator (no dependencies)
function createZipBlob(files) {
    // Helper: Convert string to Uint8Array with proper UTF-8 encoding
    const textEncoder = new TextEncoder();
    function str2bytes(str) {
        return textEncoder.encode(str);
    }

    // Helper: Calculate CRC32
    function crc32(bytes) {
        let crc = 0xFFFFFFFF;
        const table = [];

        // Generate CRC table
        for (let i = 0; i < 256; i++) {
            let c = i;
            for (let j = 0; j < 8; j++) {
                c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            }
            table[i] = c;
        }

        // Calculate CRC
        for (let i = 0; i < bytes.length; i++) {
            crc = table[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
        }

        return (crc ^ 0xFFFFFFFF) >>> 0;
    }

    // Helper: Write 32-bit little-endian
    function write32(value) {
        return new Uint8Array([
            value & 0xFF,
            (value >>> 8) & 0xFF,
            (value >>> 16) & 0xFF,
            (value >>> 24) & 0xFF
        ]);
    }

    // Helper: Write 16-bit little-endian
    function write16(value) {
        return new Uint8Array([
            value & 0xFF,
            (value >>> 8) & 0xFF
        ]);
    }

    const zipParts = [];
    const centralDir = [];
    let offset = 0;

    // Process each file
    files.forEach(file => {
        const nameBytes = str2bytes(file.name);
        const contentBytes = str2bytes(file.content);
        const crc = crc32(contentBytes);

        // Local file header
        const localHeader = new Uint8Array(30 + nameBytes.length);
        let pos = 0;

        // Signature
        localHeader.set([0x50, 0x4B, 0x03, 0x04], pos); pos += 4;
        // Version needed
        localHeader.set(write16(20), pos); pos += 2;
        // Flags
        localHeader.set(write16(0), pos); pos += 2;
        // Compression method (0 = no compression)
        localHeader.set(write16(0), pos); pos += 2;
        // Mod time
        localHeader.set(write16(0), pos); pos += 2;
        // Mod date
        localHeader.set(write16(0), pos); pos += 2;
        // CRC32
        localHeader.set(write32(crc), pos); pos += 4;
        // Compressed size
        localHeader.set(write32(contentBytes.length), pos); pos += 4;
        // Uncompressed size
        localHeader.set(write32(contentBytes.length), pos); pos += 4;
        // Filename length
        localHeader.set(write16(nameBytes.length), pos); pos += 2;
        // Extra field length
        localHeader.set(write16(0), pos); pos += 2;
        // Filename
        localHeader.set(nameBytes, pos);

        zipParts.push(localHeader);
        zipParts.push(contentBytes);

        // Central directory entry
        const centralHeader = new Uint8Array(46 + nameBytes.length);
        pos = 0;

        // Signature
        centralHeader.set([0x50, 0x4B, 0x01, 0x02], pos); pos += 4;
        // Version made by
        centralHeader.set(write16(20), pos); pos += 2;
        // Version needed
        centralHeader.set(write16(20), pos); pos += 2;
        // Flags
        centralHeader.set(write16(0), pos); pos += 2;
        // Compression method
        centralHeader.set(write16(0), pos); pos += 2;
        // Mod time
        centralHeader.set(write16(0), pos); pos += 2;
        // Mod date
        centralHeader.set(write16(0), pos); pos += 2;
        // CRC32
        centralHeader.set(write32(crc), pos); pos += 4;
        // Compressed size
        centralHeader.set(write32(contentBytes.length), pos); pos += 4;
        // Uncompressed size
        centralHeader.set(write32(contentBytes.length), pos); pos += 4;
        // Filename length
        centralHeader.set(write16(nameBytes.length), pos); pos += 2;
        // Extra field length
        centralHeader.set(write16(0), pos); pos += 2;
        // Comment length
        centralHeader.set(write16(0), pos); pos += 2;
        // Disk number
        centralHeader.set(write16(0), pos); pos += 2;
        // Internal attributes
        centralHeader.set(write16(0), pos); pos += 2;
        // External attributes
        centralHeader.set(write32(0), pos); pos += 4;
        // Offset
        centralHeader.set(write32(offset), pos); pos += 4;
        // Filename
        centralHeader.set(nameBytes, pos);

        centralDir.push(centralHeader);
        offset += localHeader.length + contentBytes.length;
    });

    // Combine central directory
    const centralDirSize = centralDir.reduce((sum, arr) => sum + arr.length, 0);
    const centralDirOffset = offset;

    // End of central directory
    const eocd = new Uint8Array(22);
    pos = 0;
    // Signature
    eocd.set([0x50, 0x4B, 0x05, 0x06], pos); pos += 4;
    // Disk number
    eocd.set(write16(0), pos); pos += 2;
    // Central dir disk
    eocd.set(write16(0), pos); pos += 2;
    // Entries on this disk
    eocd.set(write16(files.length), pos); pos += 2;
    // Total entries
    eocd.set(write16(files.length), pos); pos += 2;
    // Central dir size
    eocd.set(write32(centralDirSize), pos); pos += 4;
    // Central dir offset
    eocd.set(write32(centralDirOffset), pos); pos += 4;
    // Comment length
    eocd.set(write16(0), pos);

    // Combine all parts
    const totalLength = zipParts.reduce((sum, arr) => sum + arr.length, 0) + centralDirSize + eocd.length;
    const zipData = new Uint8Array(totalLength);

    let currentOffset = 0;
    zipParts.forEach(part => {
        zipData.set(part, currentOffset);
        currentOffset += part.length;
    });
    centralDir.forEach(part => {
        zipData.set(part, currentOffset);
        currentOffset += part.length;
    });
    zipData.set(eocd, currentOffset);

    return new Blob([zipData], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

// Generate DOCX XML content
function generateDocxXml(blocks) {
    let xml = '';
    let numberedCounters = {};

    blocks.forEach(block => {
        const type = block.dataset.type || 'text';
        const level = parseInt(block.dataset.level) || 0;
        const contentEl = block.querySelector('.block-content');
        const content = contentEl ? contentEl.textContent.trim() : '';

        if (!content && type === 'text') {
            numberedCounters = {};
            // Empty paragraph
            xml += '<w:p><w:pPr></w:pPr></w:p>';
            return;
        }

        // Escape XML special characters
        const escapedContent = content
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');

        const indentLeft = level * 720; // 720 twips = 0.5 inch

        switch (type) {
            case 'heading1':
                numberedCounters = {};
                xml += `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${escapedContent}</w:t></w:r></w:p>`;
                break;
            case 'heading2':
                numberedCounters = {};
                xml += `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>${escapedContent}</w:t></w:r></w:p>`;
                break;
            case 'heading3':
                numberedCounters = {};
                xml += `<w:p><w:pPr><w:pStyle w:val="Heading3"/></w:pPr><w:r><w:t>${escapedContent}</w:t></w:r></w:p>`;
                break;
            case 'bullet':
                numberedCounters = {};
                xml += `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="1"/></w:numPr><w:ind w:left="${indentLeft}"/></w:pPr><w:r><w:t>${escapedContent}</w:t></w:r></w:p>`;
                break;
            case 'numbered':
                if (!numberedCounters[level]) {
                    numberedCounters[level] = 1;
                } else {
                    numberedCounters[level]++;
                }
                Object.keys(numberedCounters).forEach(l => {
                    if (parseInt(l) > level) {
                        delete numberedCounters[l];
                    }
                });
                xml += `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="2"/></w:numPr><w:ind w:left="${indentLeft}"/></w:pPr><w:r><w:t>${escapedContent}</w:t></w:r></w:p>`;
                break;
            case 'quote':
                numberedCounters = {};
                xml += `<w:p><w:pPr><w:pStyle w:val="Quote"/></w:pPr><w:r><w:t>${escapedContent}</w:t></w:r></w:p>`;
                break;
            case 'text':
            default:
                numberedCounters = {};
                if (content) {
                    xml += `<w:p><w:r><w:t>${escapedContent}</w:t></w:r></w:p>`;
                }
                break;
        }
    });

    return xml;
}

// Generate complete DOCX document.xml
function generateDocumentXml(bodyContent) {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<w:body>${bodyContent}</w:body>
</w:document>`;
}

// Generate [Content_Types].xml
function generateContentTypes() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
</Types>`;
}

// Generate _rels/.rels
function generateRootRels() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
}

// Generate word/_rels/document.xml.rels
function generateDocumentRels() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
</Relationships>`;
}

// Generate word/styles.xml
function generateStyles() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:style w:type="paragraph" w:styleId="Normal">
<w:name w:val="Normal"/>
<w:qFormat/>
</w:style>
<w:style w:type="paragraph" w:styleId="Heading1">
<w:name w:val="Heading 1"/>
<w:basedOn w:val="Normal"/>
<w:next w:val="Normal"/>
<w:qFormat/>
<w:pPr>
<w:spacing w:before="240" w:after="120"/>
</w:pPr>
<w:rPr>
<w:b/>
<w:sz w:val="32"/>
</w:rPr>
</w:style>
<w:style w:type="paragraph" w:styleId="Heading2">
<w:name w:val="Heading 2"/>
<w:basedOn w:val="Normal"/>
<w:next w:val="Normal"/>
<w:qFormat/>
<w:pPr>
<w:spacing w:before="200" w:after="100"/>
</w:pPr>
<w:rPr>
<w:b/>
<w:sz w:val="28"/>
</w:rPr>
</w:style>
<w:style w:type="paragraph" w:styleId="Heading3">
<w:name w:val="Heading 3"/>
<w:basedOn w:val="Normal"/>
<w:next w:val="Normal"/>
<w:qFormat/>
<w:pPr>
<w:spacing w:before="160" w:after="80"/>
</w:pPr>
<w:rPr>
<w:b/>
<w:sz w:val="24"/>
</w:rPr>
</w:style>
<w:style w:type="paragraph" w:styleId="Quote">
<w:name w:val="Quote"/>
<w:basedOn w:val="Normal"/>
<w:pPr>
<w:ind w:left="720"/>
</w:pPr>
<w:rPr>
<w:i/>
</w:rPr>
</w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph">
<w:name w:val="List Paragraph"/>
<w:basedOn w:val="Normal"/>
</w:style>
</w:styles>`;
}

// Generate word/numbering.xml
function generateNumbering() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:abstractNum w:abstractNumId="0">
<w:multiLevelType w:val="hybridMultilevel"/>
<w:lvl w:ilvl="0">
<w:start w:val="1"/>
<w:numFmt w:val="bullet"/>
<w:lvlText w:val="•"/>
<w:lvlJc w:val="left"/>
<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>
</w:lvl>
<w:lvl w:ilvl="1">
<w:start w:val="1"/>
<w:numFmt w:val="bullet"/>
<w:lvlText w:val="○"/>
<w:lvlJc w:val="left"/>
<w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr>
</w:lvl>
<w:lvl w:ilvl="2">
<w:start w:val="1"/>
<w:numFmt w:val="bullet"/>
<w:lvlText w:val="■"/>
<w:lvlJc w:val="left"/>
<w:pPr><w:ind w:left="2160" w:hanging="360"/></w:pPr>
</w:lvl>
</w:abstractNum>
<w:abstractNum w:abstractNumId="1">
<w:multiLevelType w:val="hybridMultilevel"/>
<w:lvl w:ilvl="0">
<w:start w:val="1"/>
<w:numFmt w:val="decimal"/>
<w:lvlText w:val="%1."/>
<w:lvlJc w:val="left"/>
<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>
</w:lvl>
<w:lvl w:ilvl="1">
<w:start w:val="1"/>
<w:numFmt w:val="decimal"/>
<w:lvlText w:val="%2."/>
<w:lvlJc w:val="left"/>
<w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr>
</w:lvl>
<w:lvl w:ilvl="2">
<w:start w:val="1"/>
<w:numFmt w:val="decimal"/>
<w:lvlText w:val="%3."/>
<w:lvlJc w:val="left"/>
<w:pPr><w:ind w:left="2160" w:hanging="360"/></w:pPr>
</w:lvl>
</w:abstractNum>
<w:num w:numId="1">
<w:abstractNumId w:val="0"/>
</w:num>
<w:num w:numId="2">
<w:abstractNumId w:val="1"/>
</w:num>
</w:numbering>`;
}

// Generate filename for Word export
function generateWordFilename() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');

    return `document_${year}-${month}-${day}_${hours}-${minutes}-${seconds}.docx`;
}

// Main export function
function exportAsWord() {
    const blocks = editor.querySelectorAll('.block');
    const bodyContent = generateDocxXml(blocks);
    const documentXml = generateDocumentXml(bodyContent);

    // Create DOCX structure
    const files = [
        { name: '[Content_Types].xml', content: generateContentTypes() },
        { name: '_rels/.rels', content: generateRootRels() },
        { name: 'word/document.xml', content: documentXml },
        { name: 'word/_rels/document.xml.rels', content: generateDocumentRels() },
        { name: 'word/styles.xml', content: generateStyles() },
        { name: 'word/numbering.xml', content: generateNumbering() }
    ];

    // Create ZIP blob
    const blob = createZipBlob(files);

    // Create download link
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = generateWordFilename();

    // Trigger download
    document.body.appendChild(a);
    a.click();

    // Cleanup
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    console.log('Word document exported successfully');
}

// Function to convert Markdown to HTML
function markdownToHtml(markdown) {
    const lines = markdown.split('\n');
    let html = '';
    let inParagraph = false;
    let paragraphContent = '';
    let inList = false;
    let listType = '';
    let listItems = '';
    let inBlockquote = false;
    let blockquoteContent = '';

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];

        // Check for block quote
        if (line.startsWith('> ')) {
            if (inParagraph) {
                html += `<p>${processInlineFormatting(paragraphContent.trim())}</p>`;
                paragraphContent = '';
                inParagraph = false;
            }
            if (inList) {
                html += listType === 'ul' ? `<ul>${listItems}</ul>` : `<ol>${listItems}</ol>`;
                listItems = '';
                inList = false;
            }
            if (!inBlockquote) {
                inBlockquote = true;
                blockquoteContent = '';
            }
            blockquoteContent += line.substring(2) + '\n';
        } else if (inBlockquote && line.trim() === '') {
            // End blockquote on empty line
            html += `<blockquote>${processInlineFormatting(blockquoteContent.trim())}</blockquote>`;
            blockquoteContent = '';
            inBlockquote = false;
        } else if (line.match(/^-\s+/) || line.match(/^\*\s+/)) {
            // Bullet list item
            if (inParagraph) {
                html += `<p>${processInlineFormatting(paragraphContent.trim())}</p>`;
                paragraphContent = '';
                inParagraph = false;
            }
            if (inBlockquote) {
                html += `<blockquote>${processInlineFormatting(blockquoteContent.trim())}</blockquote>`;
                blockquoteContent = '';
                inBlockquote = false;
            }
            if (!inList || listType !== 'ul') {
                if (inList) {
                    html += `<ol>${listItems}</ol>`;
                }
                inList = true;
                listType = 'ul';
                listItems = '';
            }
            const itemContent = line.replace(/^[-*]\s+/, '');
            listItems += `<li>${processInlineFormatting(itemContent)}</li>`;
        } else if (line.match(/^\d+\.\s+/)) {
            // Numbered list item
            if (inParagraph) {
                html += `<p>${processInlineFormatting(paragraphContent.trim())}</p>`;
                paragraphContent = '';
                inParagraph = false;
            }
            if (inBlockquote) {
                html += `<blockquote>${processInlineFormatting(blockquoteContent.trim())}</blockquote>`;
                blockquoteContent = '';
                inBlockquote = false;
            }
            if (!inList || listType !== 'ol') {
                if (inList) {
                    html += `<ul>${listItems}</ul>`;
                }
                inList = true;
                listType = 'ol';
                listItems = '';
            }
            const itemContent = line.replace(/^\d+\.\s+/, '');
            listItems += `<li>${processInlineFormatting(itemContent)}</li>`;
        } else if (line.startsWith('### ')) {
            if (inParagraph) {
                html += `<p>${processInlineFormatting(paragraphContent.trim())}</p>`;
                paragraphContent = '';
                inParagraph = false;
            }
            if (inList) {
                html += listType === 'ul' ? `<ul>${listItems}</ul>` : `<ol>${listItems}</ol>`;
                listItems = '';
                inList = false;
            }
            if (inBlockquote) {
                html += `<blockquote>${processInlineFormatting(blockquoteContent.trim())}</blockquote>`;
                blockquoteContent = '';
                inBlockquote = false;
            }
            html += `<h3>${processInlineFormatting(line.substring(4))}</h3>`;
        } else if (line.startsWith('## ')) {
            if (inParagraph) {
                html += `<p>${processInlineFormatting(paragraphContent.trim())}</p>`;
                paragraphContent = '';
                inParagraph = false;
            }
            if (inList) {
                html += listType === 'ul' ? `<ul>${listItems}</ul>` : `<ol>${listItems}</ol>`;
                listItems = '';
                inList = false;
            }
            if (inBlockquote) {
                html += `<blockquote>${processInlineFormatting(blockquoteContent.trim())}</blockquote>`;
                blockquoteContent = '';
                inBlockquote = false;
            }
            html += `<h2>${processInlineFormatting(line.substring(3))}</h2>`;
        } else if (line.startsWith('# ')) {
            if (inParagraph) {
                html += `<p>${processInlineFormatting(paragraphContent.trim())}</p>`;
                paragraphContent = '';
                inParagraph = false;
            }
            if (inList) {
                html += listType === 'ul' ? `<ul>${listItems}</ul>` : `<ol>${listItems}</ol>`;
                listItems = '';
                inList = false;
            }
            if (inBlockquote) {
                html += `<blockquote>${processInlineFormatting(blockquoteContent.trim())}</blockquote>`;
                blockquoteContent = '';
                inBlockquote = false;
            }
            html += `<h1>${processInlineFormatting(line.substring(2))}</h1>`;
        } else if (line.trim() === '') {
            // Empty line ends paragraph or list
            if (inParagraph) {
                html += `<p>${processInlineFormatting(paragraphContent.trim())}</p>`;
                paragraphContent = '';
                inParagraph = false;
            }
            if (inList) {
                html += listType === 'ul' ? `<ul>${listItems}</ul>` : `<ol>${listItems}</ol>`;
                listItems = '';
                inList = false;
            }
        } else {
            // Regular text - accumulate into paragraph
            if (inList) {
                html += listType === 'ul' ? `<ul>${listItems}</ul>` : `<ol>${listItems}</ol>`;
                listItems = '';
                inList = false;
            }
            if (inBlockquote) {
                html += `<blockquote>${processInlineFormatting(blockquoteContent.trim())}</blockquote>`;
                blockquoteContent = '';
                inBlockquote = false;
            }
            if (inParagraph) {
                paragraphContent += ' ' + line;
            } else {
                paragraphContent = line;
                inParagraph = true;
            }
        }
    }

    // Close any remaining paragraph, list, or blockquote
    if (inParagraph && paragraphContent.trim()) {
        html += `<p>${processInlineFormatting(paragraphContent.trim())}</p>`;
    }
    if (inList) {
        html += listType === 'ul' ? `<ul>${listItems}</ul>` : `<ol>${listItems}</ol>`;
    }
    if (inBlockquote) {
        html += `<blockquote>${processInlineFormatting(blockquoteContent.trim())}</blockquote>`;
    }

    return html;
}

// Function to process inline formatting (bold, italic)
function processInlineFormatting(text) {
    // Handle bold (**text** or __text__)
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/__(.+?)__/g, '<strong>$1</strong>');

    // Handle italic (*text* or _text_) - must come after bold to avoid conflicts
    text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
    text = text.replace(/_(.+?)_/g, '<em>$1</em>');

    return text;
}

// Function to import from Markdown
function importFromMarkdown() {
    markdownFileInput.click();
}

// Function to convert Markdown to blocks
function markdownToBlocks(markdown) {
    const lines = markdown.split('\n');
    const blocks = [];

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];

        // Calculate indentation level (2 spaces = 1 level)
        const leadingSpaces = line.match(/^ */)[0].length;
        const level = Math.floor(leadingSpaces / 2);
        const trimmedLine = line.trim();

        // Skip completely empty lines
        if (trimmedLine === '') {
            // Create empty text block for spacing
            blocks.push(createBlockElement('text', '', 0));
            continue;
        }

        // Check for headings
        if (trimmedLine.startsWith('### ')) {
            blocks.push(createBlockElement('heading3', trimmedLine.substring(4), 0));
        } else if (trimmedLine.startsWith('## ')) {
            blocks.push(createBlockElement('heading2', trimmedLine.substring(3), 0));
        } else if (trimmedLine.startsWith('# ')) {
            blocks.push(createBlockElement('heading1', trimmedLine.substring(2), 0));
        }
        // Check for block quote
        else if (trimmedLine.startsWith('> ')) {
            const content = trimmedLine.substring(2);
            blocks.push(createBlockElement('quote', content, 0));
        }
        // Check for bullet list (- or *)
        else if (trimmedLine.match(/^[-*]\s+/)) {
            const content = trimmedLine.replace(/^[-*]\s+/, '');
            blocks.push(createBlockElement('bullet', content, level));
        }
        // Check for numbered list
        else if (trimmedLine.match(/^\d+\.\s+/)) {
            const content = trimmedLine.replace(/^\d+\.\s+/, '');
            blocks.push(createBlockElement('numbered', content, level));
        }
        // Regular text
        else {
            blocks.push(createBlockElement('text', trimmedLine, 0));
        }
    }

    return blocks;
}

// Handle file selection
markdownFileInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        const markdownContent = e.target.result;
        const blocks = markdownToBlocks(markdownContent);

        // Clear editor and add blocks
        editor.innerHTML = '';
        blocks.forEach(block => {
            editor.appendChild(block);
        });

        // Update numbering for numbered lists
        updateNumberedBlocks();

        // Focus first block
        if (blocks.length > 0) {
            focusBlock(blocks[0]);
        }

        console.log('Markdown imported successfully');

        // Clear the input so the same file can be selected again
        markdownFileInput.value = '';
    };

    reader.readAsText(file);
});

// Function to get list of saved documents
function getSavedDocuments() {
    const docsJson = localStorage.getItem("savedDocuments");
    const docs = docsJson ? JSON.parse(docsJson) : [];

    // Sort by timestamp, most recent first
    docs.sort((a, b) => b.timestamp - a.timestamp);

    return docs;
}

// Function to save list of documents
function setSavedDocuments(docs) {
    localStorage.setItem("savedDocuments", JSON.stringify(docs));
}

// Function to render documents in save modal
function renderSaveDocuments(docs) {
    saveList.innerHTML = "";

    if (docs.length === 0) {
        saveList.innerHTML = '<div class="no-documents">No saved documents. Enter a name to create new.</div>';
        selectedSaveIndex = 0;
        return;
    }

    docs.forEach((doc, index) => {
        const docItem = document.createElement("div");
        docItem.className = `document-item ${index === selectedSaveIndex ? "selected" : ""}`;

        const docName = document.createElement("div");
        docName.className = "document-item-name";
        docName.textContent = doc.name;

        const docDate = document.createElement("div");
        docDate.className = "document-item-date";
        docDate.textContent = new Date(doc.timestamp).toLocaleString();

        docItem.appendChild(docName);
        docItem.appendChild(docDate);

        docItem.addEventListener("click", () => {
            saveNameInput.value = doc.name;
            saveNameInput.focus();
        });

        saveList.appendChild(docItem);
    });
}

// Function to filter documents in save modal
function filterSaveDocuments() {
    const searchTerm = saveNameInput.value.toLowerCase();
    const docs = getSavedDocuments();
    const filtered = docs.filter(doc =>
        doc.name.toLowerCase().includes(searchTerm)
    );
    selectedSaveIndex = 0;
    renderSaveDocuments(filtered);
}

// Function to save document with a name
function saveDocumentAs() {
    // Save current cursor position
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
        savedSelection = selection.getRangeAt(0).cloneRange();
    }

    const docs = getSavedDocuments();
    saveNameInput.value = "";
    selectedSaveIndex = 0;
    renderSaveDocuments(docs);
    saveModal.classList.remove("hidden");
    setTimeout(() => saveNameInput.focus(), 0);
}

// Function to generate a unique document ID
function generateDocumentId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 11);
}

// Function to update URL with document ID
function updateURL(docId) {
    const url = new URL(window.location);
    url.searchParams.set('id', docId);
    window.history.pushState({}, '', url);
}

// Function to clear URL parameter
function clearURL() {
    const url = new URL(window.location);
    url.searchParams.delete('id');
    window.history.pushState({}, '', url);
}

// Function to get document ID from URL
function getDocIdFromURL() {
    const params = new URLSearchParams(window.location.search);
    return params.get('id');
}

// Function to update page title with document name
function updatePageTitle(docName) {
    document.title = `thesis: ${docName}`;
}

// Function to clear page title
function clearPageTitle() {
    document.title = 'thesis';
}

// Function to perform the actual save
function performSave() {
    const docName = saveNameInput.value.trim();
    if (!docName) return;

    const content = editor.innerHTML;
    const docs = getSavedDocuments();

    let docId;
    // Check if document already exists
    const existingIndex = docs.findIndex(d => d.name === docName);
    if (existingIndex >= 0) {
        docs[existingIndex].timestamp = Date.now();
        docId = docs[existingIndex].id;
    } else {
        docId = generateDocumentId();
        docs.push({ id: docId, name: docName, timestamp: Date.now() });
    }

    // Store by both ID and name for backward compatibility
    localStorage.setItem(`doc_${docName}`, content);
    localStorage.setItem(`docById_${docId}`, JSON.stringify({ name: docName, content: content }));
    setSavedDocuments(docs);
    currentDocumentName = docName; // Track current document
    console.log(`Document "${docName}" saved with ID: ${docId}`);

    // Update URL with document ID
    updateURL(docId);

    // Update page title
    updatePageTitle(docName);

    saveModal.classList.add("hidden");
    editor.focus();

    // Restore cursor position
    if (savedSelection) {
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(savedSelection);
        savedSelection = null;
    }
}

// Function to quickly save to the current document
function quickSave() {
    if (!currentDocumentName) {
        // No current document - open save dialog
        saveDocumentAs();
        return;
    }

    const content = editor.innerHTML;
    const docs = getSavedDocuments();

    // Update timestamp for existing document
    const existingIndex = docs.findIndex(d => d.name === currentDocumentName);
    if (existingIndex >= 0) {
        docs[existingIndex].timestamp = Date.now();
        const docId = docs[existingIndex].id;

        // Store by both ID and name
        localStorage.setItem(`doc_${currentDocumentName}`, content);
        localStorage.setItem(`docById_${docId}`, JSON.stringify({ name: currentDocumentName, content: content }));
        setSavedDocuments(docs);

        // Update URL with document ID
        updateURL(docId);

        // Update page title
        updatePageTitle(currentDocumentName);

        console.log(`Document "${currentDocumentName}" saved with ID: ${docId}`);
    } else {
        localStorage.setItem(`doc_${currentDocumentName}`, content);
        setSavedDocuments(docs);
        console.log(`Document "${currentDocumentName}" saved`);
    }
}

// Function to load a saved document
async function loadDocument() {
    const docs = getSavedDocuments();

    if (docs.length === 0) {
        await showAlert("No saved documents found.");
        return;
    }

    loadSearch.value = "";
    selectedLoadIndex = 0;
    renderDocuments(docs);
    loadModal.classList.remove("hidden");
    setTimeout(() => loadSearch.focus(), 0);
}

// Function to render documents in load modal
function renderDocuments(docs) {
    loadList.innerHTML = "";

    if (docs.length === 0) {
        loadList.innerHTML = '<div class="no-documents">No documents found</div>';
        selectedLoadIndex = 0;
        return;
    }

    docs.forEach((doc, index) => {
        const docItem = document.createElement("div");
        docItem.className = `document-item ${index === selectedLoadIndex ? "selected" : ""}`;

        const docName = document.createElement("div");
        docName.className = "document-item-name";
        docName.textContent = doc.name;

        const docDate = document.createElement("div");
        docDate.className = "document-item-date";
        docDate.textContent = new Date(doc.timestamp).toLocaleString();

        docItem.appendChild(docName);
        docItem.appendChild(docDate);

        docItem.addEventListener("click", () => {
            loadDocumentByName(doc.name);
        });

        loadList.appendChild(docItem);
    });
}

// Function to load document by name
async function loadDocumentByName(docName) {
    const content = localStorage.getItem(`doc_${docName}`);
    if (content) {
        editor.innerHTML = content;
        currentDocumentName = docName; // Track current document

        // Update URL with document ID
        const docs = getSavedDocuments();
        const doc = docs.find(d => d.name === docName);
        if (doc && doc.id) {
            updateURL(doc.id);
        }

        // Update page title
        updatePageTitle(docName);

        console.log(`Document "${docName}" loaded`);
        loadModal.classList.add("hidden");
        editor.focus();
    } else {
        await showAlert(`Document "${docName}" not found.`);
    }
}

// Function to filter documents in load modal
function filterDocuments() {
    const searchTerm = loadSearch.value.toLowerCase();
    const docs = getSavedDocuments();
    const filtered = docs.filter(doc =>
        doc.name.toLowerCase().includes(searchTerm)
    );
    selectedLoadIndex = 0;
    renderDocuments(filtered);
}

// Function to show deleted document modal
function showDeletedDocModal() {
    deletedDocModal.classList.remove("hidden");
}

// Function to load document by ID from URL
async function loadDocumentById(docId) {
    const docData = localStorage.getItem(`docById_${docId}`);
    if (docData) {
        try {
            const { name, content } = JSON.parse(docData);
            // Verify the document still exists in the saved documents list
            const docs = getSavedDocuments();
            const doc = docs.find(d => d.id === docId);
            if (doc) {
                editor.innerHTML = content;
                currentDocumentName = name;

                // Update page title
                updatePageTitle(name);

                console.log(`Document "${name}" loaded from URL (ID: ${docId})`);
            } else {
                // Document was deleted
                showDeletedDocModal();
                clearURL();
            }
        } catch (e) {
            console.error("Error loading document:", e);
            showDeletedDocModal();
            clearURL();
        }
    } else {
        // Document not found
        showDeletedDocModal();
        clearURL();
    }
}

// Function to detect if a font is available
function isFontAvailable(fontName) {
    // Create a test element
    const testString = "mmmmmmmmmmlli";
    const testSize = "72px";
    const baseFonts = ["monospace", "sans-serif", "serif"];

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    // Test against base fonts
    const baseWidths = {};
    baseFonts.forEach(baseFont => {
        context.font = testSize + " " + baseFont;
        baseWidths[baseFont] = context.measureText(testString).width;
    });

    // Test the target font with each base font as fallback
    let detected = false;
    baseFonts.forEach(baseFont => {
        context.font = testSize + " '" + fontName + "'," + baseFont;
        const width = context.measureText(testString).width;
        if (width !== baseWidths[baseFont]) {
            detected = true;
        }
    });

    return detected;
}

// Function to get all fonts (built-in + custom)
function getAllFonts() {
    return [...customFonts, ...availableFonts];
}

// Function to load custom fonts from localStorage
function loadCustomFonts() {
    const saved = localStorage.getItem("customFonts");
    if (saved) {
        customFonts = JSON.parse(saved);
    }
}

// Function to save custom fonts to localStorage
function saveCustomFonts() {
    localStorage.setItem("customFonts", JSON.stringify(customFonts));
}

// Function to add a custom font
function addCustomFont(fontName) {
    if (!fontName) {
        return false;
    }

    // Check if already exists
    const allFonts = getAllFonts();
    if (allFonts.some(f => f.toLowerCase() === fontName.toLowerCase())) {
        return false;
    }

    // Test if font is available
    if (isFontAvailable(fontName)) {
        customFonts.unshift(fontName); // Add to beginning
        saveCustomFonts();
        return true;
    }

    return false;
}

// Function to open font modal
function openFontModal() {
    // Save current selection
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
        savedSelection = selection.getRangeAt(0).cloneRange();
    }

    selectedFontIndex = 0;
    fontSearch.value = "";
    renderFonts(getAllFonts());
    fontModal.classList.remove("hidden");
    setTimeout(() => fontSearch.focus(), 0);
}

// Function to close font modal and restore selection
function closeFontModal() {
    fontModal.classList.add("hidden");
    editor.focus();

    // Restore saved selection
    if (savedSelection) {
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(savedSelection);
        savedSelection = null;
    }
}

// Function to render fonts in the list
function renderFonts(fonts) {
    fontList.innerHTML = "";

    if (fonts.length === 0) {
        fontList.innerHTML = '<div class="no-fonts">No fonts found</div>';
        selectedFontIndex = 0;
        return;
    }

    const currentFont = localStorage.getItem("editorFont") || "Helvetica";

    fonts.forEach((font, index) => {
        const fontItem = document.createElement("div");
        fontItem.className = `font-item ${index === selectedFontIndex ? "selected" : ""} ${font === currentFont ? "current" : ""}`;
        fontItem.style.fontFamily = font;
        fontItem.textContent = font;

        fontItem.addEventListener("click", () => {
            applyFont(font);
        });

        fontList.appendChild(fontItem);
    });
}

// Function to filter fonts
function filterFonts() {
    const searchTerm = fontSearch.value.toLowerCase();
    const allFonts = getAllFonts();
    const filtered = allFonts.filter(font =>
        font.toLowerCase().includes(searchTerm)
    );
    selectedFontIndex = 0;
    renderFonts(filtered);
}

// Function to apply font to editor
function applyFont(font) {
    editor.style.fontFamily = font;
    localStorage.setItem("editorFont", font);
    closeFontModal();
}

// Function to load saved font
function loadFont() {
    const savedFont = localStorage.getItem("editorFont");
    if (savedFont) {
        editor.style.fontFamily = savedFont;
    }
}

// Function to extract headings from editor
function extractHeadings() {
    const headings = [];
    const headingBlocks = editor.querySelectorAll('.block-heading1, .block-heading2, .block-heading3');

    headingBlocks.forEach((block) => {
        const contentEl = block.querySelector('.block-content');
        const type = block.dataset.type; // heading1, heading2, or heading3

        headings.push({
            element: block,
            text: contentEl ? contentEl.textContent : '',
            level: type // heading1, heading2, or heading3
        });
    });

    return headings;
}

// Function to open heading modal
async function openHeadingModal() {
    const headings = extractHeadings();

    if (headings.length === 0) {
        await showAlert("No headings found in the document");
        return;
    }

    selectedHeadingIndex = 0;
    headingSearch.value = "";
    renderHeadings(headings);
    headingModal.classList.remove("hidden");
    setTimeout(() => headingSearch.focus(), 0);
}

// Function to render headings in the list
function renderHeadings(headings) {
    headingList.innerHTML = "";

    if (headings.length === 0) {
        headingList.innerHTML = '<div class="no-headings">No headings found</div>';
        selectedHeadingIndex = 0;
        return;
    }

    headings.forEach((heading, index) => {
        const headingItem = document.createElement("div");
        headingItem.className = `heading-item ${heading.level} ${index === selectedHeadingIndex ? "selected" : ""}`;
        headingItem.textContent = heading.text;

        headingItem.addEventListener("click", () => {
            jumpToHeading(heading.element);
        });

        headingList.appendChild(headingItem);
    });
}

// Function to filter headings
function filterHeadings() {
    const searchTerm = headingSearch.value.toLowerCase();
    const allHeadings = extractHeadings();
    const filtered = allHeadings.filter(heading =>
        heading.text.toLowerCase().includes(searchTerm)
    );
    selectedHeadingIndex = 0;
    renderHeadings(filtered);
}

// Function to jump to heading
function jumpToHeading(headingElement) {
    headingModal.classList.add("hidden");

    // Scroll the heading block into view
    headingElement.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Focus the block at the end of its content
    focusBlock(headingElement, true);
}

// Function to increase font size
function increaseFontSize() {
    currentFontSize = Math.min(currentFontSize + 2, 40); // Max 40px
    applyFontSize();
}

// Function to decrease font size
function decreaseFontSize() {
    currentFontSize = Math.max(currentFontSize - 2, 10); // Min 10px
    applyFontSize();
}

// Function to apply font size
function applyFontSize() {
    editor.style.fontSize = currentFontSize + 'px';
    localStorage.setItem("editorFontSize", currentFontSize);
}

// Function to load saved font size
function loadFontSize() {
    const savedSize = localStorage.getItem("editorFontSize");
    if (savedSize) {
        currentFontSize = parseInt(savedSize);
        editor.style.fontSize = currentFontSize + 'px';
    }
}

// Function to increase line height
function increaseLineHeight() {
    currentLineHeight = Math.min(currentLineHeight + 0.1, 2.5); // Max 2.5
    applyLineHeight();
}

// Function to decrease line height
function decreaseLineHeight() {
    currentLineHeight = Math.max(currentLineHeight - 0.1, 1.0); // Min 1.0
    applyLineHeight();
}

// Function to apply line height
function applyLineHeight() {
    editor.style.lineHeight = currentLineHeight;
    localStorage.setItem("editorLineHeight", currentLineHeight);
}

// Function to load saved line height
function loadLineHeight() {
    const savedLineHeight = localStorage.getItem("editorLineHeight");
    if (savedLineHeight) {
        currentLineHeight = parseFloat(savedLineHeight);
        editor.style.lineHeight = currentLineHeight;
    }
}

// Function to toggle typewriter mode
function toggleTypewriterMode() {
    typewriterMode = !typewriterMode;

    // Toggle class for styling
    document.body.classList.toggle("typewriter-mode", typewriterMode);

    // Save preference to localStorage
    localStorage.setItem("typewriterMode", typewriterMode);

    console.log(`Typewriter mode ${typewriterMode ? 'enabled' : 'disabled'}`);
}

// Function to toggle focus mode
function toggleFocusMode() {
    focusMode = !focusMode;

    // Toggle class for styling
    document.body.classList.toggle("focus-mode", focusMode);

    // Save preference to localStorage
    localStorage.setItem("focusMode", focusMode);

    if (focusMode) {
        updateFocusParagraph();
    } else {
        // Remove all active classes when disabling
        const allBlocks = editor.querySelectorAll('.block');
        allBlocks.forEach(el => el.classList.remove('focus-active'));
    }

    console.log(`Focus mode ${focusMode ? 'enabled' : 'disabled'}`);
}

// Function to update which block has focus
function updateFocusParagraph() {
    if (!focusMode) return;

    const currentBlock = getCurrentBlock();
    if (!currentBlock) return;

    // Remove active class from all blocks
    const allBlocks = editor.querySelectorAll('.block');
    allBlocks.forEach(el => el.classList.remove('focus-active'));

    // Add active class to current block
    currentBlock.classList.add('focus-active');
}

// Function to center current block in typewriter mode
function centerCurrentBlock() {
    if (!typewriterMode) return;

    const currentBlock = getCurrentBlock();
    if (currentBlock) {
        currentBlock.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

// Function to delete a saved document
async function deleteDocument() {
    const docs = getSavedDocuments();

    if (docs.length === 0) {
        await showAlert("No saved documents found.");
        return;
    }

    const docList = docs.map((d, i) => {
        const date = new Date(d.timestamp).toLocaleString();
        return `${i + 1}. ${d.name} (${date})`;
    }).join("\n");

    const choice = prompt(`Enter document number or name to delete:\n\n${docList}`);
    if (!choice) return;

    let docName;
    const num = parseInt(choice);
    if (!isNaN(num) && num > 0 && num <= docs.length) {
        docName = docs[num - 1].name;
    } else {
        docName = choice;
    }

    const confirmed = await showConfirm(`Delete document "${docName}"? This cannot be undone.`);
    if (confirmed) {
        localStorage.removeItem(`doc_${docName}`);
        const newDocs = docs.filter(d => d.name !== docName);
        setSavedDocuments(newDocs);
        console.log(`Document "${docName}" deleted`);
    }
}

// Function to show command modal
function showCommandModal() {
    commandModalOpen = true;
    commandModal.classList.remove("hidden");
    commandSearch.value = "";
    filterCommands(""); // Use filterCommands to apply MRU sorting
    selectedCommandIndex = 0;

    // Position modal near cursor - use setTimeout to ensure modal is visible first
    setTimeout(() => {
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);

            // Create a temporary span to get accurate cursor position
            const span = document.createElement('span');
            span.textContent = '\u200B'; // Zero-width space
            range.insertNode(span);
            const rect = span.getBoundingClientRect();
            span.parentNode.removeChild(span);

            let left = rect.left;
            let top = rect.bottom + 5;

            // Adjust if modal would go off-screen
            const modalWidth = 350; // matches CSS
            const modalHeight = commandModal.offsetHeight || 200; // Use actual height or estimate

            if (left + modalWidth > window.innerWidth) {
                left = window.innerWidth - modalWidth - 10;
            }

            // Use visualViewport if available to account for keyboard on mobile
            const viewportHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;

            if (top + modalHeight > viewportHeight) {
                // Position above the cursor instead
                top = rect.top - modalHeight - 5;
            }

            // Ensure we don't go negative
            left = Math.max(10, left);
            top = Math.max(10, top);

            // On mobile, ensure modal stays in visible viewport
            if (window.innerWidth < 768 && top > viewportHeight - 100) {
                top = Math.max(10, viewportHeight - modalHeight - 20);
            }

            commandModal.style.left = `${left}px`;
            commandModal.style.top = `${top}px`;
        }

        // Focus search input
        commandSearch.focus();
    }, 0);
}

// Function to hide command modal
function hideCommandModal() {
    commandModalOpen = false;
    commandModal.classList.add("hidden");

    // Clear the saved slash position
    // (No need to remove slash character since it was never inserted)
    slashPosition = null;

    // Clear multi-block selection when modal closes
    multiBlockSelection = [];
}

// Function to render commands in the list
function renderCommands(filteredCommands) {
    commandList.innerHTML = "";

    if (filteredCommands.length === 0) {
        commandList.innerHTML = '<div class="command-item no-results">No commands found</div>';
        return;
    }

    filteredCommands.forEach((command, index) => {
        const commandItem = document.createElement("div");
        commandItem.className = `command-item ${index === selectedCommandIndex ? "selected" : ""}`;

        const commandName = document.createElement("div");
        commandName.className = "command-name";
        // Use innerHTML for commands with HTML (like quick save), textContent for others
        if (command.isQuickSave) {
            commandName.innerHTML = command.name;
        } else {
            commandName.textContent = command.name;
        }

        const commandDesc = document.createElement("div");
        commandDesc.className = "command-description";
        commandDesc.textContent = command.description;

        commandItem.appendChild(commandName);
        commandItem.appendChild(commandDesc);

        commandItem.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            executeCommand(command);
        });

        commandList.appendChild(commandItem);
    });
}

// Function to execute a command
function executeCommand(command) {
    // Restore cursor to the saved position (no slash to remove since it was never inserted)
    if (slashPosition && slashPosition.node) {
        try {
            const selection = window.getSelection();
            const range = document.createRange();

            // Check if the node still exists in the document
            if (document.contains(slashPosition.node)) {
                // Restore cursor to where "/" key was pressed
                range.setStart(slashPosition.node, slashPosition.offset);
                range.collapse(true);
                selection.removeAllRanges();
                selection.addRange(range);
            }
        } catch (e) {
            console.error("Error restoring cursor position:", e);
        }
        slashPosition = null;
    }

    commandModalOpen = false;
    commandModal.classList.add("hidden");

    // Execute the command
    command.action();

    // Track command usage for MRU ordering
    try {
        const commandUsage = JSON.parse(localStorage.getItem('commandUsage') || '{}');
        commandUsage[command.name] = Date.now();
        localStorage.setItem('commandUsage', JSON.stringify(commandUsage));
    } catch (e) {
        console.error("Error tracking command usage:", e);
    }

    // Return focus to editor
    editor.focus();
}

// Function to filter commands based on search
function filterCommands(searchTerm) {
    // Get command usage history
    const commandUsage = JSON.parse(localStorage.getItem('commandUsage') || '{}');

    const filtered = commands.filter(cmd =>
        cmd.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        cmd.description.toLowerCase().includes(searchTerm.toLowerCase())
    );

    // Sort by most recently used (commands with no history appear last)
    filtered.sort((a, b) => {
        const aTime = commandUsage[a.name] || 0;
        const bTime = commandUsage[b.name] || 0;
        return bTime - aTime; // Most recent first
    });

    // Add quick save command at the top if there's a current document
    if (currentDocumentName) {
        const quickSaveCommand = {
            name: `Save to <em style="font-style: italic; opacity: 0.75;">${currentDocumentName}</em>`,
            description: "Quick save to current document (Cmd+S)",
            action: quickSave,
            isQuickSave: true
        };

        // Only show if it matches search or if search is empty
        if (!searchTerm ||
            `save to ${currentDocumentName}`.toLowerCase().includes(searchTerm.toLowerCase())) {
            filtered.unshift(quickSaveCommand);
        }
    }

    // Store filtered commands globally for keyboard navigation
    filteredCommandsList = filtered;

    selectedCommandIndex = 0;
    renderCommands(filtered);
}

// Event listeners
// Detect slash command and keyboard shortcuts
editor.addEventListener("keydown", (event) => {
    console.log('KEYDOWN EVENT:', event.key);

    // Handle Enter key - DOM-based
    if (event.key === 'Enter') {
        event.preventDefault();

        const currentBlock = getCurrentBlock();
        if (!currentBlock) return;

        const contentEl = currentBlock.querySelector('.block-content');
        if (!contentEl) return;

        const textContent = contentEl.textContent || '';
        const type = currentBlock.dataset.type;

        // Check if block is empty
        if (textContent.trim().length === 0) {
            // Empty bullet/numbered block -> convert to text
            if (type === 'bullet' || type === 'numbered') {
                currentBlock.dataset.type = 'text';
                currentBlock.className = 'block block-text';
                const marker = currentBlock.querySelector('.block-marker');
                if (marker) marker.remove();
                updateNumberedBlocks();
                focusBlock(currentBlock);
                return;
            }
        }

        // Split at cursor
        const selection = window.getSelection();
        const range = selection.getRangeAt(0);

        // Extract content after cursor
        const afterRange = range.cloneRange();
        afterRange.selectNodeContents(contentEl);
        afterRange.setStart(range.startContainer, range.startOffset);
        const afterContent = afterRange.toString();

        // Delete content after cursor from current block
        afterRange.deleteContents();
        if (contentEl.childNodes.length === 0) {
            contentEl.innerHTML = '<br>';
        }

        // Create new block with same type for bullets/numbers, text otherwise
        const newType = (type === 'bullet' || type === 'numbered') ? type : 'text';
        const currentLevel = parseInt(currentBlock.dataset.level) || 0;
        const newBlock = createBlockElement(newType, afterContent, currentLevel);

        // Insert after current
        currentBlock.parentNode.insertBefore(newBlock, currentBlock.nextSibling);

        // Update numbering if needed
        if (type === 'numbered' || newType === 'numbered') {
            updateNumberedBlocks();
        }

        // Focus new block
        focusBlock(newBlock);
        return;
    }

    // Handle Backspace - DOM-based
    if (event.key === 'Backspace') {
        const selection = window.getSelection();
        if (!selection.rangeCount) return;

        const range = selection.getRangeAt(0);

        // If there's a selection (not collapsed), let browser handle deletion
        if (!selection.isCollapsed) {
            return; // Let browser's natural deletion handle multi-block selection
        }

        const currentBlock = getCurrentBlock();
        if (!currentBlock) return;

        const contentEl = currentBlock.querySelector('.block-content');
        if (!contentEl) return;

        // Check if this is the only block - prevent deletion if empty
        const allBlocks = editor.querySelectorAll('.block');
        if (allBlocks.length === 1) {
            // Only one block - prevent backspace from deleting it entirely
            const isEmpty = !contentEl.textContent || contentEl.textContent.trim() === '';
            if (isEmpty) {
                event.preventDefault();
                return;
            }
        }

        // Check if cursor is at the very beginning
        const cursorOffset = range.startOffset;
        const node = range.startContainer;

        if (cursorOffset === 0 && node === contentEl.firstChild) {
            event.preventDefault();

            const previousBlock = currentBlock.previousElementSibling;
            if (!previousBlock) return; // Can't merge first block

            const prevContentEl = previousBlock.querySelector('.block-content');
            if (!prevContentEl) return;

            // Save cursor position (length of previous block's content)
            const previousLength = prevContentEl.textContent?.length || 0;

            // Append content from current block to previous block
            const currentContent = contentEl.textContent || '';
            if (prevContentEl.lastChild && prevContentEl.lastChild.nodeName === 'BR') {
                prevContentEl.removeChild(prevContentEl.lastChild);
            }

            // Add current content as text node
            if (currentContent.length > 0) {
                prevContentEl.appendChild(document.createTextNode(currentContent));
            }

            // Remove current block
            currentBlock.remove();

            // Update numbering
            updateNumberedBlocks();

            // Restore cursor at merge point using focusBlock's logic
            // Focus at the position where the merge happened
            requestAnimationFrame(() => {
                // Find or create a text node to place cursor
                let targetNode = null;
                let targetOffset = previousLength;

                // Look through child nodes to find the right text node and offset
                let currentOffset = 0;
                for (const child of prevContentEl.childNodes) {
                    if (child.nodeType === Node.TEXT_NODE) {
                        const nodeLength = child.textContent.length;
                        if (currentOffset + nodeLength >= previousLength) {
                            targetNode = child;
                            targetOffset = previousLength - currentOffset;
                            break;
                        }
                        currentOffset += nodeLength;
                    }
                }

                // If no text node found, create one
                if (!targetNode) {
                    targetNode = document.createTextNode('');
                    prevContentEl.appendChild(targetNode);
                    targetOffset = 0;
                }

                const newRange = document.createRange();
                newRange.setStart(targetNode, targetOffset);
                newRange.collapse(true);
                selection.removeAllRanges();
                selection.addRange(newRange);
            });
            return;
        }
    }

    // Handle Left Arrow at beginning - jump to previous block
    if (event.key === 'ArrowLeft') {
        const selection = window.getSelection();
        if (!selection.rangeCount) return;

        const range = selection.getRangeAt(0);

        // Only handle if no text is selected
        if (!selection.isCollapsed) return;

        const currentBlock = getCurrentBlock();
        if (!currentBlock) return;

        const contentEl = currentBlock.querySelector('.block-content');
        if (!contentEl) return;

        // Check if cursor is at the very beginning of content
        const cursorOffset = range.startOffset;
        const node = range.startContainer;

        // Check if we're at position 0 of the first text node, or at position 0 in the content element
        const isAtBeginning =
            (cursorOffset === 0 && node.nodeType === Node.TEXT_NODE && node === contentEl.firstChild) ||
            (cursorOffset === 0 && node === contentEl);

        if (isAtBeginning) {
            event.preventDefault();

            const previousBlock = currentBlock.previousElementSibling;
            if (!previousBlock) return; // No previous block

            // Jump to end of previous block
            focusBlock(previousBlock, true); // true = focus at end
            return;
        }
    }

    // Handle Tab - Indent block(s)
    if (event.key === 'Tab' && !event.shiftKey) {
        event.preventDefault();

        // Check for multi-block selection
        const selectedBlocks = getSelectedBlocks();
        const blocksToIndent = selectedBlocks.length > 1 ? selectedBlocks : [getCurrentBlock()];
        if (blocksToIndent[0] === null) return;

        blocksToIndent.forEach(block => {
            const currentLevel = parseInt(block.dataset.level) || 0;
            block.dataset.level = currentLevel + 1;
        });

        // Update numbering if any numbered blocks
        updateNumberedBlocks();

        // Trigger autosave
        autoSave();

        focusBlock(blocksToIndent[0], true);
        return;
    }

    // Handle Shift+Tab - Outdent block(s)
    if (event.key === 'Tab' && event.shiftKey) {
        event.preventDefault();

        // Check for multi-block selection
        const selectedBlocks = getSelectedBlocks();
        const blocksToOutdent = selectedBlocks.length > 1 ? selectedBlocks : [getCurrentBlock()];
        if (blocksToOutdent[0] === null) return;

        blocksToOutdent.forEach(block => {
            const currentLevel = parseInt(block.dataset.level) || 0;
            if (currentLevel > 0) {
                block.dataset.level = currentLevel - 1;
            }
        });

        // Update numbering if any numbered blocks
        updateNumberedBlocks();

        // Trigger autosave
        autoSave();

        focusBlock(blocksToOutdent[0], true);
        return;
    }

    // Handle ArrowUp - navigate within multi-line blocks or to previous block
    if (event.key === 'ArrowUp' && !event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
        const selection = window.getSelection();
        if (!selection.rangeCount) return;

        const currentBlock = getCurrentBlock();
        if (!currentBlock) return;

        const contentEl = currentBlock.querySelector('.block-content');
        if (!contentEl) return;

        const range = selection.getRangeAt(0);

        // Get current cursor position
        const rects = range.getClientRects();
        if (rects.length === 0) return;

        const currentRect = rects[0];
        const currentX = currentRect.left;
        const currentY = currentRect.top;

        // Calculate target position (one line up)
        const lineHeight = parseInt(window.getComputedStyle(contentEl).lineHeight) || 20;
        const targetY = currentY - lineHeight;

        // Try to find a position one line up
        const targetRange = document.caretRangeFromPoint(currentX, targetY);

        // Check if the target position is still within the same block-content
        if (targetRange && contentEl.contains(targetRange.startContainer)) {
            // We're still in the same block - move cursor there
            event.preventDefault();
            selection.removeAllRanges();
            selection.addRange(targetRange);
            return;
        }

        // We're at the first line - jump to previous block
        const previousBlock = currentBlock.previousElementSibling;
        if (previousBlock) {
            event.preventDefault();
            focusBlock(previousBlock, true); // Focus at end of previous block
            return;
        }
    }

    // Handle ArrowDown - navigate within multi-line blocks or to next block
    if (event.key === 'ArrowDown' && !event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
        const selection = window.getSelection();
        if (!selection.rangeCount) return;

        const currentBlock = getCurrentBlock();
        if (!currentBlock) return;

        const contentEl = currentBlock.querySelector('.block-content');
        if (!contentEl) return;

        const range = selection.getRangeAt(0);

        // Get current cursor position
        const rects = range.getClientRects();
        if (rects.length === 0) return;

        const currentRect = rects[0];
        const currentX = currentRect.left;
        const currentY = currentRect.bottom; // Use bottom for down navigation

        // Calculate target position (one line down)
        const lineHeight = parseInt(window.getComputedStyle(contentEl).lineHeight) || 20;
        const targetY = currentY + lineHeight;

        // Try to find a position one line down
        const targetRange = document.caretRangeFromPoint(currentX, targetY);

        // Check if the target position is still within the same block-content
        if (targetRange && contentEl.contains(targetRange.startContainer)) {
            // We're still in the same block - move cursor there
            event.preventDefault();
            selection.removeAllRanges();
            selection.addRange(targetRange);
            return;
        }

        // We're at the last line - jump to next block
        const nextBlock = currentBlock.nextElementSibling;
        if (nextBlock) {
            event.preventDefault();
            focusBlock(nextBlock, false); // Focus at beginning of next block
            return;
        }
    }

    // Prevent backspace, delete, and cursor movement in typewriter mode
    if (typewriterMode) {
        // Prevent backspace and delete
        if (event.key === 'Backspace' || event.key === 'Delete') {
            event.preventDefault();
            return;
        }

        // Prevent arrow keys (cursor movement)
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' ||
            event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
            return;
        }

        // Prevent Home/End keys
        if (event.key === 'Home' || event.key === 'End') {
            event.preventDefault();
            return;
        }

        // Prevent Page Up/Down
        if (event.key === 'PageUp' || event.key === 'PageDown') {
            event.preventDefault();
            return;
        }

        // Prevent Enter (creating new lines/blocks)
        if (event.key === 'Enter') {
            event.preventDefault();
            return;
        }
    }

    // Move multiple selected blocks up with Option+Up (Mac) or Alt+Up (PC)
    if (event.altKey && !event.shiftKey && event.key === 'ArrowUp') {
        event.preventDefault();

        // Check multiBlockSelection first (from "/" command), then getSelectedBlocks (drag selection)
        let blocksToMove;
        if (multiBlockSelection.length > 0) {
            blocksToMove = multiBlockSelection;
        } else {
            const selectedBlocks = getSelectedBlocks();
            blocksToMove = selectedBlocks.length > 1 ? selectedBlocks : [getCurrentBlock()];
        }
        if (blocksToMove[0] === null || blocksToMove.length === 0) return;

        // Can't move if first block doesn't have a previous sibling
        const firstBlock = blocksToMove[0];
        if (!firstBlock.previousElementSibling) return;

        // Save reference to where we're inserting (before the previous block)
        const targetBlock = firstBlock.previousElementSibling;

        // Move all blocks as a group by inserting each before the target
        for (let i = 0; i < blocksToMove.length; i++) {
            editor.insertBefore(blocksToMove[i], targetBlock);
        }

        updateNumberedBlocks();
        autoSave();

        // Restore selection/focus
        if (blocksToMove.length === 1) {
            focusBlock(blocksToMove[0]);
        }
        return;
    }

    // Move multiple selected blocks down with Option+Down (Mac) or Alt+Down (PC)
    if (event.altKey && !event.shiftKey && event.key === 'ArrowDown') {
        event.preventDefault();

        // Check multiBlockSelection first (from "/" command), then getSelectedBlocks (drag selection)
        let blocksToMove;
        if (multiBlockSelection.length > 0) {
            blocksToMove = multiBlockSelection;
        } else {
            const selectedBlocks = getSelectedBlocks();
            blocksToMove = selectedBlocks.length > 1 ? selectedBlocks : [getCurrentBlock()];
        }
        if (blocksToMove[0] === null || blocksToMove.length === 0) return;

        // Can't move if last block doesn't have a next sibling
        const lastBlock = blocksToMove[blocksToMove.length - 1];
        if (!lastBlock.nextElementSibling) return;

        // Save reference to the block after which we want to insert
        const nextBlock = lastBlock.nextElementSibling;
        const targetPosition = nextBlock.nextElementSibling; // null if nextBlock is last

        // Move all blocks as a group by inserting each after the next block
        // Insert in reverse order to maintain their relative order
        for (let i = blocksToMove.length - 1; i >= 0; i--) {
            if (targetPosition) {
                editor.insertBefore(blocksToMove[i], targetPosition);
            } else {
                editor.appendChild(blocksToMove[i]);
            }
        }

        updateNumberedBlocks();
        autoSave();

        // Restore selection/focus
        if (blocksToMove.length === 1) {
            focusBlock(blocksToMove[0]);
        }
        return;
    }

    // Move single line up with Alt+Shift+Up (PC) or Option+Shift+Up (Mac) - DOM-based
    if (event.altKey && event.shiftKey && event.key === 'ArrowUp') {
        event.preventDefault();

        const currentBlock = getCurrentBlock();
        if (!currentBlock || !currentBlock.previousElementSibling) return;

        const previousBlock = currentBlock.previousElementSibling;
        editor.insertBefore(currentBlock, previousBlock);

        updateNumberedBlocks();
        autoSave();
        focusBlock(currentBlock);
        return;
    }

    // Move single line down with Alt+Shift+Down (PC) or Option+Shift+Down (Mac) - DOM-based
    if (event.altKey && event.shiftKey && event.key === 'ArrowDown') {
        event.preventDefault();

        const currentBlock = getCurrentBlock();
        if (!currentBlock || !currentBlock.nextElementSibling) return;

        const nextBlock = currentBlock.nextElementSibling;
        editor.insertBefore(nextBlock, currentBlock);

        updateNumberedBlocks();
        autoSave();
        focusBlock(currentBlock);
        return;
    }

    // Prevent text selection shortcuts in typewriter mode
    if (typewriterMode) {
        // Prevent Ctrl/Cmd+A (select all)
        if ((event.ctrlKey || event.metaKey) && event.key === 'a') {
            event.preventDefault();
            return;
        }
        // Prevent shift+arrow keys (text selection)
        if (event.shiftKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight' ||
            event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
            event.preventDefault();
            return;
        }
        // Prevent Ctrl/Cmd+Shift+Home/End (select to start/end)
        if ((event.ctrlKey || event.metaKey) && event.shiftKey &&
            (event.key === 'Home' || event.key === 'End')) {
            event.preventDefault();
            return;
        }
    }

    // Handle Cmd+D to delete block(s)
    if ((event.ctrlKey || event.metaKey) && event.key === 'd') {
        event.preventDefault();
        deleteBlocks();
        return;
    }

    // Handle keyboard shortcuts for formatting
    if ((event.ctrlKey || event.metaKey) && event.key === 'b') {
        event.preventDefault();
        applyFormatting('bold');
        return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key === 'i') {
        event.preventDefault();
        applyFormatting('italic');
        return;
    }

    // Handle font size shortcuts
    if ((event.ctrlKey || event.metaKey) && (event.key === '=' || event.key === '+')) {
        event.preventDefault();
        increaseFontSize();
        return;
    }

    if ((event.ctrlKey || event.metaKey) && (event.key === '-' || event.key === '_')) {
        event.preventDefault();
        decreaseFontSize();
        return;
    }

    // Handle line height shortcuts
    if ((event.ctrlKey || event.metaKey) && event.key === ']') {
        event.preventDefault();
        increaseLineHeight();
        return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key === '[') {
        event.preventDefault();
        decreaseLineHeight();
        return;
    }

    // Handle Tab for list indentation
    if (event.key === 'Tab') {
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            let node = range.startContainer;

            // If text node, get parent element
            if (node.nodeType === Node.TEXT_NODE) {
                node = node.parentElement;
            }

            // Check if we're in a list item
            const listItem = node.closest('li');
            if (listItem) {
                event.preventDefault();

                if (event.shiftKey) {
                    // Shift+Tab: Outdent (decrease indent)
                    document.execCommand('outdent', false, null);
                } else {
                    // Tab: Indent (incr4ease indent)
                    document.execCommand('indent', false, null);
                }
                return;
            }
        }
    }

    // Handle quick save shortcut (Cmd+S / Ctrl+S)
    if ((event.metaKey || event.ctrlKey) && event.key === 's') {
        event.preventDefault();
        quickSave();
        return;
    }

    // Handle fullscreen shortcut (F11)
    if (event.key === 'F11') {
        event.preventDefault();
        toggleFullscreen();
        return;
    }

    // Handle slash to open command modal (but not if intro modal or deleted doc modal is open)
    if (event.key === "/" && !commandModalOpen && introModal.classList.contains("hidden") && deletedDocModal.classList.contains("hidden")) {
        event.preventDefault();

        // Check if multiple blocks are selected
        const selectedBlocks = getSelectedBlocks();
        if (selectedBlocks.length > 1) {
            // Multi-block selection - store blocks and open modal without inserting "/"
            multiBlockSelection = selectedBlocks;

            // Save the selection range to restore later
            const selection = window.getSelection();
            if (selection.rangeCount > 0) {
                savedSelection = selection.getRangeAt(0).cloneRange();
            }

            slashPosition = null; // No slash position for multi-block
            showCommandModal();
            return;
        }

        // Single block - save cursor position WITHOUT inserting "/" yet
        const selection = window.getSelection();
        let range;

        if (selection.rangeCount > 0) {
            range = selection.getRangeAt(0);
        } else {
            // Create a range if none exists
            range = document.createRange();
            range.selectNodeContents(editor);
            range.collapse(false);
        }

        // Store the cursor position where "/" should be inserted if user presses space
        slashPosition = {
            node: range.startContainer,
            offset: range.startOffset
        };

        showCommandModal();
        return;
    }

    // Close modal on space (insert the slash now)
    if (event.key === " " && commandModalOpen) {
        event.preventDefault();

        // Insert the "/" character at the saved position
        if (slashPosition && slashPosition.node) {
            const selection = window.getSelection();
            const range = document.createRange();

            // Insert "/" at the saved position
            const textNode = document.createTextNode("/");
            range.setStart(slashPosition.node, slashPosition.offset);
            range.collapse(true);
            range.insertNode(textNode);

            // Position cursor after the slash
            range.setStartAfter(textNode);
            range.collapse(true);
            selection.removeAllRanges();
            selection.addRange(range);
        }

        hideCommandModal();
        editor.focus();
        return;
    }

    // Close modal on / (slash) and remove the slash
    if (event.key === "/" && commandModalOpen) {
        event.preventDefault();
        hideCommandModal();
        editor.focus();
        return;
    }

    // Navigate commands with arrow keys
    if (commandModalOpen && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
        event.preventDefault();
        const commandItems = commandList.querySelectorAll(".command-item:not(.no-results)");

        if (event.key === "ArrowDown") {
            selectedCommandIndex = (selectedCommandIndex + 1) % commandItems.length;
        } else {
            selectedCommandIndex = (selectedCommandIndex - 1 + commandItems.length) % commandItems.length;
        }

        commandItems.forEach((item, index) => {
            item.classList.toggle("selected", index === selectedCommandIndex);
        });

        // Scroll selected item into view
        commandItems[selectedCommandIndex]?.scrollIntoView({ block: "nearest" });
    }

    // Execute command on Enter
    if (commandModalOpen && event.key === "Enter") {
        event.preventDefault();
        // Use the globally stored filtered commands list
        if (filteredCommandsList[selectedCommandIndex]) {
            executeCommand(filteredCommandsList[selectedCommandIndex]);
        }
    }
});

// Search input event listener
commandSearch.addEventListener("input", (event) => {
    filterCommands(event.target.value);
});

// Handle keyboard navigation in command search
commandSearch.addEventListener("keydown", (event) => {
    // Close modal on space (insert the slash now)
    if (event.key === " " && commandSearch.value === "") {
        event.preventDefault();

        // Insert the "/" character at the saved position
        if (slashPosition && slashPosition.node) {
            const selection = window.getSelection();
            const range = document.createRange();

            // Insert "/" at the saved position
            const textNode = document.createTextNode("/");
            range.setStart(slashPosition.node, slashPosition.offset);
            range.collapse(true);
            range.insertNode(textNode);

            // Position cursor after the slash
            range.setStartAfter(textNode);
            range.collapse(true);
            selection.removeAllRanges();
            selection.addRange(range);
        }

        hideCommandModal();
        editor.focus();
    }

    // Close modal on / (slash) and remove the slash
    if (event.key === "/") {
        event.preventDefault();
        hideCommandModal();
        editor.focus();
    }

    // Navigate commands with arrow keys
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const commandItems = commandList.querySelectorAll(".command-item:not(.no-results)");

        if (event.key === "ArrowDown") {
            selectedCommandIndex = (selectedCommandIndex + 1) % commandItems.length;
        } else {
            selectedCommandIndex = (selectedCommandIndex - 1 + commandItems.length) % commandItems.length;
        }

        commandItems.forEach((item, index) => {
            item.classList.toggle("selected", index === selectedCommandIndex);
        });

        // Scroll selected item into view
        commandItems[selectedCommandIndex]?.scrollIntoView({ block: "nearest" });
    }

    // Execute command on Enter
    if (event.key === "Enter") {
        event.preventDefault();
        // Use the globally stored filtered commands list
        if (filteredCommandsList[selectedCommandIndex]) {
            executeCommand(filteredCommandsList[selectedCommandIndex]);
        }
    }
});

document.addEventListener("click", (event) => {
    // Close command modal if clicking outside
    if (commandModalOpen && !commandModal.contains(event.target)) {
        hideCommandModal();
    }
});

// Load dark mode preference on page load
if (localStorage.getItem("darkMode") === "true") {
    document.body.classList.add("dark-mode");
}

// Load canvas mode preference on page load
if (localStorage.getItem("canvasMode") === "true") {
    document.body.classList.add("canvas-mode");
}

// Load typewriter mode preference on page load
if (localStorage.getItem("typewriterMode") === "true") {
    typewriterMode = true;
    document.body.classList.add("typewriter-mode");
}

// Load focus mode preference on page load
if (localStorage.getItem("focusMode") === "true") {
    focusMode = true;
    document.body.classList.add("focus-mode");
}

// Prevent text selection with mouse in typewriter mode
editor.addEventListener("selectstart", (event) => {
    if (typewriterMode) {
        event.preventDefault();
    }
});

// Prevent context menu in typewriter mode
editor.addEventListener("contextmenu", (event) => {
    if (typewriterMode) {
        event.preventDefault();
    }
});

// Handle fullscreen changes
document.addEventListener("fullscreenchange", () => {
    if (document.fullscreenElement) {
        console.log("Entered fullscreen mode");
    } else {
        console.log("Exited fullscreen mode");
    }
});

// Auto-convert markdown-style list syntax - DOM-BASED VERSION
editor.addEventListener("beforeinput", (event) => {
    // Skip if composing (e.g., using IME for Asian languages)
    if (event.isComposing) return;

    if (event.inputType === 'insertText' && event.data === ' ') {
        const currentBlock = getCurrentBlock();
        if (!currentBlock) return;

        const contentEl = currentBlock.querySelector('.block-content');
        if (!contentEl) return;

        const textContent = contentEl.textContent || '';

        // Check for block quote pattern: ">" at start (before space is added)
        if (textContent.startsWith('>')) {
            event.preventDefault();

            // Get the text after the prefix (skip ">" and any spaces)
            let remainingText = textContent.slice(1).trimStart();

            currentBlock.dataset.type = 'quote';
            currentBlock.className = 'block block-quote';
            contentEl.textContent = remainingText;

            // Focus at end of remaining text
            focusBlock(currentBlock, true);
            return;
        }

        // Check for bullet pattern: "-" or "*" at start (before space is added)
        if (textContent.startsWith('-') || textContent.startsWith('*')) {
            event.preventDefault();

            // Get the text after the prefix (skip "-" and any spaces)
            let remainingText = textContent.slice(1).trimStart();

            currentBlock.dataset.type = 'bullet';
            currentBlock.className = 'block block-bullet';
            contentEl.textContent = remainingText;

            // Add marker (non-editable)
            const marker = document.createElement('span');
            marker.className = 'block-marker bullet-marker';
            marker.contentEditable = 'false';
            marker.textContent = '•';
            currentBlock.insertBefore(marker, contentEl);

            // Focus at end of remaining text
            focusBlock(currentBlock, true);
            return;
        }

        // Check for numbered pattern: "1." through "99." at start (before space is added)
        const numberedMatch = textContent.match(/^(\d{1,2})\./);
        if (numberedMatch) {
            event.preventDefault();

            // Get the text after the prefix (skip "1." and any spaces)
            const prefixLength = numberedMatch[0].length;
            let remainingText = textContent.slice(prefixLength).trimStart();

            currentBlock.dataset.type = 'numbered';
            currentBlock.className = 'block block-numbered';
            contentEl.textContent = remainingText;

            // Add marker (non-editable)
            const marker = document.createElement('span');
            marker.className = 'block-marker number-marker';
            marker.contentEditable = 'false';
            marker.textContent = '1.';
            currentBlock.insertBefore(marker, contentEl);

            updateNumberedBlocks();

            // Focus at end of remaining text
            focusBlock(currentBlock, true);
            return;
        }
    }
});

// Safety check: prevent typing outside of block-content areas
editor.addEventListener("beforeinput", (event) => {
    // Skip if it's not an insert operation
    if (!event.inputType.startsWith('insert') && !event.inputType.startsWith('delete')) {
        return;
    }

    const selection = window.getSelection();
    if (!selection.rangeCount) return;

    const range = selection.getRangeAt(0);
    let node = range.startContainer;

    // Walk up to find if we're inside a block-content
    let insideBlockContent = false;
    let element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;

    while (element && element !== editor) {
        if (element.classList && element.classList.contains('block-content')) {
            insideBlockContent = true;
            break;
        }
        element = element.parentElement;
    }

    // If not inside block-content, prevent the input and create/focus a block
    if (!insideBlockContent) {
        event.preventDefault();

        const firstBlock = editor.querySelector('.block');
        if (firstBlock) {
            focusBlock(firstBlock);
        } else {
            // No blocks exist - create one
            const newBlock = createBlockElement('text', '');
            editor.appendChild(newBlock);
            focusBlock(newBlock);
        }
    }
});

// Update word count when editor content changes
editor.addEventListener("input", (event) => {
    // Check for "xxxx" trigger to strikethrough last word
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const node = range.startContainer;

        if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent;
            const cursorPos = range.startOffset;

            // Check if the last 4 characters before cursor are "xxxx"
            if (cursorPos >= 4 && text.substring(cursorPos - 4, cursorPos) === 'xxxx') {
                // Move cursor to before "xxxx"
                const beforeXxxxRange = document.createRange();
                beforeXxxxRange.setStart(node, cursorPos - 4);
                beforeXxxxRange.collapse(true);
                selection.removeAllRanges();
                selection.addRange(beforeXxxxRange);

                // Strikethrough the last word (which is before "xxxx")
                strikethroughLastWord();

                // Now remove the "xxxx"
                // Search through all text nodes in the block to find and remove it
                const currentBlock = getCurrentBlock();
                if (currentBlock) {
                    const contentEl = currentBlock.querySelector('.block-content');
                    if (contentEl) {
                        // Walk through all text nodes to find "xxxx"
                        const walker = document.createTreeWalker(
                            contentEl,
                            NodeFilter.SHOW_TEXT,
                            null,
                            false
                        );

                        let textNode;
                        while (textNode = walker.nextNode()) {
                            const text = textNode.textContent;
                            const xxxxIndex = text.indexOf('xxxx');

                            if (xxxxIndex !== -1) {
                                // Found it! Remove "xxxx"
                                const before = text.substring(0, xxxxIndex);
                                const after = text.substring(xxxxIndex + 4);
                                textNode.textContent = before + after;
                                break;
                            }
                        }
                    }
                }

                // Return early to prevent other processing
                return;
            }
        }
    }

    // Clean up any <p> tags the browser might have inserted
    const unwantedPs = editor.querySelectorAll(':scope > p');
    unwantedPs.forEach(p => {
        // Move content out of the <p> tag
        const content = p.innerHTML;
        if (content.trim()) {
            // Create a proper block with the content
            const block = createBlockElement('text', content);
            p.replaceWith(block);
        } else {
            // Empty <p>, just remove it
            p.remove();
        }
    });

    if (wordCountVisible) {
        updateWordCount();
    }
    autoSave(); // Auto-save content
    updateFocusParagraph();
});

// Handle copy event to create proper HTML lists
editor.addEventListener("copy", (event) => {
    const selection = window.getSelection();
    if (!selection.rangeCount) return;

    // Get all blocks in the editor
    const allBlocks = Array.from(editor.querySelectorAll('.block'));

    // Find which blocks are in the selection
    const range = selection.getRangeAt(0);
    const selectedBlocks = allBlocks.filter(block => {
        return range.intersectsNode(block);
    });

    if (selectedBlocks.length === 0) return;

    // Build proper nested list HTML
    let htmlParts = [];
    let plainTextParts = [];
    let listStack = []; // Stack to track open lists: [{type: 'ul', level: 0}, ...]

    selectedBlocks.forEach((block) => {
        const contentEl = block.querySelector('.block-content');
        if (!contentEl) return;

        const blockType = block.dataset.type;
        const level = parseInt(block.dataset.level) || 0;
        const content = contentEl.textContent || '';

        // For plain text, just add content with newlines
        plainTextParts.push(content);

        // Handle HTML based on block type
        if (blockType === 'bullet' || blockType === 'numbered') {
            const listType = blockType === 'bullet' ? 'ul' : 'ol';

            // Close lists if we've decreased level
            while (listStack.length > 0 && listStack[listStack.length - 1].level >= level) {
                const closed = listStack.pop();
                htmlParts.push('</li>');
                htmlParts.push(`</${closed.type}>`);
            }

            // Open new nested list if level increased
            if (listStack.length === 0 || listStack[listStack.length - 1].level < level) {
                htmlParts.push(`<${listType}>`);
                listStack.push({ type: listType, level: level });
            } else if (listStack.length > 0) {
                // Same level, close previous item
                htmlParts.push('</li>');
            }

            // Add list item
            htmlParts.push(`<li>${content}`);
        } else {
            // Text block - close all lists and add as paragraph
            while (listStack.length > 0) {
                const closed = listStack.pop();
                htmlParts.push('</li>');
                htmlParts.push(`</${closed.type}>`);
            }
            htmlParts.push(`<p>${content}</p>`);
        }
    });

    // Close any remaining open lists
    while (listStack.length > 0) {
        const closed = listStack.pop();
        htmlParts.push('</li>');
        htmlParts.push(`</${closed.type}>`);
    }

    const htmlText = htmlParts.join('');
    const plainText = plainTextParts.join('\n');

    // Set clipboard data
    event.preventDefault();
    event.clipboardData.setData('text/plain', plainText);
    event.clipboardData.setData('text/html', htmlText);
});

// Handle paste event to convert HTML lists back to blocks
editor.addEventListener("paste", (event) => {
    const clipboardData = event.clipboardData;
    if (!clipboardData) return;

    const html = clipboardData.getData('text/html');
    const text = clipboardData.getData('text/plain');

    // Check if pasted content contains lists
    if (html && (html.includes('<ul') || html.includes('<ol'))) {
        event.preventDefault();

        // Create a temporary container to parse the HTML
        const temp = document.createElement('div');
        temp.innerHTML = html;

        // Convert lists to blocks
        const blocks = [];
        const convertNode = (node, level = 0) => {
            if (node.nodeName === 'UL' || node.nodeName === 'OL') {
                const type = node.nodeName === 'UL' ? 'bullet' : 'numbered';
                Array.from(node.children).forEach(child => {
                    if (child.nodeName === 'LI') {
                        // Get text content (not including nested lists)
                        let text = '';
                        Array.from(child.childNodes).forEach(n => {
                            if (n.nodeType === Node.TEXT_NODE) {
                                text += n.textContent;
                            }
                        });

                        if (text.trim()) {
                            blocks.push(createBlockElement(type, text.trim(), level));
                        }

                        // Process nested lists
                        Array.from(child.children).forEach(nested => {
                            if (nested.nodeName === 'UL' || nested.nodeName === 'OL') {
                                convertNode(nested, level + 1);
                            }
                        });
                    }
                });
            } else if (node.nodeName === 'P' || node.nodeName === 'DIV') {
                const text = node.textContent.trim();
                if (text) {
                    blocks.push(createBlockElement('text', text, 0));
                }
            }
        };

        Array.from(temp.children).forEach(child => convertNode(child));

        // Insert blocks at cursor position
        const currentBlock = getCurrentBlock();
        if (currentBlock && blocks.length > 0) {
            blocks.forEach(block => {
                currentBlock.parentNode.insertBefore(block, currentBlock.nextSibling);
            });
            // Update numbering and focus last inserted block
            updateNumberedBlocks();
            focusBlock(blocks[blocks.length - 1], true);
        }
    }
});

// Handle clicks on editor - create first block if empty
editor.addEventListener("click", (event) => {
    // Prevent cursor movement in typewriter mode
    if (typewriterMode) {
        event.preventDefault();
        return;
    }

    const blocks = editor.querySelectorAll('.block');
    if (blocks.length === 0) {
        // No blocks - create first block and focus it
        const firstBlock = createBlockElement('text', '');
        editor.appendChild(firstBlock);
        focusBlock(firstBlock);
    }
    updateFocusParagraph();
    centerCurrentBlock();
});

// Prevent mousedown in typewriter mode to block cursor positioning
editor.addEventListener("mousedown", (event) => {
    if (typewriterMode) {
        event.preventDefault();
        return;
    }
});

editor.addEventListener("keyup", () => {
    updateFocusParagraph();
    centerCurrentBlock();
});

// Update word count when selection changes (for selected text counting)
document.addEventListener("selectionchange", () => {
    if (wordCountVisible) {
        updateWordCount();
    }
});

// Migrate existing documents to add IDs if they don't have them
function migrateDocumentsWithIds() {
    const docs = getSavedDocuments();
    let migrated = false;

    docs.forEach(doc => {
        if (!doc.id) {
            // Generate ID for existing document
            doc.id = generateDocumentId();
            migrated = true;

            // Create the docById entry
            const content = localStorage.getItem(`doc_${doc.name}`);
            if (content) {
                localStorage.setItem(`docById_${doc.id}`, JSON.stringify({ name: doc.name, content: content }));
            }
        }
    });

    if (migrated) {
        setSavedDocuments(docs);
        console.log("Migrated existing documents to include IDs");
    }
}

// Load saved content, font, font size, line height, and custom fonts on page load
loadContent();

// Migrate existing documents
migrateDocumentsWithIds();

// Check for document ID in URL and load it
const docIdFromURL = getDocIdFromURL();
if (docIdFromURL) {
    setTimeout(() => {
        loadDocumentById(docIdFromURL);
    }, 50);
}

// Show intro modal on first visit
if (!localStorage.getItem("hasSeenIntro")) {
    setTimeout(() => {
        showIntro();
        localStorage.setItem("hasSeenIntro", "true");
    }, 100);
}

// Fallback: ensure at least one block exists after loading
setTimeout(() => {
    if (editor.children.length === 0 || !editor.querySelector('.block')) {
        console.log("No blocks found after load - creating initial block");
        const firstBlock = createBlockElement('text', '');
        editor.appendChild(firstBlock);
        focusBlock(firstBlock);
    }
}, 100);

loadFont();
loadFontSize();
loadLineHeight();
loadCustomFonts();

// On mobile, tapping blank canvas (not text) opens command menu
function handleMobileCanvasTap(event) {
    // Only on mobile
    if (window.innerWidth >= 768) return;

    // Get the target from event
    const target = event.target || (event.changedTouches && event.changedTouches[0]?.target);
    if (!target) return;

    // Check if clicking on text content (block-content or anything inside it)
    const clickedBlockContent = target.classList?.contains('block-content') ||
                                target.closest('.block-content');

    // If clicking on text content, don't open menu (user is trying to edit)
    if (clickedBlockContent) return;

    // Don't open if a modal is already open
    if (!commandModal.classList.contains("hidden")) return;
    if (!introModal.classList.contains("hidden")) return;

    // Open command modal centered on screen
    commandModalOpen = true;
    commandModal.classList.remove("hidden");
    commandSearch.value = "";
    filterCommands("");
    selectedCommandIndex = 0;

    setTimeout(() => {
        // Position modal for mobile (top of screen to avoid keyboard)
        const modalWidth = 350;
        const left = Math.max(10, (window.innerWidth - modalWidth) / 2);

        // Use visualViewport if available to account for keyboard
        const viewportHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
        const top = Math.max(10, Math.min(60, viewportHeight * 0.1));

        commandModal.style.left = `${left}px`;
        commandModal.style.top = `${top}px`;

        // Don't auto-focus to avoid keyboard popup on mobile
        commandSearch.blur();
    }, 0);
}

// Add both touch and click listeners for mobile compatibility
editor.addEventListener("click", handleMobileCanvasTap);
editor.addEventListener("touchend", handleMobileCanvasTap);

// Handle keyboard appearing/disappearing on mobile
if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
        // If command modal is open, reposition it when keyboard appears/disappears
        if (!commandModal.classList.contains("hidden")) {
            const viewportHeight = window.visualViewport.height;
            const modalHeight = commandModal.offsetHeight || 200;

            // Position modal in visible area
            let top = parseInt(commandModal.style.top) || 10;
            if (top + modalHeight > viewportHeight) {
                top = Math.max(10, viewportHeight - modalHeight - 20);
                commandModal.style.top = `${top}px`;
            }
        }
    });
}

// Save modal event listeners
saveConfirmButton.addEventListener("click", performSave);

saveNameInput.addEventListener("input", filterSaveDocuments);

saveCancelButton.addEventListener("click", () => {
    saveModal.classList.add("hidden");
    editor.focus();

    // Restore cursor position
    if (savedSelection) {
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(savedSelection);
        savedSelection = null;
    }
});

saveNameInput.addEventListener("keydown", (event) => {
    // Navigate documents with arrow keys
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const docItems = saveList.querySelectorAll(".document-item");

        if (docItems.length > 0) {
            if (event.key === "ArrowDown") {
                selectedSaveIndex = (selectedSaveIndex + 1) % docItems.length;
            } else {
                selectedSaveIndex = (selectedSaveIndex - 1 + docItems.length) % docItems.length;
            }

            // Re-render with new selection
            const searchTerm = saveNameInput.value.toLowerCase();
            const docs = getSavedDocuments();
            const filtered = docs.filter(doc =>
                doc.name.toLowerCase().includes(searchTerm)
            );
            renderSaveDocuments(filtered);

            // Scroll selected item into view
            const selectedItem = saveList.querySelectorAll(".document-item")[selectedSaveIndex];
            selectedItem?.scrollIntoView({ block: "nearest" });
        }
    } else if (event.key === "Enter") {
        event.preventDefault();
        const docItems = saveList.querySelectorAll(".document-item");

        // If there are documents and one is selected, populate input with it
        if (docItems.length > 0 && saveNameInput.value.trim() === "") {
            const searchTerm = saveNameInput.value.toLowerCase();
            const docs = getSavedDocuments();
            const filtered = docs.filter(doc =>
                doc.name.toLowerCase().includes(searchTerm)
            );
            if (filtered[selectedSaveIndex]) {
                saveNameInput.value = filtered[selectedSaveIndex].name;
            }
        } else {
            // Otherwise, save
            performSave();
        }
    } else if (event.key === "/") {
        event.preventDefault();
        saveModal.classList.add("hidden");
        editor.focus();

        // Restore cursor position
        if (savedSelection) {
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(savedSelection);
            savedSelection = null;
        }
    }
});

// Load modal event listeners
loadCancelButton.addEventListener("click", () => {
    loadModal.classList.add("hidden");
    editor.focus();
});

loadSearch.addEventListener("input", filterDocuments);

// Deleted document modal event listener
deletedDocOkButton.addEventListener("click", () => {
    deletedDocModal.classList.add("hidden");
    editor.focus();
});

loadSearch.addEventListener("keydown", (event) => {
    // Navigate documents with arrow keys
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const docItems = loadList.querySelectorAll(".document-item");

        if (docItems.length > 0) {
            if (event.key === "ArrowDown") {
                selectedLoadIndex = (selectedLoadIndex + 1) % docItems.length;
            } else {
                selectedLoadIndex = (selectedLoadIndex - 1 + docItems.length) % docItems.length;
            }

            // Re-render with new selection
            const searchTerm = loadSearch.value.toLowerCase();
            const docs = getSavedDocuments();
            const filtered = docs.filter(doc =>
                doc.name.toLowerCase().includes(searchTerm)
            );
            renderDocuments(filtered);

            // Scroll selected item into view
            const selectedItem = loadList.querySelectorAll(".document-item")[selectedLoadIndex];
            selectedItem?.scrollIntoView({ block: "nearest" });
        }
    } else if (event.key === "/") {
        event.preventDefault();
        loadModal.classList.add("hidden");
        editor.focus();
    } else if (event.key === "Enter") {
        event.preventDefault();
        // Get filtered documents
        const searchTerm = loadSearch.value.toLowerCase();
        const docs = getSavedDocuments();
        const filtered = docs.filter(doc =>
            doc.name.toLowerCase().includes(searchTerm)
        );

        // Load the selected document, or the only one if there's just one
        if (filtered.length === 1) {
            loadDocumentByName(filtered[0].name);
        } else if (filtered.length > 0 && filtered[selectedLoadIndex]) {
            loadDocumentByName(filtered[selectedLoadIndex].name);
        }
    }
});

// Close modals when clicking outside
saveModal.addEventListener("click", (event) => {
    if (event.target === saveModal) {
        saveModal.classList.add("hidden");
        editor.focus();

        // Restore cursor position
        if (savedSelection) {
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(savedSelection);
            savedSelection = null;
        }
    }
});

loadModal.addEventListener("click", (event) => {
    if (event.target === loadModal) {
        loadModal.classList.add("hidden");
        editor.focus();
    }
});

// Font modal event listeners
fontCancelButton.addEventListener("click", () => {
    closeFontModal();
});

fontSearch.addEventListener("input", filterFonts);

fontSearch.addEventListener("keydown", (event) => {
    // Navigate fonts with arrow keys
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const fontItems = fontList.querySelectorAll(".font-item");

        if (fontItems.length > 0) {
            if (event.key === "ArrowDown") {
                selectedFontIndex = (selectedFontIndex + 1) % fontItems.length;
            } else {
                selectedFontIndex = (selectedFontIndex - 1 + fontItems.length) % fontItems.length;
            }

            // Update highlighting by removing 'selected' from all and adding to current
            fontItems.forEach((item, index) => {
                if (index === selectedFontIndex) {
                    item.classList.add('selected');
                } else {
                    item.classList.remove('selected');
                }
            });

            // Scroll selected item into view
            fontItems[selectedFontIndex]?.scrollIntoView({ block: "nearest" });
        }
    } else if (event.key === "/") {
        event.preventDefault();
        closeFontModal();
    } else if (event.key === "Enter") {
        event.preventDefault();
        // Get filtered fonts
        const searchTerm = fontSearch.value.trim();
        const allFonts = getAllFonts();
        const filtered = allFonts.filter(font =>
            font.toLowerCase().includes(searchTerm.toLowerCase())
        );

        if (filtered.length > 0) {
            // Apply the selected font from filtered list
            applyFont(filtered[selectedFontIndex]);
        } else if (searchTerm) {
            // No matches - try to add as custom font
            if (addCustomFont(searchTerm)) {
                // Font was added successfully, apply it
                applyFont(searchTerm);
            } else {
                // Font not available
                showAlert(`Font "${searchTerm}" is not available on your system`);
            }
        }
    }
});

// Close font modal when clicking outside
fontModal.addEventListener("click", (event) => {
    if (event.target === fontModal) {
        closeFontModal();
    }
});

// Heading modal event listeners
headingCancelButton.addEventListener("click", () => {
    headingModal.classList.add("hidden");
    editor.focus();
});

headingSearch.addEventListener("input", filterHeadings);

headingSearch.addEventListener("keydown", (event) => {
    // Navigate headings with arrow keys
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const headingItems = headingList.querySelectorAll(".heading-item");

        if (headingItems.length > 0) {
            if (event.key === "ArrowDown") {
                selectedHeadingIndex = (selectedHeadingIndex + 1) % headingItems.length;
            } else {
                selectedHeadingIndex = (selectedHeadingIndex - 1 + headingItems.length) % headingItems.length;
            }

            // Re-render with new selection
            const searchTerm = headingSearch.value.toLowerCase();
            const allHeadings = extractHeadings();
            const filtered = allHeadings.filter(heading =>
                heading.text.toLowerCase().includes(searchTerm)
            );
            renderHeadings(filtered);

            // Scroll selected item into view
            const selectedItem = headingList.querySelectorAll(".heading-item")[selectedHeadingIndex];
            selectedItem?.scrollIntoView({ block: "nearest" });
        }
    } else if (event.key === "/") {
        event.preventDefault();
        headingModal.classList.add("hidden");
        editor.focus();
    } else if (event.key === "Enter") {
        event.preventDefault();
        // Get filtered headings
        const searchTerm = headingSearch.value.trim();
        const allHeadings = extractHeadings();
        const filtered = allHeadings.filter(heading =>
            heading.text.toLowerCase().includes(searchTerm.toLowerCase())
        );

        if (filtered.length > 0 && filtered[selectedHeadingIndex]) {
            // Jump to the selected heading from filtered list
            jumpToHeading(filtered[selectedHeadingIndex].element);
        }
    }
});

// Close heading modal when clicking outside
headingModal.addEventListener("click", (event) => {
    if (event.target === headingModal) {
        headingModal.classList.add("hidden");
        editor.focus();
    }
});

// Intro modal event listeners
// Close intro modal when clicking outside
introModal.addEventListener("click", (event) => {
    if (event.target === introModal) {
        introModal.classList.add("hidden");
        editor.focus();
    }
});

// Close deleted document modal when clicking outside
deletedDocModal.addEventListener("click", (event) => {
    if (event.target === deletedDocModal) {
        deletedDocModal.classList.add("hidden");
        editor.focus();
    }
});

// Allow closing intro modal with Escape or /
document.addEventListener("keydown", (event) => {
    if (!introModal.classList.contains("hidden")) {
        if (event.key === "Escape" || event.key === "/") {
            event.preventDefault();
            introModal.classList.add("hidden");
            editor.focus();
        }
    }
});

// Allow closing deleted document modal with Escape or /
document.addEventListener("keydown", (event) => {
    if (!deletedDocModal.classList.contains("hidden")) {
        if (event.key === "Escape" || event.key === "/") {
            event.preventDefault();
            deletedDocModal.classList.add("hidden");
            editor.focus();
        }
    }
});