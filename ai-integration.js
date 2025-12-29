/**
 * Integration code for AI Suggestions
 * Add this to the end of your script.js file
 */

// Initialize AI Suggestions
const aiSuggestions = new AISuggestions();

// Add commands for AI
const aiCommands = [
    {
        name: "Load AI Model",
        description: "Download and initialize AI writing assistant (~2.3GB, one-time)",
        action: async () => {
            if (aiSuggestions.isReady()) {
                showStatus("AI model already loaded");
                return;
            }
            
            showStatus("Loading AI model...");
            const success = await aiSuggestions.initialize((progress) => {
                const percent = (progress.progress * 100).toFixed(0);
                showStatus(`Loading AI model: ${percent}% - ${progress.text || ''}`);
            });
            
            if (success) {
                showStatus("AI model loaded successfully! Enable with 'Toggle AI Suggestions'");
            } else {
                showStatus("Failed to load AI model");
            }
        }
    },
    {
        name: "Toggle AI Suggestions",
        description: "Enable/disable inline AI writing suggestions",
        action: () => {
            if (!aiSuggestions.isReady()) {
                showStatus("Please load AI model first (command: 'Load AI Model')");
                return;
            }
            
            const isEnabled = aiSuggestions.toggle();
            showStatus(isEnabled ? "AI suggestions enabled" : "AI suggestions disabled");
        }
    }
];

// Add AI commands to the main commands array
// Insert this at the appropriate place in your commands array:
// commands.push(...aiCommands);

// Hook into editor events
let originalEditorInput = null;

function setupAIIntegration() {
    // Listen for input events
    editor.addEventListener('input', (e) => {
        if (aiSuggestions.isEnabled && aiSuggestions.isReady()) {
            aiSuggestions.onTyping();
        }
    });

    // Handle Tab key for accepting suggestions
    const originalKeydown = editor.onkeydown;
    editor.addEventListener('keydown', (e) => {
        // Tab key - accept suggestion
        if (e.key === 'Tab' && aiSuggestions.currentSuggestion) {
            e.preventDefault();
            const accepted = aiSuggestions.acceptSuggestion();
            if (accepted) {
                // Trigger input event so other handlers know content changed
                editor.dispatchEvent(new Event('input', { bubbles: true }));
            }
            return;
        }

        // Any other key - clear suggestion
        if (aiSuggestions.currentSuggestion) {
            // Don't clear on arrow keys, they're just navigation
            if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
                aiSuggestions.clearSuggestion();
            }
        }
    });
}

// Status display helper (if you don't have one)
function showStatus(message) {
    // You can implement this however you want
    // Could be a toast notification, status bar, etc.
    console.log('[AI]', message);
    
    // Simple implementation: temporary message in bottom-left
    let statusEl = document.getElementById('ai-status');
    if (!statusEl) {
        statusEl = document.createElement('div');
        statusEl.id = 'ai-status';
        statusEl.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 20px;
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 12px 20px;
            border-radius: 6px;
            font-size: 14px;
            z-index: 3000;
            transition: opacity 0.3s ease;
        `;
        document.body.appendChild(statusEl);
    }
    
    statusEl.textContent = message;
    statusEl.style.opacity = '1';
    
    // Auto-hide after 3 seconds
    setTimeout(() => {
        statusEl.style.opacity = '0';
    }, 3000);
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupAIIntegration);
} else {
    setupAIIntegration();
}

// Add CSS for AI suggestions (add to your styles.css)
const aiStyles = `
.ai-suggestion {
    color: #999;
    font-style: italic;
    user-select: none;
    pointer-events: none;
}

body.dark-mode .ai-suggestion {
    color: #666;
}
`;

// Inject styles
const styleSheet = document.createElement('style');
styleSheet.textContent = aiStyles;
document.head.appendChild(styleSheet);
