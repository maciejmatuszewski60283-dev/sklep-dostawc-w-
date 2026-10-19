'use strict';
const { marked } = require('marked');
const sanitizeHtml = require('sanitize-html');

marked.setOptions({ gfm: true, breaks: true });

const ALLOWED = {
  allowedTags: ['p', 'br', 'strong', 'em', 'b', 'i', 'u', 's', 'ul', 'ol', 'li', 'h2', 'h3', 'h4', 'blockquote',
    'code', 'pre', 'a', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'mark'],
  allowedAttributes: { a: ['href', 'title', 'rel', 'target'] },
  allowedSchemes: ['https', 'http', 'mailto'],
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer nofollow', target: '_blank' }),
    h1: 'h2',
  },
};

/** Markdown -> bezpieczny HTML (tylko dozwolone tagi, bez skryptów i atrybutów zdarzeń). */
function render(md) {
  const html = marked.parse(String(md || ''));
  const clean = sanitizeHtml(html, ALLOWED);
  // Wyróżnij miejsca do uzupełnienia w dokumentach
  return clean.replace(/\[DO UZUPEŁNIENIA[^\]]*\]/g, (m) => `<mark>${m}</mark>`);
}

module.exports = { render };
