#!/usr/bin/env node
// The comment-block format lives in two implementations — thesis's
// js/comments.js (browser ESM) and margin.js (node CJS) — that must stay
// byte-compatible: what one writes, the other reads back identically. This
// test pins that agreement. Run it after touching either parser:
//
//   node margin/format-test.js

'use strict';

const assert = require('assert');
const margin = require('./margin.js');

const CASES = {
    comments: [
        {
            id: 'c_1', block: 2,
            quote: 'the claim at issue', prefix: 'establishes ',
            body: 'Do we have a source for this?',
            author: 'claude', created: '2026-07-21T08:10:00.000Z',
            resolved: false,
            replies: [{ author: 'me', body: 'Adding one — see the 1972 report.', created: '2026-07-22T04:46:06.058Z' }],
        },
        {
            id: 'c_2', block: -1, quote: '', prefix: '',
            body: 'A document note with "quotes" and — dashes.',
            author: 'me', created: '2026-07-22T05:00:00.000Z',
            resolved: true, replies: [],
            fix: { before: 'teh', after: 'the' },
        },
    ],
    margin: { invited: true, brief: 'Challenge my logic, leave my style alone.' },
    prose: '# Title\n\nA paragraph that establishes the claim at issue.\n\n- a list item\n> a quote',
};

(async () => {
    const thesis = await import('../js/comments.js');
    const state = (await import('../js/state.js')).default;

    // ── 1. Both serializers emit identical bytes for the same document ──
    state.comments = CASES.comments;
    state.commentsRaw = null;
    state.margin = CASES.margin;
    state.marginRaw = null;
    const thesisBytes = CASES.prose + thesis.getCommentBlock() + thesis.getMarginBlock();
    const marginBytes = margin.serializeFile(CASES.prose, CASES.comments, CASES.margin, null);
    assert.strictEqual(thesisBytes, marginBytes, 'serialized bytes differ between thesis and margin');

    // ── 2. Both parsers read those bytes back to the same document ──
    for (const [name, split] of [['thesis', thesis.splitComments], ['margin', margin.splitComments]]) {
        const parsed = split(thesisBytes);
        assert.strictEqual(parsed.prose, CASES.prose, `${name}: prose changed in round-trip`);
        assert.deepStrictEqual(parsed.comments, CASES.comments, `${name}: comments changed in round-trip`);
        assert.deepStrictEqual(parsed.margin, CASES.margin, `${name}: margin changed in round-trip`);
        assert.strictEqual(parsed.raw, null, `${name}: clean block flagged as damaged`);
        assert.strictEqual(parsed.marginRaw, null, `${name}: clean margin flagged as damaged`);
    }

    // ── 3. Salvage: a displaced --> inside the block still parses ──
    const displaced = CASES.prose + '\n\n<!-- thesis:comments v1\n'
        + JSON.stringify(CASES.comments, null, 2).replace(/\n\]$/, '\n-->\n]') + '\n-->\n';
    for (const [name, split] of [['thesis', thesis.splitComments], ['margin', margin.splitComments]]) {
        const parsed = split(displaced);
        assert.deepStrictEqual(parsed.comments, CASES.comments, `${name}: salvage failed on displaced -->`);
    }

    // ── 4. Damage: an unparseable block is carried raw, prose untouched ──
    const damaged = CASES.prose + '\n\n<!-- thesis:comments v1\n[ not json at all\n-->\n';
    for (const [name, split] of [['thesis', thesis.splitComments], ['margin', margin.splitComments]]) {
        const parsed = split(damaged);
        assert.strictEqual(parsed.prose, CASES.prose, `${name}: damage leaked into prose`);
        assert.deepStrictEqual(parsed.comments, [], `${name}: damaged block yielded comments`);
        assert.ok(parsed.raw && parsed.raw.startsWith('<!-- thesis:comments v1'), `${name}: raw bytes not preserved`);
    }
    // thesis re-appends the damaged bytes verbatim
    state.comments = [];
    state.commentsRaw = thesis.splitComments(damaged).raw;
    state.margin = null;
    state.marginRaw = null;
    assert.ok((CASES.prose + thesis.getCommentBlock()).includes('[ not json at all'), 'thesis: damaged bytes not re-appended');

    // ── 5. A file with no blocks at all ──
    for (const [name, split] of [['thesis', thesis.splitComments], ['margin', margin.splitComments]]) {
        const parsed = split('just prose\n');
        assert.strictEqual(parsed.prose, 'just prose', `${name}: bare prose mangled`);
        assert.deepStrictEqual(parsed.comments, [], `${name}: comments invented`);
        assert.strictEqual(parsed.margin, null, `${name}: margin invented`);
    }

    // ── 6. Margin-only file (invited, no comments yet) ──
    state.comments = [];
    state.commentsRaw = null;
    state.margin = { invited: true };
    state.marginRaw = null;
    const invitedOnly = 'prose' + thesis.getCommentBlock() + thesis.getMarginBlock();
    assert.strictEqual(invitedOnly, margin.serializeFile('prose', [], { invited: true }, null), 'margin-only serialization differs');
    for (const [name, split] of [['thesis', thesis.splitComments], ['margin', margin.splitComments]]) {
        const parsed = split(invitedOnly);
        assert.deepStrictEqual(parsed.margin, { invited: true }, `${name}: invitation lost`);
        assert.strictEqual(parsed.prose, 'prose', `${name}: prose mangled by margin block`);
    }

    console.log('format-test: all checks passed — thesis and margin agree on the comment format');
})().catch((e) => { console.error(e.message); process.exit(1); });
