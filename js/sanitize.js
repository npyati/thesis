// Lightweight HTML sanitizer for content loaded from localStorage / external sources.
// Allows only safe formatting tags — strips scripts, event handlers, and dangerous elements.

const ALLOWED_TAGS = new Set([
    'div', 'span', 'p', 'br', 'b', 'strong', 'i', 'em', 'strike', 's',
    'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'blockquote',
]);

const ALLOWED_ATTRS = new Set([
    'class', 'contenteditable', 'data-type', 'data-level', 'data-spacer',
    'id', 'style',
]);

// Attributes that are always stripped (event handlers, dangerous)
const DANGEROUS_ATTR_PREFIX = /^on/i;

export function sanitizeHTML(html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    sanitizeNode(template.content);
    return template.innerHTML;
}

function sanitizeNode(node) {
    const toRemove = [];

    for (const child of node.childNodes) {
        if (child.nodeType === Node.ELEMENT_NODE) {
            const tag = child.tagName.toLowerCase();

            if (!ALLOWED_TAGS.has(tag)) {
                // Keep text content but remove the element
                toRemove.push(child);
                continue;
            }

            // Strip dangerous attributes
            const attrs = Array.from(child.attributes);
            for (const attr of attrs) {
                if (DANGEROUS_ATTR_PREFIX.test(attr.name) || !ALLOWED_ATTRS.has(attr.name)) {
                    child.removeAttribute(attr.name);
                }
            }

            // Strip dangerous CSS in style attribute
            if (child.hasAttribute('style')) {
                const style = child.getAttribute('style');
                if (/expression|url\s*\(|javascript:/i.test(style)) {
                    child.removeAttribute('style');
                }
            }

            // Recurse into children
            sanitizeNode(child);
        }
    }

    // Replace disallowed elements with their text content
    for (const el of toRemove) {
        const text = document.createTextNode(el.textContent);
        node.replaceChild(text, el);
    }
}
