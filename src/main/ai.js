'use strict';
// AI assist (optional): summarize a document, explain a passage, or turn notes into a report, with
// the reader's own key for Claude or another service (src/main/ai-providers.js, 3.3). The prompts are
// the same for every service; this file also makes the requests to Claude.
//
//  - Off until the reader turns it on and enters a key. Nothing is ever sent automatically: each
//    request is a menu command, and only that document (or selection) is sent.
//  - The key is kept encrypted by the operating system (Electron safeStorage), never in settings.
//  - Locked documents are never sent.
// The prompt builders here are pure (unit-tested); the API call goes through the official SDK,
// bundled into dist/export-tools.cjs.

const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (best quality)', fallbacks: true },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (faster, lower cost)', fallbacks: true },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (fastest, lowest cost)', fallbacks: false },
];
const DEFAULT_MODEL = 'claude-opus-5-5';
const MAX_CHARS = 600_000;          // ~150K tokens: well inside the context window, and a sane cost cap
const KEY_RE = /^sk-ant-[A-Za-z0-9_-]{20,300}$/;

const SYSTEM = [
  'You help someone reading a Markdown document in RT Markdown Reader, a desktop Markdown reader.',
  'Answer in Markdown that renders well: short paragraphs, headings and lists where they help.',
  'Stay faithful to the document. Do not invent facts, names, numbers or dates that it does not contain; if something is unclear or missing, say so.',
  'Write in the same language as the document.',
].join('\n');

const escAttr = (s) => String(s || '').replace(/[&"<>]/g, (c) => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' }[c]));

/** Build the request content for an action. Throws a friendly error for empty or oversized input. */
function buildPrompt(action, { text = '', selection = '', title = '' } = {}) {
  const doc = String(text || '');
  const sel = String(selection || '').trim();
  if (!doc.trim()) throw new Error('This document is empty.');
  if (doc.length > MAX_CHARS) throw new Error(`This document is too long for AI assist (${Math.round(doc.length / 1000)}K characters; the limit is ${MAX_CHARS / 1000}K).`);
  const wrapped = `<document title="${escAttr(title)}">\n${doc}\n</document>`;
  switch (action) {
    case 'summarize':
      return `${wrapped}\n\nSummarize this document for someone who hasn't read it. Start with a one-sentence overview, then the key points as a short bulleted list, then any decisions, dates, numbers or action items it contains (skip that part if there are none). Keep it under 250 words.`;
    case 'explain':
      if (!sel) throw new Error('Select some text on the page first.');
      return `${wrapped}\n\n<selection>\n${sel.slice(0, 20_000)}\n</selection>\n\nExplain the selected passage in plain language, using the rest of the document for context. Define any jargon or abbreviations it uses. Keep it brief: a few short paragraphs at most.`;
    case 'report':
      return `${wrapped}\n\nTurn these notes into a clean, well-structured report in Markdown.\n- Begin with YAML front matter containing title, subtitle and date (use a date from the notes; omit date if there is none).\n- Then an executive summary of two to four sentences.\n- Then sections with clear headings. Use tables where the notes contain comparable data, and a task list (- [ ]) for action items.\n- Keep every fact from the notes and add no new facts. Fix spelling and make the wording clear and professional.\n\nReply with only the Markdown document, without a code fence around it.`;
    default:
      throw new Error('Unknown AI action.');
  }
}

/**
 * Ask a question about several documents from the open folder. Lines are numbered so the answer can
 * point at its sources as [path:line]. Throws a friendly error for an empty question or too much text.
 * @param {string} question  @param {{ rel: string, text: string }[]} docs
 */
function buildFolderPrompt(question, docs) {
  const q = String(question || '').trim();
  if (!q) throw new Error('Type a question first.');
  if (q.length > 4000) throw new Error('That question is too long.');
  const usable = (docs || []).filter((d) => String(d.text || '').trim());
  if (!usable.length) throw new Error('None of the chosen documents has any text.');
  let total = 0;
  const parts = [];
  for (const d of usable) {
    const numbered = String(d.text).replace(/\r\n?/g, '\n').split('\n').map((l, i) => `${i + 1}| ${l}`).join('\n');
    total += numbered.length;
    if (total > MAX_CHARS) throw new Error(`The chosen documents are too long together (over ${MAX_CHARS / 1000}K characters). Choose fewer.`);
    parts.push(`<document path="${escAttr(d.rel)}">\n${numbered}\n</document>`);
  }
  return `${parts.join('\n\n')}\n\nAnswer this question using only the documents above:\n<question>\n${q}\n</question>\n\n`
    + 'After each statement, cite where it comes from as [path:line], using the document path and the line number shown before the "|" (for example [notes/plan.md:12]). '
    + 'If the documents don\'t answer the question, say so plainly instead of guessing. Keep the answer short.';
}

// ---------------------------------------------------------------- writing help in the editor (2.4)
const EDIT_TASKS = {
  proofread: 'Proofread the text: fix spelling, grammar and punctuation mistakes. Change nothing else: keep the wording, tone and meaning.',
  rewrite: 'Rewrite the text so it reads clearly and naturally, keeping its meaning, every fact, its tone and roughly its length.',
  shorten: 'Make the text shorter, about half as long, keeping every important fact, name, number and date.',
  translate: 'Translate the text into {language}. Translate naturally, not word for word.',
};
const LANGUAGE_RE = /^[\p{L}][\p{L}\p{M} ()'’-]{1,59}$/u;

/**
 * Ask for a suggested change to the selected text. The text around it goes along as context only.
 * Throws a friendly error for an empty or oversized selection or an unknown language.
 */
function buildEditPrompt(action, { text = '', before = '', after = '', language = '' } = {}) {
  const sel = String(text || '');
  if (!EDIT_TASKS[action]) throw new Error('Unknown AI action.');
  if (!sel.trim()) throw new Error('Select some text in the editor first.');
  if (sel.length > 60_000) throw new Error(`That selection is too long (${Math.round(sel.length / 1000)}K characters; the limit is 60K). Select less.`);
  const lang = String(language || '').trim();
  if (action === 'translate' && !LANGUAGE_RE.test(lang)) throw new Error('Choose the language to translate into.');
  const b = String(before || '').slice(-2000);
  const a = String(after || '').slice(0, 2000);
  const context = b.trim() || a.trim() ? `<context_before>\n${b}\n</context_before>\n<context_after>\n${a}\n</context_after>\n\n` : '';
  return `${context}<text>\n${sel}\n</text>\n\n${EDIT_TASKS[action].replace('{language}', lang)}\n`
    + 'Keep its Markdown formatting (headings, lists, links, emphasis, tables). Never change code, URLs or anything in backticks. '
    + (action === 'translate' ? '' : 'Keep the same language. ')
    + 'The context is only there to help you: change only what is inside <text>.\n'
    + 'Reply with only the revised text: no introduction, no explanation, no code fence and no <text> tags.';
}

/** Tidy an answer into the text to put in place of the selection (keeping the selection's outer spacing). */
function cleanEditResult(original, answer) {
  let t = String(answer || '').replace(/^\s*<text>\s*\n?/, '').replace(/\n?\s*<\/text>\s*$/, '');
  const fenced = /^\s*```(?:markdown|md|text)?\s*\n([\s\S]*?)\n```\s*$/.exec(t);
  if (fenced && !/^\s*```/.test(original)) t = fenced[1];
  const lead = /^\s*/.exec(original)[0];
  const trail = /\s*$/.exec(original)[0];
  return lead + t.trim() + trail;
}

/** Request parameters for the Messages API (beta surface, for server-side refusal fallbacks). */
function requestParams(model, content) {
  const m = MODELS.find((x) => x.id === model) || MODELS[0];
  const params = {
    model: m.id,
    max_tokens: 16000,
    output_config: { effort: 'medium' },
    system: SYSTEM,
    messages: [{ role: 'user', content }],
  };
  if (m.fallbacks) {
    // If a safety classifier declines, the API re-runs the request on a suitable model in the same call.
    params.betas = ['server-side-fallback-2026-07-01'];
    params.fallbacks = 'default';
  }
  return params;
}

/** A plain-language message for an SDK error. */
function friendlyError(err, Anthropic) {
  if (err?.name === 'AbortError' || err instanceof (Anthropic?.APIUserAbortError || class {})) return 'Stopped.';
  if (Anthropic) {
    if (err instanceof Anthropic.AuthenticationError) return 'Anthropic didn’t accept the API key. Check it under Edit → AI Assist → Settings.';
    if (err instanceof Anthropic.PermissionDeniedError) return 'This API key isn’t allowed to use that model.';
    if (err instanceof Anthropic.NotFoundError) return 'That model isn’t available to this API key. Pick another model in AI Assist settings.';
    if (err instanceof Anthropic.RateLimitError) return 'Too many requests right now — try again in a minute.';
    if (err instanceof Anthropic.BadRequestError) return `Anthropic couldn’t process the request: ${err.message}`;
    if (err instanceof Anthropic.APIConnectionError) return 'Couldn’t reach Anthropic. Check your internet connection.';
    if (err instanceof Anthropic.APIError) return `Anthropic returned an error (${err.status ?? 'unknown'}): ${err.message}`;
  }
  return String(err?.message || err);
}

/**
 * Run one request, streaming text through onText. Resolves to { text, stopReason, model, note? }.
 * @param {{ Anthropic: any, apiKey: string, model: string, content: string, onText: (t: string) => void, signal?: AbortSignal, baseURL?: string }} o
 */
async function runAi({ Anthropic, apiKey, model, content, onText, signal, baseURL }) {
  // The address is fixed so an ANTHROPIC_BASE_URL set on the computer for some other tool can't
  // redirect the reader's key and documents somewhere else (tests pass a local stand-in).
  const client = new Anthropic({ apiKey, authToken: null, baseURL: baseURL || 'https://api.anthropic.com', maxRetries: 2 });
  const stream = client.beta.messages.stream(requestParams(model, content), { signal });
  stream.on('text', (delta) => onText(delta));
  const message = await stream.finalMessage();
  const text = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  let note = '';
  if (message.stop_reason === 'refusal') note = 'Claude declined to answer this request.';
  else if (message.stop_reason === 'max_tokens') note = 'The answer was cut off because it reached the length limit.';
  return { text, stopReason: message.stop_reason, model: message.model, note };
}

module.exports = { MODELS, DEFAULT_MODEL, MAX_CHARS, KEY_RE, SYSTEM, buildPrompt, buildFolderPrompt, buildEditPrompt, cleanEditResult, EDIT_TASKS, requestParams, friendlyError, runAi };
