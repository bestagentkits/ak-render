/**
 * Minimal MCP client for the harness: spawns `ak-render mcp` and speaks
 * newline-delimited JSON-RPC over its stdio, the same transport a real agent
 * host uses. The server's own `instructions` and `tools/list` are what the
 * model sees, so the benchmark measures the shipped surface, not a copy of it.
 */

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const PROTOCOL_VERSION = '2025-11-25';
const CALL_TIMEOUT_MS = 60_000;
const KILL_GRACE_MS = 2000;

export async function startMcpServer({ cli, cwd, env }) {
  const child = spawn(process.execPath, [cli, 'mcp'], {
    cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const pending = new Map();
  let nextId = 1;
  let stderr = '';
  let exited = false;
  const failAll = (error) => {
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    pending.clear();
  };
  // A failed spawn or a write to a dead server must fail the run, not crash
  // the harness and lose every run already measured.
  child.on('error', (error) => {
    // A spawn that never started emits no 'exit'; nothing is left to close.
    if (child.pid === undefined) exited = true;
    failAll(new Error(`mcp server: ${error.message}`));
  });
  child.stdin.on('error', (error) => failAll(new Error(`mcp server stdin: ${error.message}`)));
  child.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk).slice(-4000);
  });
  createInterface({ input: child.stdout }).on('line', (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    const waiter = pending.get(message.id);
    if (waiter === undefined) return;
    pending.delete(message.id);
    clearTimeout(waiter.timer);
    if (message.error) waiter.reject(new Error(`${message.error.code}: ${message.error.message}`));
    else waiter.resolve(message.result);
  });
  child.on('exit', (code, signal) => {
    exited = true;
    failAll(new Error(`mcp server exited (${code ?? signal}): ${stderr.trim()}`));
  });

  const close = () =>
    new Promise((resolve) => {
      if (exited) return resolve();
      child.once('exit', () => resolve());
      child.stdin.end();
      setTimeout(() => {
        if (!exited) child.kill('SIGTERM');
      }, KILL_GRACE_MS).unref();
      setTimeout(() => {
        if (!exited) child.kill('SIGKILL');
      }, 2 * KILL_GRACE_MS).unref();
    });

  const request = (method, params) =>
    new Promise((resolve, reject) => {
      if (exited) return reject(new Error(`mcp server exited: ${stderr.trim()}`));
      const id = nextId;
      nextId += 1;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`mcp ${method} timed out after ${CALL_TIMEOUT_MS} ms`));
      }, CALL_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });

  let initialized;
  let tools;
  try {
    initialized = await request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'ak-render-agent-ab', version: '1' },
    });
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`,
    );
    ({ tools } = await request('tools/list', {}));
  } catch (error) {
    await close();
    throw error;
  }

  return {
    instructions: initialized.instructions ?? '',
    serverVersion: initialized.serverInfo?.version,
    tools,
    callTool: (name, args) => request('tools/call', { name, arguments: args }),
    close,
  };
}

/** The text of a tool result, joined across content parts. */
export const resultText = (result) =>
  (result?.content ?? [])
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
