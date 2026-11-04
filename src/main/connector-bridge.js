'use strict';
// The program Claude Desktop and Claude Code start to reach RT Markdown Reader (3.4). It speaks MCP
// (JSON-RPC, one message per line) on stdin and stdout, and passes tool calls to the running app, which
// does all the work: see connector.js. Run as plain Node (ELECTRON_RUN_AS_NODE), so it mustn't use Electron.
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const readline = require('node:readline');

const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const NOT_RUNNING = 'RT Markdown Reader isn’t reachable. Open the app and turn on Connect Claude under Edit → AI Assist.';

const pathArg = { path: { type: 'string', description: 'The document’s full path, as list_documents shows it.' } };
const TOOLS = [
  {
    name: 'list_documents',
    description: 'List the Markdown documents open in RT Markdown Reader, and the documents in its open folders. Password-locked documents are never listed.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'read_document',
    description: 'Read a document’s saved text. It must be open in the app or in an open folder.',
    inputSchema: { type: 'object', properties: pathArg, required: ['path'] },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'search_folder',
    description: 'Search the documents in the folders open in the app for words or a phrase.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'The words to look for.' } }, required: ['query'] },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'get_highlights',
    description: 'Get the highlights and notes the person has made on a document.',
    inputSchema: { type: 'object', properties: pathArg, required: ['path'] },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'suggest_edit',
    description: 'Suggest a change to a document. The person sees it in the app as a marked-up change and accepts or rejects it; nothing changes without their yes. old_text must be copied exactly from the document and appear in it only once.',
    inputSchema: {
      type: 'object',
      properties: {
        ...pathArg,
        old_text: { type: 'string', description: 'The text to replace, copied exactly.' },
        new_text: { type: 'string', description: 'The text to put in its place.' },
        note: { type: 'string', description: 'A short reason for the change, shown to the person.' },
      },
      required: ['path', 'old_text', 'new_text'],
    },
  },
];

function version() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')).version; } catch { return '0.0.0'; }
}

/** Ask the running app; one short connection per call. */
function askApp(dir, method, params) {
  return new Promise((resolve, reject) => {
    let info;
    try { info = JSON.parse(fs.readFileSync(path.join(dir, 'connector.json'), 'utf8')); } catch { reject(new Error(NOT_RUNNING)); return; }
    let buf = '';
    let settled = false;
    const finish = (fn, v) => { if (settled) return; settled = true; sock.destroy(); fn(v); };
    const sock = net.connect(info.endpoint, () => sock.write(`${JSON.stringify({ token: info.token, id: 1, method, params })}\n`));
    sock.setEncoding('utf8');
    sock.on('error', () => finish(reject, new Error(NOT_RUNNING)));
    sock.on('close', () => finish(reject, new Error(NOT_RUNNING)));
    sock.on('data', (chunk) => {
      buf += chunk;
      const at = buf.indexOf('\n');
      if (at < 0) return;
      let reply;
      try { reply = JSON.parse(buf.slice(0, at)); } catch { finish(reject, new Error(NOT_RUNNING)); return; }
      if (reply.error) finish(reject, new Error(reply.error));
      else finish(resolve, reply.result);
    });
  });
}

/** The answer to one JSON-RPC request, or null for a notification. */
async function respond(msg, ask) {
  const { id, method, params } = msg;
  if (id === undefined || id === null) return null;
  const ok = (result) => ({ jsonrpc: '2.0', id, result });
  switch (method) {
    case 'initialize':
      return ok({
        protocolVersion: PROTOCOLS.includes(params?.protocolVersion) ? params.protocolVersion : PROTOCOLS[1],
        capabilities: { tools: {} },
        serverInfo: { name: 'rt-markdown-reader', title: 'RT Markdown Reader', version: version() },
      });
    case 'ping': return ok({});
    case 'tools/list': return ok({ tools: TOOLS });
    case 'tools/call':
      try {
        const result = await ask(params?.name, params?.arguments || {});
        return ok({ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
      } catch (err) {
        return ok({ content: [{ type: 'text', text: err.message }], isError: true });
      }
    default:
      return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } };
  }
}

function main() {
  const at = process.argv.indexOf('--dir');
  const dir = at > 0 ? process.argv[at + 1] : '';
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', async (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch {
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`);
      return;
    }
    const reply = await respond(msg, (name, args) => askApp(dir, name, args));
    if (reply) process.stdout.write(`${JSON.stringify(reply)}\n`);
  });
  rl.on('close', () => process.exit(0));
}

if (require.main === module) main();

module.exports = { TOOLS, PROTOCOLS, respond };
