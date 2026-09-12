#!/usr/bin/env node
// margin — a reader in the margin.
//
// Watches a folder of .md files. When an *invited* file settles with enough
// new writing, or the writer addresses Claude in a comment thread, it runs a
// reading pass (Claude CLI, headless, your existing login) and writes any
// notes back into the file's thesis:comments block. thesis shows them the
// moment it hears the file change.
//
//   node margin.js ~/writing/cases              watch a folder
//   node margin.js --once ~/writing/piece.md    one explicit pass, then exit
//   node margin.js --attach ~/writing/piece.md  watch one file; exit when the
//                                               host closes stdin (thesis.app
//                                               spawns this itself — you never
//                                               run it by hand)
//
// Consent is file-level and lives in the file: thesis's "Invite Claude"
// command writes a thesis:margin block; nothing unmarked is ever read or
// sent. (--once is the exception: running it by hand on one file IS the
// invitation.) Revoking is the same command, or killing this process.
//
// No timers. The only clockwork here is a debounce on file events —
// engineering hygiene inside a watcher, not a schedule. Passes are triggered
// by content: a settled write with >= threshold changed words, or an
// unanswered thread addressed to Claude.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

// ──────────────────────────────────
// CLI
// ──────────────────────────────────
const argv = process.argv.slice(2);
const opts = { threshold: 100, verbose: false, dryRun: false, model: null, once: null, attach: null, root: null, lookups: true };
for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--threshold') opts.threshold = parseInt(argv[++i], 10) || 100;
    else if (a === '--verbose' || a === '-v') opts.verbose = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--model') opts.model = argv[++i];
    else if (a === '--no-lookups') opts.lookups = false;
    else if (a === '--once') opts.once = path.resolve(argv[++i]);
    else if (a === '--attach') opts.attach = path.resolve(argv[++i]);
    else if (!a.startsWith('-')) opts.root = path.resolve(a);
}
if (require.main === module && !opts.root && !opts.once && !opts.attach) {
    console.error('usage: node margin.js <folder> [--threshold 100] [--model m] [--verbose] [--dry-run] [--no-lookups]');
    console.error('       node margin.js --once <file.md>');
    console.error('       node margin.js --attach <file.md>');
    process.exit(1);
}

// ──────────────────────────────────
// Home: state, portable reader memory, tool sandbox
// ──────────────────────────────────
const HOME = path.join(os.homedir(), '.thesis-margin');
const STATE_PATH = path.join(HOME, 'state.json');
const MEMORY_PATH = path.join(HOME, 'memory.md');
const SETTINGS_SEALED = path.join(HOME, 'claude-settings.json');
const SETTINGS_LOOKUP = path.join(HOME, 'claude-settings-lookup.json');
const SANDBOX = path.join(HOME, 'sandbox');
const PROTOCOL_PATH = path.join(__dirname, 'PROTOCOL.md');

fs.mkdirSync(SANDBOX, { recursive: true });
if (!fs.existsSync(MEMORY_PATH)) {
    fs.writeFileSync(MEMORY_PATH, `# How this writer likes to be read

The margin hands this file to every pass, on every document — the memory you
bring with you, so nothing is relearned file by file. It is yours: edit
freely. Claude reads it but never writes it.

- Questions that open the writing up; no praise, no hedging.
- Terse. One sharp note beats three mild ones.
- The measure of a comment is necessity, never count.
- The prose is untouchable unless a thread explicitly asks.
`);
}
// Two tiers, and the boundary between them is the whole point.
//
// The reading pass sees the document and gets no tools at all: it reads what
// we hand it and answers. The folder the writer invited is the exact boundary
// of what leaves the machine.
//
// The lookup pass may reach the web, and never sees the document — only the
// questions the reader wrote by hand in its "lookups". Prose, comments and
// brief never enter this tier. (The questions themselves are derived from the
// writing, so a lookup does disclose what the piece is *about*; it cannot
// disclose how it is written.)
const NO_TOOLS = ['Bash', 'Read', 'Edit', 'Write', 'Glob', 'Grep',
                  'WebFetch', 'WebSearch', 'Task', 'NotebookEdit', 'TodoWrite'];
fs.writeFileSync(SETTINGS_SEALED, JSON.stringify({
    permissions: { deny: NO_TOOLS },
}, null, 2));
fs.writeFileSync(SETTINGS_LOOKUP, JSON.stringify({
    permissions: {
        allow: ['WebSearch', 'WebFetch'],
        deny: NO_TOOLS.filter((t) => t !== 'WebSearch' && t !== 'WebFetch'),
    },
}, null, 2));

let state = { files: {} };
try { state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch (e) { /* fresh start */ }
if (!state.files) state.files = {};
const saveState = () => fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));

const log = (msg) => console.log(`[margin ${new Date().toTimeString().slice(0, 8)}] ${msg}`);
const vlog = (msg) => { if (opts.verbose) log(msg); };

// ──────────────────────────────────
// The comment-block format (mirrors thesis's js/comments.js exactly)
// ──────────────────────────────────
const MARK_START = '<!-- thesis:comments v1';
const BLOCK_RE = /^<!--\s*thesis:comments v1\s*\n([\s\S]*?)\n-->\s*$/;
const MARGIN_START = '<!-- thesis:margin v1';
const MARGIN_RE = /<!--\s*thesis:margin v1\s*\n([\s\S]*?)\n-->\s*/;

function splitMargin(raw) {
    const idx = raw.indexOf(MARGIN_START);
    if (idx < 0) return { rest: raw, margin: null, marginRaw: null };
    const m = raw.match(MARGIN_RE);
    if (!m) return { rest: raw.slice(0, idx), margin: null, marginRaw: raw.slice(idx) };
    const at = raw.indexOf(m[0]);
    const rest = raw.slice(0, at) + raw.slice(at + m[0].length);
    try {
        const margin = JSON.parse(m[1]);
        if (margin && typeof margin === 'object' && !Array.isArray(margin)) return { rest, margin, marginRaw: null };
    } catch (e) { /* salvage */ }
    const a = m[1].indexOf('{'), b = m[1].lastIndexOf('}');
    if (a >= 0 && b > a) {
        try { return { rest, margin: JSON.parse(m[1].slice(a, b + 1)), marginRaw: null }; } catch (e) { /* give up */ }
    }
    return { rest, margin: null, marginRaw: m[0].trimEnd() };
}

function splitComments(input) {
    const { rest: raw, margin, marginRaw } = splitMargin(input);
    const idx = raw.indexOf(MARK_START);
    if (idx < 0) return { prose: raw.replace(/\s+$/, ''), comments: [], raw: null, margin, marginRaw };
    const prose = raw.slice(0, idx).replace(/\s+$/, '');
    const block = raw.slice(idx);
    const m = block.match(BLOCK_RE);
    if (m) {
        try {
            const comments = JSON.parse(m[1]);
            if (Array.isArray(comments)) return { prose, comments, raw: null, margin, marginRaw };
        } catch (e) { /* salvage */ }
    }
    const a = block.indexOf('['), b = block.lastIndexOf(']');
    if (a >= 0 && b > a) {
        const mid = block.slice(a, b + 1);
        for (const candidate of [mid, mid.replace(/^\s*-->\s*$/gm, '')]) {
            try {
                const comments = JSON.parse(candidate);
                if (Array.isArray(comments)) return { prose, comments, raw: null, margin, marginRaw };
            } catch (e) { /* next */ }
        }
    }
    return { prose, comments: [], raw: block, margin, marginRaw };
}

// Byte-compatible with thesis's serializeDocument()
function serializeFile(prose, comments, margin, marginRaw) {
    let out = prose;
    if (comments && comments.length > 0) {
        out += '\n\n' + MARK_START + '\n' + JSON.stringify(comments, null, 2) + '\n-->\n';
    }
    if (marginRaw) out += '\n\n' + marginRaw + '\n';
    else if (margin && (margin.invited || margin.brief)) {
        out += '\n\n' + MARGIN_START + '\n' + JSON.stringify(margin) + '\n-->\n';
    }
    return out;
}

// ──────────────────────────────────
// Rendered blocks — the text thesis anchors quotes against.
// thesis makes one block per line; markers ("- ", "# ", "> ", "1. ") live
// outside the anchorable text, and paired inline markdown disappears.
// ──────────────────────────────────
function stripInline(text) {
    return text
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/__(.+?)__/g, '$1')
        .replace(/\*(.+?)\*/g, '$1')
        .replace(/_(.+?)_/g, '$1')
        .replace(/~~(.+?)~~/g, '$1');
}

function renderBlocks(prose) {
    return prose.split('\n').map((line) => {
        const trimmed = line.trim();
        if (trimmed === '') return '';
        let t;
        if (trimmed.startsWith('### ')) t = trimmed.slice(4);
        else if (trimmed.startsWith('## ')) t = trimmed.slice(3);
        else if (trimmed.startsWith('# ')) t = trimmed.slice(2);
        else if (trimmed.startsWith('> ')) t = trimmed.slice(2);
        else if (/^[-*]\s+/.test(trimmed)) t = trimmed.replace(/^[-*]\s+/, '');
        else if (/^\d+\.\s+/.test(trimmed)) t = trimmed.replace(/^\d+\.\s+/, '');
        else t = trimmed;
        return stripInline(t);
    });
}

// ──────────────────────────────────
// Triggers
// ──────────────────────────────────
// Threads where the writer spoke last and Claude is involved (his comment,
// his reply, or an @claude anywhere in the thread). Rule 2: answer first.
function threadsNeedingAnswer(comments) {
    const out = [];
    for (const c of comments || []) {
        if (c.resolved) continue;
        const items = [{ author: c.author || 'me', body: c.body || '' }, ...(c.replies || [])];
        const last = items[items.length - 1];
        if (!last || last.author === 'claude') continue;
        const involves = items.some((it) => it.author === 'claude' || /@claude/i.test(it.body || ''));
        if (involves) out.push(c.id);
    }
    return out;
}

// Whole-document asks: an unanswered @claude the writer left with no anchor
// (the Full Read command, or a hand-typed doc-level @claude). These want an
// overall read of the piece, not just anchored specifics — the model tends to
// skip the general read unless it's made the loud, primary task.
function fullReadAsks(comments) {
    const out = [];
    for (const c of comments || []) {
        if (c.resolved) continue;
        if (c.quote) continue;                        // anchored → a specific question, not a full read
        if ((c.author || 'me') === 'claude') continue;
        const items = [{ author: c.author || 'me', body: c.body || '' }, ...(c.replies || [])];
        if (items[items.length - 1].author === 'claude') continue;   // already answered
        if (items.some((it) => /@claude/i.test(it.body || ''))) out.push(c.id);
    }
    return out;
}

const wordsIn = (s) => s.trim() ? s.trim().split(/\s+/).length : 0;

// How much writing changed since the last pass — line-multiset diff, words
// added counted in full, words removed at half weight (a heavy cut is also a
// change worth reading). This is the "creative method": content, not clocks.
function changedWordCount(oldProse, newProse) {
    if (oldProse == null) return Infinity;   // first read of an invited file
    const tally = (lines) => {
        const m = new Map();
        for (const l of lines) m.set(l, (m.get(l) || 0) + 1);
        return m;
    };
    const a = tally(oldProse.split('\n'));
    const b = tally(newProse.split('\n'));
    let words = 0;
    for (const [line, n] of b) {
        const d = n - (a.get(line) || 0);
        if (d > 0) words += wordsIn(line) * d;
    }
    for (const [line, n] of a) {
        const d = n - (b.get(line) || 0);
        if (d > 0) words += Math.ceil(wordsIn(line) / 2) * d;
    }
    return words;
}

function changedBlockIndices(oldProse, newProse) {
    if (oldProse == null) return null;   // everything is new
    const oldLines = new Map();
    for (const l of renderBlocks(oldProse)) oldLines.set(l, (oldLines.get(l) || 0) + 1);
    const out = [];
    renderBlocks(newProse).forEach((line, i) => {
        if (!line) return;
        const n = oldLines.get(line) || 0;
        if (n > 0) oldLines.set(line, n - 1);
        else out.push(i);
    });
    return out;
}

// ──────────────────────────────────
// The pass — build prompt, run Claude CLI, validate, write back
// ──────────────────────────────────
const PROTOCOL = fs.readFileSync(PROTOCOL_PATH, 'utf8');

function buildPrompt(doc, needAnswer, changedBlocks, findings) {
    const memory = fs.readFileSync(MEMORY_PATH, 'utf8');
    const blockLines = renderBlocks(doc.prose)
        .map((t, i) => `[${i}] ${t}`.trimEnd())
        .join('\n');
    const fullReads = fullReadAsks(doc.comments);
    const why = [];
    if (needAnswer.length > 0) why.push(`The writer replied in these threads and is waiting: ${JSON.stringify(needAnswer)}. Answer them first.`);
    if (changedBlocks === null) why.push('This is your first read of this document.');
    else if (changedBlocks.length > 0) why.push(`Blocks changed since your last read: ${JSON.stringify(changedBlocks)} — guidance for rule 6, not a limit on what you may read.`);
    else if (needAnswer.length === 0) why.push('New writing has settled since your last read.');

    // Second leg of a two-pass read: the questions this pass asked last time
    // came back answered. Asking again is off the table — decide with what you
    // have. (Rebuilt from the same doc, so everything else is unchanged.)
    const findingsSection = !findings || findings.length === 0 ? '' : `
=== WHAT YOUR LOOKUPS FOUND ===
You asked these questions and they were checked against live sources. This is
your only chance to use them — you cannot ask again on this pass.
${findings.map((f) => `Q: ${f.q}\nA: ${f.finding}${f.sources.length ? `\nSources: ${f.sources.join(' ')}` : ''}`).join('\n\n')}

Use a finding only where it changes what is worth saying. A confirmed fact is
usually a reason to stay silent, not a reason to write "this checks out". When
a finding contradicts the text, the note is still a question — the evidence
goes in it, it does not replace it. Cite the URL inline when you rely on it.
`;

    const lookupRules = findings ? `
- "lookups" MUST be empty. Your questions were answered above; this pass decides.` : `
- "lookups" are for a checkable claim the text asserts and you cannot settle from the text alone — a figure, a date, a quotation, an attribution. At most ${MAX_LOOKUPS}, and most passes should ask none.
- Do not look up what you merely find interesting, what is a matter of judgment, or what the writer plainly knows better than any source. Curiosity is not a reason; a load-bearing claim you doubt is.
- A lookup costs the writer a second reading pass. Ask only when the answer would change what you say.
- When you ask for lookups, leave "comments" and "edits" empty unless a note is entirely independent of what you asked — you will see this document again with the answers in hand.`;

    const fullReadDirective = fullReads.length === 0 ? '' : `
=== FULL READ REQUESTED — THIS IS YOUR PRIMARY TASK ===
The writer asked for a full read in thread(s) ${JSON.stringify(fullReads)}. For each, your FIRST action is a reply in that thread (in "replies", using the exact id) giving your overall read of the whole piece: what it is arguing, whether the arc holds, what is strongest, and what is missing or unearned. A few honest sentences — no praise-padding. This overall read is required; anchored specific notes are welcome ALONGSIDE it but never INSTEAD of it. Do not resolve the ask — the writer resolves it once they've read your answer.
`;

    return `You are the reader in the margin of a document. Follow the protocol below exactly.

=== PROTOCOL ===
${PROTOCOL}
=== READER MEMORY (how this writer likes to be read, across all their files) ===
${memory}
=== THIS FILE'S BRIEF (from the writer; tunes the protocol) ===
${(doc.margin && doc.margin.brief) || '(none)'}

=== WHY YOU ARE READING NOW ===
${why.join('\n')}
${fullReadDirective}${findingsSection}
=== THE DOCUMENT (one block per line; "quote" anchors must be copied exactly from these lines) ===
${blockLines}

=== SOURCE (exact markdown bytes; use ONLY for "edits" find strings) ===
${doc.prose}

=== COMMENTS (full history, JSON; resolved threads carry the writer's standards) ===
${JSON.stringify(doc.comments, null, 2)}

=== YOUR RESPONSE ===
Respond with ONLY a JSON object, no prose around it:
{
  "replies":  [{"id": "<existing comment id>", "body": "<your reply>"}],
  "resolve":  ["<comment id>"],
  "comments": [{"block": <block index>, "quote": "<exact substring of that block's line above>", "body": "<the note>", "fix": {"before": "<exact text within the block>", "after": "<replacement>"}}],
  "edits":    [{"threadId": "<comment id that explicitly requested this>", "find": "<exact SOURCE text, occurring exactly once>", "replace": "<replacement>"}],
  "lookups":  [{"q": "<a factual question to check against live sources>", "for": "<comment id or block index this serves>"}]
}
Response rules:
- Empty arrays are the normal case. {"replies":[],"resolve":[],"comments":[],"edits":[],"lookups":[]} is a complete, successful pass.${lookupRules}
- "quote" must be copied character-for-character from a single [block] line. Never quote across blocks.
- A comment may instead be {"doc": true, "body": "<the note>"} — a document note about the whole piece (structure, arc, what's missing) with no anchor. Use sparingly: if a point has a home in the text, anchor it there.
- "fix" is optional and only for mechanical slips (typo, doubled word).
- "edits" only when a thread explicitly requested a prose change; pair every edit with a reply describing what changed, and put that thread's id in "resolve".
- Never resolve a thread you did not act on.`;
}

function runClaude(prompt, settings = SETTINGS_SEALED, timeoutMs = 300000) {
    return new Promise((resolve, reject) => {
        const args = ['-p', '--output-format', 'json', '--settings', settings];
        if (opts.model) args.push('--model', opts.model);
        const child = spawn('claude', args, { cwd: SANDBOX, stdio: ['pipe', 'pipe', 'pipe'] });
        let out = '', err = '';
        const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`claude timed out after ${Math.round(timeoutMs / 60000)} minutes`)); }, timeoutMs);
        child.stdout.on('data', (d) => { out += d; });
        child.stderr.on('data', (d) => { err += d; });
        child.on('error', (e) => { clearTimeout(timer); reject(e); });
        child.on('close', (code) => {
            clearTimeout(timer);
            if (code !== 0) return reject(new Error(`claude exited ${code}: ${err.slice(0, 400)}`));
            resolve(out);
        });
        child.stdin.write(prompt);
        child.stdin.end();
    });
}

function extractJSONObject(cliOutput) {
    let text = cliOutput;
    try {
        const envelope = JSON.parse(cliOutput);
        if (envelope.is_error) throw new Error(`claude reported an error: ${String(envelope.result).slice(0, 400)}`);
        text = String(envelope.result || '');
    } catch (e) {
        if (String(e.message || '').startsWith('claude reported')) throw e;
        // not an envelope — treat raw output as the model text
    }
    const candidates = [];
    candidates.push(text.trim());
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) candidates.push(fence[1].trim());
    const a = text.indexOf('{'), b = text.lastIndexOf('}');
    if (a >= 0 && b > a) candidates.push(text.slice(a, b + 1));
    for (const c of candidates) {
        try {
            const obj = JSON.parse(c);
            if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj;
        } catch (e) { /* next */ }
    }
    throw new Error('could not parse a JSON action object from the model output');
}

// ──────────────────────────────────
// The lookup pass — questions out, findings back, document never present
// ──────────────────────────────────
const MAX_LOOKUPS = 3;

// Keep only well-formed questions, and cap them. The cap is a bar, not a
// budget to spend: most passes should ask nothing.
function validLookups(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const l of raw) {
        if (!l || typeof l.q !== 'string') continue;
        const q = l.q.trim();
        if (!q || q.length > 300) continue;
        out.push({ q, for: typeof l.for === 'string' ? l.for : '' });
        if (out.length === MAX_LOOKUPS) break;
    }
    return out;
}

async function runLookups(lookups) {
    // This prompt is the entire contents of the web tier. No prose, no
    // comments, no brief, no memory — only the questions themselves.
    const prompt = `You are checking facts for a reader who is annotating someone's draft. You have web search and fetch. You do NOT have the document, and you must not ask for it.

Answer each question below from sources you actually retrieve. Rules:
- Search, then fetch the pages that matter. A search snippet alone is not a check.
- Report what the sources say, including when they disagree or when you cannot establish the fact. "Could not confirm" is a valid, useful finding — never guess to fill the slot.
- Be terse. One or two sentences per question, with the specific figure, date, or wording that settles it.
- Give real URLs you actually retrieved. Never invent a citation.

=== QUESTIONS ===
${lookups.map((l, i) => `[${i}] ${l.q}`).join('\n')}

=== YOUR RESPONSE ===
Respond with ONLY a JSON object, no prose around it:
{"findings": [{"i": <question index>, "finding": "<what the sources establish, or that they do not>", "sources": ["<url>"]}]}`;

    const obj = extractJSONObject(await runClaude(prompt, SETTINGS_LOOKUP));
    const raw = Array.isArray(obj.findings) ? obj.findings : [];
    const out = [];
    for (const f of raw) {
        const i = Number.isInteger(f && f.i) ? f.i : -1;
        if (i < 0 || i >= lookups.length || typeof f.finding !== 'string' || !f.finding.trim()) continue;
        out.push({
            q: lookups[i].q,
            for: lookups[i].for,
            finding: f.finding.trim(),
            sources: (Array.isArray(f.sources) ? f.sources : [])
                .filter((u) => typeof u === 'string' && /^https?:\/\//i.test(u))
                .slice(0, 4),
        });
    }
    return out;
}

const newId = () => 'c_' + Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex').slice(0, 5);
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Content this process wrote, by path — its own file events are not news
const selfWrites = new Map();

async function runPass(file, reason) {
    const before = splitComments(fs.readFileSync(file, 'utf8'));
    if (before.raw) { log(`! ${path.basename(file)} — damaged comment block, refusing to touch it`); return; }

    const needAnswer = threadsNeedingAnswer(before.comments);
    const fileState = state.files[file] || {};
    const changedBlocks = changedBlockIndices(fileState.lastSweepProse ?? null, before.prose);

    vlog(`pass on ${path.basename(file)} (${reason})`);
    let actions = extractJSONObject(await runClaude(buildPrompt(before, needAnswer, changedBlocks, null)));

    // If the reader asked to check something, the questions — and nothing else
    // — go out to the web tier, and the document is read a second time with
    // the answers in hand. The first leg's notes are deliberately discarded:
    // it wrote them not knowing what it was about to learn, and merging two
    // action sets risks saying everything twice.
    const lookups = opts.lookups ? validLookups(actions.lookups) : [];
    if (lookups.length) {
        log(`  ${path.basename(file)} — checking ${lookups.length} question${lookups.length === 1 ? '' : 's'}`);
        for (const l of lookups) vlog(`    ? ${l.q}`);
        console.log('@@margin checking');
        let findings = [];
        try {
            findings = await runLookups(lookups);
        } catch (e) {
            log(`! ${path.basename(file)} — lookup failed, reading on without it: ${e.message}`);
        } finally {
            console.log('@@margin reading');
        }
        actions = extractJSONObject(await runClaude(buildPrompt(before, needAnswer, changedBlocks, findings)));
    }

    const replies = Array.isArray(actions.replies) ? actions.replies : [];
    const resolve = Array.isArray(actions.resolve) ? actions.resolve : [];
    const edits = Array.isArray(actions.edits) ? actions.edits : [];
    let newComments = Array.isArray(actions.comments) ? actions.comments : [];
    if (newComments.length > 10) {
        log(`! ${path.basename(file)} — ${newComments.length} comments in one pass, keeping 10 (runaway guard)`);
        newComments = newComments.slice(0, 10);
    }

    // Re-read: the writer may have kept typing during inference. Everything is
    // re-validated against the file as it is NOW; what no longer fits is dropped.
    const fresh = splitComments(fs.readFileSync(file, 'utf8'));
    if (fresh.raw) { log(`! ${path.basename(file)} — comment block damaged mid-pass, dropping this pass`); return; }
    const now = new Date().toISOString();
    const byId = new Map(fresh.comments.map((c) => [c.id, c]));
    const applied = { replies: 0, comments: 0, edits: 0, resolved: 0, dropped: 0 };

    const repliedIds = new Set();
    for (const r of replies) {
        const c = byId.get(r.id);
        if (!c || !r.body || typeof r.body !== 'string') { applied.dropped++; continue; }
        c.replies = c.replies || [];
        c.replies.push({ author: 'claude', body: r.body, created: now });
        repliedIds.add(r.id);
        applied.replies++;
    }

    // Prose edits: explicit request only, exact and unique in the current bytes
    let prose = fresh.prose;
    const editedThreads = new Set();
    for (const e of edits) {
        if (!e || typeof e.find !== 'string' || typeof e.replace !== 'string' || !e.find) { applied.dropped++; continue; }
        const first = prose.indexOf(e.find);
        if (first < 0 || prose.indexOf(e.find, first + 1) >= 0) { applied.dropped++; continue; }
        prose = prose.slice(0, first) + e.replace + prose.slice(first + e.find.length);
        if (e.threadId) editedThreads.add(e.threadId);
        applied.edits++;
    }

    // Resolve only what was actually acted on
    for (const id of resolve) {
        const c = byId.get(id);
        if (c && !c.resolved && (editedThreads.has(id) || repliedIds.has(id))) { c.resolved = true; applied.resolved++; }
    }

    // New comments: anchor against the document as written now
    const blocks = renderBlocks(prose);
    for (const nc of newComments) {
        if (!nc || typeof nc.body !== 'string' || !nc.body.trim()) { applied.dropped++; continue; }
        // Document note — about the whole piece, intentionally unanchored
        if (nc.doc === true) {
            fresh.comments.push({
                id: newId(),
                block: -1,
                quote: '',
                prefix: '',
                body: nc.body.trim(),
                author: 'claude',
                created: now,
                resolved: false,
                replies: [],
            });
            applied.comments++;
            continue;
        }
        if (typeof nc.quote !== 'string' || !nc.quote.trim()) { applied.dropped++; continue; }
        let blockIdx = Number.isInteger(nc.block) && nc.block >= 0 && nc.block < blocks.length && blocks[nc.block].includes(nc.quote)
            ? nc.block
            : blocks.findIndex((t) => t.includes(nc.quote));
        if (blockIdx < 0) { applied.dropped++; vlog(`  dropped unanchorable quote: "${nc.quote.slice(0, 40)}…"`); continue; }
        const start = blocks[blockIdx].indexOf(nc.quote);
        const comment = {
            id: newId(),
            block: blockIdx,
            quote: nc.quote,
            prefix: blocks[blockIdx].slice(Math.max(0, start - 30), start),
            body: nc.body.trim(),
            author: 'claude',
            created: now,
            resolved: false,
        };
        if (nc.fix && typeof nc.fix.before === 'string' && nc.fix.before && typeof nc.fix.after === 'string'
            && blocks[blockIdx].includes(nc.fix.before)) {
            comment.fix = { before: nc.fix.before, after: nc.fix.after };
        }
        comment.replies = [];
        fresh.comments.push(comment);
        applied.comments++;
    }

    const touched = applied.replies + applied.comments + applied.edits + applied.resolved > 0;
    if (touched && !opts.dryRun) {
        const out = serializeFile(prose, fresh.comments, fresh.margin, fresh.marginRaw);
        selfWrites.set(file, sha(out));
        fs.writeFileSync(file, out);
    }
    if (!opts.dryRun) {
        state.files[file] = { lastSweepProse: prose, lastPassAt: now };
        saveState();
    }

    const parts = [];
    if (applied.replies) parts.push(`${applied.replies} repl${applied.replies === 1 ? 'y' : 'ies'}`);
    if (applied.comments) parts.push(`${applied.comments} comment${applied.comments === 1 ? '' : 's'}`);
    if (applied.edits) parts.push(`${applied.edits} edit${applied.edits === 1 ? '' : 's'}`);
    if (applied.resolved) parts.push(`${applied.resolved} resolved`);
    if (applied.dropped) parts.push(`${applied.dropped} dropped`);
    log(`${touched ? '✓' : '·'} ${path.basename(file)} — ${parts.length ? parts.join(', ') : 'nothing to say'}${opts.dryRun ? ' (dry run)' : ''}`);
}

// ──────────────────────────────────
// Deciding when a settled file deserves a pass
// ──────────────────────────────────
const busy = new Set();
const recheck = new Set();

async function consider(file, force) {
    if (busy.has(file)) { recheck.add(file); return; }
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return; }   // moved/deleted
    if (text.length > 1024 * 1024) { vlog(`skip ${path.basename(file)} — over 1MB`); return; }
    if (selfWrites.get(file) === sha(text)) { vlog(`skip ${path.basename(file)} — own write`); return; }

    const doc = splitComments(text);
    const invited = !!(doc.margin && doc.margin.invited === true);
    if (!invited && !force) { vlog(`skip ${path.basename(file)} — not invited`); return; }

    const needAnswer = threadsNeedingAnswer(doc.comments);
    const fileState = state.files[file] || {};
    const changed = changedWordCount(fileState.lastSweepProse ?? null, doc.prose);
    const reason = force ? 'explicit run'
        : needAnswer.length > 0 ? `answering ${needAnswer.length} thread${needAnswer.length === 1 ? '' : 's'}`
        : changed >= opts.threshold ? `${changed === Infinity ? 'first read' : changed + ' words changed'}`
        : null;
    if (!reason) { vlog(`skip ${path.basename(file)} — ${changed} changed words, no waiting threads`); return; }

    busy.add(file);
    // Machine-readable state markers for the hosting shell (thesis shows a
    // quiet "Claude is reading…" line in its palette while a pass runs)
    console.log('@@margin reading');
    try {
        await runPass(file, reason);
    } catch (e) {
        log(`! ${path.basename(file)} — ${e.message}`);
    } finally {
        console.log('@@margin idle');
        busy.delete(file);
        if (recheck.delete(file)) consider(file, false);
    }
}

// ──────────────────────────────────
// Watch mode
// ──────────────────────────────────
function watch(root) {
    let st;
    try { st = fs.statSync(root); } catch (e) { st = null; }
    if (!st || !st.isDirectory()) {
        console.error(`margin: ${root} is not a folder`);
        process.exit(1);
    }

    const mdFiles = (dir) => {
        const out = [];
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
            const p = path.join(dir, entry.name);
            if (entry.isDirectory()) out.push(...mdFiles(p));
            else if (/\.md$/i.test(entry.name)) out.push(p);
        }
        return out;
    };

    const all = mdFiles(root);
    const invited = all.filter((f) => {
        try {
            const { margin } = splitComments(fs.readFileSync(f, 'utf8'));
            return margin && margin.invited === true;
        } catch (e) { return false; }
    });
    log(`watching ${root} — ${all.length} file${all.length === 1 ? '' : 's'}, ${invited.length} invited`);
    log(`reader memory: ${MEMORY_PATH}`);

    // Threads left waiting while the margin was off get answered on arrival;
    // sweeps wait for actual new writing.
    for (const f of invited) {
        try {
            const { comments } = splitComments(fs.readFileSync(f, 'utf8'));
            if (threadsNeedingAnswer(comments).length > 0) consider(f, false);
        } catch (e) { /* unreadable — the watcher will tell us if it changes */ }
    }

    // Settled-write detection: thesis autosaves ~1s after typing pauses and
    // flushes on blur. The debounce below only coalesces event bursts.
    const pending = new Map();
    fs.watch(root, { recursive: true }, (event, filename) => {
        if (!filename || !/\.md$/i.test(filename)) return;
        if (filename.split(path.sep).some((part) => part.startsWith('.') || part === 'node_modules')) return;
        const file = path.join(root, filename);
        clearTimeout(pending.get(file));
        pending.set(file, setTimeout(() => {
            pending.delete(file);
            consider(file, false);
        }, 1500));
    });

    process.on('SIGINT', () => { log('margin stopped — the invitation ends here'); process.exit(0); });
}

// ──────────────────────────────────
// Attach mode — one file, hosted by thesis.app
// ──────────────────────────────────
// The shell spawns this when the open file is invited and holds our stdin.
// When thesis closes the file, revokes, quits, or dies, stdin closes and we
// exit — the companion can never outlive the writer's intent. Event-driven
// throughout: stdin close and fs events, no clocks.
function attach(file) {
    let st;
    try { st = fs.statSync(file); } catch (e) { st = null; }
    if (!st || !st.isFile()) {
        console.error(`margin: ${file} is not a file`);
        process.exit(1);
    }
    process.stdin.resume();
    process.stdin.on('end', () => process.exit(0));
    process.stdin.on('close', () => process.exit(0));
    process.on('SIGTERM', () => process.exit(0));

    log(`attached to ${path.basename(file)}`);
    // Opening (or just inviting) the file is a seam: answer waiting threads,
    // and give a first read if this file has never been read.
    consider(file, false);

    // Watch the parent directory — atomic saves replace the file's inode, so
    // watching the file itself would go blind after the first save.
    const dir = path.dirname(file), base = path.basename(file);
    let pending = null;
    fs.watch(dir, (event, filename) => {
        if (filename && filename !== base) return;
        clearTimeout(pending);
        pending = setTimeout(() => consider(file, false), 1500);
    });
}

// ──────────────────────────────────
// Go
// ──────────────────────────────────
// Exported for format-test.js, which asserts this file and thesis's
// js/comments.js still speak the same format.
module.exports = { splitMargin, splitComments, serializeFile, renderBlocks, changedWordCount, threadsNeedingAnswer };

if (require.main === module) {
    if (opts.once) {
        consider(opts.once, true).then(() => process.exit(0));
    } else if (opts.attach) {
        attach(opts.attach);
    } else {
        watch(opts.root);
    }
}
