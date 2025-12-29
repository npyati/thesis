/**
 * AI Suggestions Module
 * Provides inline text suggestions using WebLLM (Phi-3.5 Mini)
 */

class AISuggestions {
    constructor() {
        this.engine = null;
        this.isLoading = false;
        this.isEnabled = false;
        this.typingTimer = null;
        this.pauseDelay = 2000; // 2 seconds after typing stops
        this.currentSuggestion = null;
        this.suggestionElement = null;
        this.isGenerating = false;
    }

    /**
     * Initialize the AI model (only called once, cached by browser)
     */
    async initialize(onProgress) {
        if (this.engine) return true;
        if (this.isLoading) return false;

        this.isLoading = true;

        try {
            // Import WebLLM dynamically
            const { CreateMLCEngine } = await import('https://esm.run/@mlc-ai/web-llm');
            
            this.engine = await CreateMLCEngine("Phi-3.5-mini-instruct-q4f16_1-MLC", {
                initProgressCallback: (progress) => {
                    if (onProgress) {
                        onProgress(progress);
                    }
                }
            });

            this.isLoading = false;
            return true;
        } catch (error) {
            console.error('Failed to initialize AI:', error);
            this.isLoading = false;
            return false;
        }
    }

    /**
     * Enable AI suggestions
     */
    enable() {
        this.isEnabled = true;
    }

    /**
     * Disable AI suggestions
     */
    disable() {
        this.isEnabled = false;
        this.clearSuggestion();
    }

    /**
     * Toggle AI suggestions on/off
     */
    toggle() {
        if (this.isEnabled) {
            this.disable();
        } else {
            this.enable();
        }
        return this.isEnabled;
    }

    /**
     * Called when user types - resets the timer
     */
    onTyping() {
        if (!this.isEnabled || !this.engine) return;

        // Clear existing timer and suggestion
        clearTimeout(this.typingTimer);
        this.clearSuggestion();

        // Set new timer
        this.typingTimer = setTimeout(() => {
            this.generateSuggestion();
        }, this.pauseDelay);
    }

    /**
     * Get context for AI (current paragraph or last few sentences)
     */
    getContext(editor) {
        const selection = window.getSelection();
        if (!selection.rangeCount) return '';

        // Get current block
        let node = selection.getRangeAt(0).startContainer;
        let element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
        
        // Find the block-content element
        while (element && !element.classList?.contains('block-content')) {
            element = element.parentElement;
            if (element === editor) break;
        }

        if (!element || !element.classList?.contains('block-content')) {
            // Fallback: get all text from editor
            return editor.innerText.trim().slice(-500); // Last 500 chars
        }

        // Get text from current block and previous blocks for context
        const block = element.closest('.block');
        const allBlocks = Array.from(editor.querySelectorAll('.block'));
        const currentIndex = allBlocks.indexOf(block);
        
        // Get current block and up to 2 previous blocks for context
        const contextBlocks = allBlocks.slice(Math.max(0, currentIndex - 2), currentIndex + 1);
        const contextText = contextBlocks
            .map(b => b.querySelector('.block-content')?.innerText || '')
            .join('\n')
            .trim();

        return contextText;
    }

    /**
     * Generate a suggestion based on current context
     */
    async generateSuggestion() {
        if (!this.engine || this.isGenerating) return;

        const editor = document.getElementById('editor');
        const context = this.getContext(editor);
        
        if (!context || context.length < 10) return; // Need some context

        this.isGenerating = true;

        try {
            const response = await this.engine.chat.completions.create({
                messages: [
                    { 
                        role: "system", 
                        content: "You are a writing assistant. Given the context, suggest only the next 1-2 sentences to continue the text naturally. Be concise and match the writing style. Output only the suggested text, nothing else."
                    },
                    { 
                        role: "user", 
                        content: `Continue this text naturally:\n\n${context}`
                    }
                ],
                temperature: 0.7,
                max_tokens: 50, // Keep suggestions short
                stream: false
            });

            const suggestion = response.choices[0].message.content.trim();
            
            // Only show if suggestion is reasonable
            if (suggestion && suggestion.length > 0 && suggestion.length < 300) {
                this.showSuggestion(suggestion);
            }

        } catch (error) {
            console.error('Error generating suggestion:', error);
        } finally {
            this.isGenerating = false;
        }
    }

    /**
     * Display the suggestion as grey text after cursor
     */
    showSuggestion(text) {
        const selection = window.getSelection();
        if (!selection.rangeCount) return;

        // Create or reuse suggestion element
        if (!this.suggestionElement) {
            this.suggestionElement = document.createElement('span');
            this.suggestionElement.className = 'ai-suggestion';
            this.suggestionElement.style.color = '#999';
            this.suggestionElement.style.fontStyle = 'italic';
            this.suggestionElement.contentEditable = 'false';
            this.suggestionElement.style.userSelect = 'none';
        }

        this.suggestionElement.textContent = text;
        this.currentSuggestion = text;

        // Insert at cursor position
        const range = selection.getRangeAt(0);
        range.collapse(false); // Collapse to end
        
        try {
            range.insertNode(this.suggestionElement);
            
            // Move cursor after suggestion (but don't select it)
            range.setStartAfter(this.suggestionElement);
            range.collapse(true);
            selection.removeAllRanges();
            selection.addRange(range);
        } catch (error) {
            console.error('Error showing suggestion:', error);
        }
    }

    /**
     * Clear the current suggestion
     */
    clearSuggestion() {
        if (this.suggestionElement && this.suggestionElement.parentNode) {
            this.suggestionElement.remove();
        }
        this.currentSuggestion = null;
    }

    /**
     * Accept the current suggestion (called when user presses Tab)
     */
    acceptSuggestion() {
        if (!this.currentSuggestion || !this.suggestionElement) return false;

        // Replace suggestion span with actual text
        const text = this.currentSuggestion;
        const textNode = document.createTextNode(text);
        
        if (this.suggestionElement.parentNode) {
            this.suggestionElement.parentNode.replaceChild(textNode, this.suggestionElement);
            
            // Move cursor to end of inserted text
            const selection = window.getSelection();
            const range = document.createRange();
            range.setStartAfter(textNode);
            range.collapse(true);
            selection.removeAllRanges();
            selection.addRange(range);
        }

        this.currentSuggestion = null;
        this.suggestionElement = null;
        
        return true; // Suggestion was accepted
    }

    /**
     * Check if model is ready
     */
    isReady() {
        return this.engine !== null && !this.isLoading;
    }

    /**
     * Get current status
     */
    getStatus() {
        if (this.isLoading) return 'loading';
        if (!this.engine) return 'not-loaded';
        if (!this.isEnabled) return 'disabled';
        return 'ready';
    }
}

// Export as global or module
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AISuggestions;
} else {
    window.AISuggestions = AISuggestions;
}
