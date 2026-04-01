// Reusable modal system — eliminates duplicated open/close/keyboard/selection patterns

import state from './state.js';
import { saveSelection, restoreSelection } from './utils.js';
import { getEditor } from './blocks.js';

// Generic modal helper: opens a modal, traps focus, restores selection on close
export function openModal(modalEl, focusEl = null) {
    state.savedSelection = saveSelection();
    modalEl.classList.remove('hidden');

    // Trap focus inside modal
    modalEl._trapFocus = (e) => {
        if (e.key === 'Tab') {
            const focusable = modalEl.querySelectorAll(
                'input, button, [tabindex]:not([tabindex="-1"])'
            );
            if (focusable.length === 0) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        }
    };
    modalEl.addEventListener('keydown', modalEl._trapFocus);

    if (focusEl) {
        setTimeout(() => focusEl.focus(), 0);
    }
}

export function closeModal(modalEl) {
    modalEl.classList.add('hidden');

    // Remove focus trap
    if (modalEl._trapFocus) {
        modalEl.removeEventListener('keydown', modalEl._trapFocus);
        delete modalEl._trapFocus;
    }

    // Restore selection
    if (state.savedSelection) {
        if (!restoreSelection(state.savedSelection)) {
            getEditor().focus();
        }
        state.savedSelection = null;
    } else {
        getEditor().focus();
    }
}

// Attach "close on click outside" to an overlay modal
export function closeOnClickOutside(modalEl, contentSelector = '.modal-content') {
    modalEl.addEventListener('click', (event) => {
        if (event.target === modalEl) {
            closeModal(modalEl);
        }
    });
}

// Attach keyboard nav (ArrowUp/Down, Enter, Escape, /) to a modal's search input
export function attachModalKeyboardNav(searchInput, modalEl, {
    getItems,           // () => NodeList of selectable items
    getSelectedIndex,   // () => number
    setSelectedIndex,   // (i) => void
    onEnter,            // (index) => void
    onFilter,           // () => void  (re-render after index change)
    closeOnSlash = true,
}) {
    searchInput.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const items = getItems();
            if (items.length === 0) return;

            const current = getSelectedIndex();
            const next = event.key === 'ArrowDown'
                ? (current + 1) % items.length
                : (current - 1 + items.length) % items.length;
            setSelectedIndex(next);

            if (onFilter) onFilter();

            const selectedItem = getItems()[next];
            selectedItem?.scrollIntoView({ block: 'nearest' });
        } else if (event.key === 'Enter') {
            event.preventDefault();
            onEnter(getSelectedIndex());
        } else if (closeOnSlash && event.key === '/') {
            event.preventDefault();
            closeModal(modalEl);
        } else if (event.key === 'Escape') {
            event.preventDefault();
            closeModal(modalEl);
        }
    });
}

// Promise-based alert dialog
export function showAlert(message) {
    return new Promise((resolve) => {
        const dialogModal = document.getElementById('dialog-modal');
        const dialogMessage = document.getElementById('dialog-message');
        const dialogConfirmButton = document.getElementById('dialog-confirm-button');
        const dialogCancelButton = document.getElementById('dialog-cancel-button');

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
        setTimeout(() => dialogConfirmButton.focus(), 0);
    });
}

// Promise-based confirm dialog
export function showConfirm(message) {
    return new Promise((resolve) => {
        const dialogModal = document.getElementById('dialog-modal');
        const dialogMessage = document.getElementById('dialog-message');
        const dialogConfirmButton = document.getElementById('dialog-confirm-button');
        const dialogCancelButton = document.getElementById('dialog-cancel-button');

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
        setTimeout(() => dialogConfirmButton.focus(), 0);
    });
}
