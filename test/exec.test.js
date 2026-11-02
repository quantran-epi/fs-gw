import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createGatewayServer } from '../src/server.js';
import { Router } from '../src/router.js';
import { registerExecRoutes } from '../src/routes/exec.route.js';
import { registry } from '../src/services/process.service.js';

describe('Exec Route Endpoints Integration', () => {
  let server;
  let port;

  before(async () => {
    const router = new Router();
    registerExecRoutes(router);
    server = createGatewayServer(router);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
  });

  after(async () => {
    registry.killAllSync();
    await new Promise((resolve) => server.close(resolve));
  });

  test('POST /exec/run executes command and returns standard JSON envelope', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/exec/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command: 'node',
        args: ['-e', 'console.log("integration-exec-ok")']
      })
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.data.exitCode, 0);
    assert.equal(body.data.timedOut, false);
    assert.ok(body.data.stdout.includes('integration-exec-ok'));
  });

  test('POST /exec/run with failing command returns status 200 with non-zero exitCode', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/exec/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command: 'node',
        args: ['-e', 'console.error("error-logged"); process.exit(42)']
      })
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.data.exitCode, 42);
    assert.ok(body.data.stderr.includes('error-logged'));
  });

  test('POST /exec/run validation failures return HTTP 400 standard error envelope', async () => {
    const resEmpty = await fetch(`http://127.0.0.1:${port}/exec/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: '' })
    });
    assert.equal(resEmpty.status, 400);
    const bodyEmpty = await resEmpty.json();
    assert.equal(bodyEmpty.ok, false);
    assert.equal(bodyEmpty.code, 'ERR_INVALID_COMMAND');

    const resBadArgs = await fetch(`http://127.0.0.1:${port}/exec/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'node', args: 'invalid' })
    });
    assert.equal(resBadArgs.status, 400);
    const bodyBadArgs = await resBadArgs.json();
    assert.equal(bodyBadArgs.ok, false);
    assert.equal(bodyBadArgs.code, 'ERR_INVALID_ARGS');
  });

  test('POST /exec/kill terminates a running process hierarchy', async () => {
    // Start long-running process in background stream
    const controller = new AbortController();
    const streamRes = await fetch(`http://127.0.0.1:${port}/exec/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command: 'node',
        args: ['-e', 'setInterval(() => {}, 1000)']
      }),
      signal: controller.signal
    });
    assert.equal(streamRes.status, 200);

    // Read first event chunk to get PID or execution ID
    const reader = streamRes.body.getReader();
    const decoder = new TextDecoder();
    let initialChunk = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      initialChunk += decoder.decode(value, { stream: true });
      if (initialChunk.includes('event: start')) break;
    }

    const match = initialChunk.match(/data:\s*({.*})/);
    assert.ok(match, 'Expected start event data payload');
    const startData = JSON.parse(match[1]);
    assert.ok(startData.pid);
    assert.ok(startData.id);

    // Kill process by ID
    const killRes = await fetch(`http://127.0.0.1:${port}/exec/kill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: startData.id })
    });
    assert.equal(killRes.status, 200);
    const killBody = await killRes.json();
    assert.equal(killBody.ok, true);
    assert.equal(killBody.data.success, true);

    controller.abort();
  });

  test('POST /exec/kill returns 400 when missing target', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/exec/kill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.code, 'ERR_INVALID_TARGET');
  });

  test('GET /exec/stream streams Server-Sent Events from query params', async () => {
    const url = new URL(`http://127.0.0.1:${port}/exec/stream`);
    url.searchParams.set('command', 'node');
    url.searchParams.append('arg', '-e');
    url.searchParams.append('arg', 'console.log("stream-chunk-get")');

    const res = await fetch(url);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/event-stream');

    const text = await res.text();
    assert.ok(text.includes('event: start'));
    assert.ok(text.includes('event: stdout'));
    assert.ok(text.includes('stream-chunk-get'));
    assert.ok(text.includes('event: exit'));
  });

  test('POST /exec/stream streams Server-Sent Events from JSON request body', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/exec/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command: 'node',
        args: ['-e', 'console.log("stream-chunk-post")']
      })
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/event-stream');

    const text = await res.text();
    assert.ok(text.includes('event: start'));
    assert.ok(text.includes('event: stdout'));
    assert.ok(text.includes('stream-chunk-post'));
    assert.ok(text.includes('event: exit'));
  });

  test('Client disconnect during streaming aborts the running process', async () => {
    const payload = JSON.stringify({
      command: 'node',
      args: ['-e', 'setInterval(() => {}, 1000)']
    });

    let pid;
    await new Promise((resolve, reject) => {
      const clientReq = http.request({
        hostname: '127.0.0.1',
        port,
        path: '/exec/stream',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      }, (clientRes) => {
        let chunk = '';
        clientRes.on('data', (d) => {
          chunk += d.toString();
          if (chunk.includes('event: start')) {
            const match = chunk.match(/data:\s*({.*})/);
            if (match) {
              pid = JSON.parse(match[1]).pid;
              // Hard destroy client response stream and request socket
              clientRes.destroy();
              clientReq.destroy();
              resolve();
            }
          }
        });
      });

      clientReq.on('error', () => {
        // Expected on socket destroy
      });

      clientReq.write(payload);
      clientReq.end();
    });

    assert.ok(pid, 'Expected PID to be captured');

    // Wait for taskkill and registry unregister (taskkill spawn can take 1-3s under parallel test load)
    let entry = registry.get(pid);
    for (let i = 0; i < 40 && entry !== null; i++) {
      await new Promise((r) => setTimeout(r, 150));
      entry = registry.get(pid);
    }

    assert.equal(entry, null);
  });
});
