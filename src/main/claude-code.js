'use strict';
// Claude Code (3.4): AI assist through the Claude Code already installed and signed in on this computer,
// on your Claude plan, with no API key. The app runs it once per request with every tool switched off,
// so it can only write text back. The app never sees or stores the sign-in.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SYSTEM } = require('./ai');

const ARGS = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--tools', '', '--no-session-persistence', '--setting-sources', '', '--strict-mcp-config'];
const NOT_INSTALLED = 'Claude Code wasn’t found on this computer. Install it from claude.com/claude-code, or choose another service.';
const NOT_SIGNED_IN = 'Claude Code isn’t signed in. Run claude in a terminal and sign in, then try again.';
const MODELS = [
  { id: 'sonnet', label: 'Sonnet (a good all-rounder)' },
  { id: 'opus', label: 'Opus (the most capable)' },
  { id: 'haiku', label: 'Haiku (the quickest)' },
];
const DEFAULT_MODEL = 'sonnet';

/** The Claude Code program, looked for where its installers put it: an app started from the desktop may not have those on its PATH. */
function findClaude({ env = process.env, platform = process.platform, home = os.homedir(), exists = fs.existsSync } = {}) {
  if (env.NMR_CLAUDE_BIN) return exists(env.NMR_CLAUDE_BIN) ? env.NMR_CLAUDE_BIN : null;
  const names = platform === 'win32' ? ['claude.exe', 'claude.cmd'] : ['claude'];
  const join = platform === 'win32' ? path.win32.join : path.posix.join;
  const dirs = [
    join(home, '.local', 'bin'),
    join(home, '.claude', 'local'),
    ...(platform === 'win32' ? [env.APPDATA && join(env.APPDATA, 'npm')] : ['/opt/homebrew/bin', '/usr/local/bin', join(home, '.npm-global', 'bin')]),
    ...String(env.PATH || env.Path || '').split(platform === 'win32' ? ';' : ':'),
  ];
  for (const dir of dirs) {
    if (!dir) continue;
    for (const name of names) {
      const full = join(dir, name);
      if (exists(full)) return full;
    }
  }
  return null;
}

const quoted = (arg) => `"${arg}"`;

/** Run Claude Code. A .cmd can only be run through the shell, so its arguments are quoted; none of them come from a document. */
function launch(spawn, bin, args, opts = {}) {
  const env = { ...process.env, ...opts.env };
  delete env.CLAUDECODE;                             // set if this app was started from inside Claude Code
  delete env.ELECTRON_RUN_AS_NODE;
  if (/\.(cmd|bat)$/i.test(bin)) return spawn(quoted(bin), args.map(quoted), { windowsHide: true, ...opts, env, shell: true });
  return spawn(bin, args, { windowsHide: true, ...opts, env });
}

/** Run one request. Returns { text, stopReason, model, note }; throws Error with a plain message. */
function runClaudeCode({ spawn, bin, model, content, onText, signal }) {
  return new Promise((resolve, reject) => {
    if (!bin) { reject(new Error(NOT_INSTALLED)); return; }
    const child = launch(spawn, bin, [...ARGS, '--model', model], { cwd: os.tmpdir(), stdio: ['pipe', 'pipe', 'pipe'] });
    let text = '';
    let buf = '';
    let errors = '';
    let result = null;
    let usedModel = model;
    const stop = () => child.kill();
    signal?.addEventListener('abort', stop, { once: true });

    const take = (j) => {
      if (j.type === 'system' && j.model) usedModel = j.model;
      if (j.type === 'stream_event' && j.event?.type === 'content_block_delta' && j.event.delta?.type === 'text_delta') {
        text += j.event.delta.text;
        onText(j.event.delta.text);
      }
      if (j.type === 'result') result = j;
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      for (let at = buf.indexOf('\n'); at >= 0; at = buf.indexOf('\n')) {
        const line = buf.slice(0, at);
        buf = buf.slice(at + 1);
        try { take(JSON.parse(line)); } catch { /* not a message */ }
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { errors = (errors + chunk).slice(-2000); });
    child.stdin.on('error', () => {});
    child.on('error', () => reject(new Error(NOT_INSTALLED)));
    child.on('close', () => {
      signal?.removeEventListener('abort', stop);
      if (signal?.aborted) { reject(new Error('Stopped.')); return; }
      const said = String(result?.result ?? '');
      if (!result || result.is_error) {
        const detail = said || errors;
        if (/not logged in|\/login|sign in|authenticat/i.test(detail)) reject(new Error(NOT_SIGNED_IN));
        else reject(new Error(`Claude Code stopped with an error${detail.trim() ? `: ${detail.trim().slice(0, 300)}` : '.'}`));
        return;
      }
      if (!text && said) { text = said; onText(said); }
      const cut = result.stop_reason === 'max_tokens';
      resolve({ text, stopReason: result.stop_reason || null, model: usedModel, note: cut ? 'The answer was cut off because it reached the length limit.' : '' });
    });
    child.stdin.end(`${SYSTEM}\n\n${content}`);
  });
}

/** Add the connector to Claude Code for this user, replacing any earlier entry. */
function addConnector({ spawn, bin, name, entry }) {
  const run = (args) => new Promise((resolve) => {
    const child = launch(spawn, bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (c) => { err += c; });
    child.on('error', () => resolve({ code: 1, err: NOT_INSTALLED }));
    child.on('close', (code) => resolve({ code, err }));
  });
  if (!bin) return Promise.resolve({ error: NOT_INSTALLED });
  const env = Object.entries(entry.env).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
  return run(['mcp', 'remove', '--scope', 'user', name])
    .then(() => run(['mcp', 'add', '--scope', 'user', name, ...env, '--', entry.command, ...entry.args]))
    .then(({ code, err }) => (code ? { error: `Claude Code couldn’t add the connector: ${err.trim().slice(0, 300)}` } : {}));
}

/** File → Open Folder in Claude Code: a terminal in that folder, running Claude Code. */
function openTerminal({ spawn, bin, dir, platform = process.platform }) {
  const detached = { cwd: dir, detached: true, stdio: 'ignore' };
  let child;
  if (platform === 'win32') {
    child = spawn('cmd.exe', ['/c', 'start', 'Claude Code', 'cmd.exe', '/k', quoted(bin)], { ...detached, windowsVerbatimArguments: true });
  } else if (platform === 'darwin') {
    const q = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
    const line = `cd ${q(dir)} && ${q(bin)}`.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    child = spawn('osascript', ['-e', `tell application "Terminal" to do script "${line}"`, '-e', 'tell application "Terminal" to activate'], detached);
  } else {
    child = spawn('x-terminal-emulator', ['-e', bin], detached);
  }
  child.on('error', () => {});
  child.unref();
}

module.exports = { MODELS, DEFAULT_MODEL, NOT_INSTALLED, NOT_SIGNED_IN, findClaude, launch, runClaudeCode, addConnector, openTerminal };
