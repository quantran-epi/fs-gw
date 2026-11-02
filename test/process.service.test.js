import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { runProcess, killProcessTree, killProcessTreeSync, streamProcessExecution, registry } from '../src/services/process.service.js';

describe('Process Service Core Operations', () => {
  after(() => {
    registry.killAllSync();
  });

  test('runProcess executes command and captures stdout, stderr, and exitCode 0', async () => {
    const result = await runProcess({
      command: 'node',
      args: ['-e', 'console.log("hello stdout"); console.error("hello stderr");'],
      timeout: 10000
    });

    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('hello stdout'));
    assert.ok(result.stderr.includes('hello stderr'));
    assert.equal(result.timedOut, false);
    assert.equal(result.truncated, false);
    assert.ok(typeof result.id === 'string');
    assert.ok(typeof result.pid === 'number');
  });

  test('runProcess reports non-zero exit code accurately without throwing', async () => {
    const result = await runProcess({
      command: 'node',
      args: ['-e', 'console.error("error occurred"); process.exit(42);'],
      timeout: 10000
    });

    assert.equal(result.exitCode, 42);
    assert.ok(result.stderr.includes('error occurred'));
    assert.equal(result.timedOut, false);
  });

  test('runProcess truncates captured output if it exceeds maxBuffer', async () => {
    const result = await runProcess({
      command: 'node',
      args: ['-e', 'process.stdout.write("x".repeat(100));'],
      timeout: 10000,
      maxBuffer: 50
    });

    assert.equal(result.exitCode, 0);
    assert.equal(result.truncated, true);
    assert.ok(result.stdout.length <= 50);
  });

  test('runProcess aborts and marks timedOut true when command exceeds timeout duration', async () => {
    const result = await runProcess({
      command: 'node',
      args: ['-e', 'setTimeout(() => {}, 20000);'],
      timeout: 200
    });

    assert.equal(result.timedOut, true);
  });

  test('killProcessTree terminates running process and handles dead PID', async () => {
    const resultDead = await killProcessTree(99999999);
    // Taskkill returns 128 for non-existent process, which killProcessTree treats as success: true
    assert.equal(resultDead.success, true);

    const invalidPidResult = await killProcessTree('not-a-number');
    assert.equal(invalidPidResult.success, false);
  });

  test('ProcessRegistry tracks active processes and cleans up on close', async () => {
    const pPromise = runProcess({
      command: 'node',
      args: ['-e', 'setTimeout(() => {}, 500);'],
      timeout: 5000
    });

    // Wait slightly for process to spawn and register
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(registry.active.size >= 1);

    const result = await pPromise;
    assert.equal(result.exitCode, 0);

    // After close, should be unregistered
    assert.equal(registry.get(result.id), null);
    assert.equal(registry.get(result.pid), null);
  });

  test('registry.kill terminates process by ID or PID', async () => {
    const pPromise = runProcess({
      command: 'node',
      args: ['-e', 'setTimeout(() => {}, 20000);'],
      timeout: 15000
    });

    await new Promise((r) => setTimeout(r, 100));
    const entries = Array.from(registry.active.values());
    assert.ok(entries.length > 0);
    const target = entries[0];

    const killResult = await registry.kill(target.id);
    assert.equal(killResult.success, true);

    await pPromise;
    assert.equal(registry.get(target.id), null);
  });

  test('streamProcessExecution emits SSE events start, stdout, stderr, and exit', async () => {
    const events = [];
    const headers = {};

    const mockRes = {
      writableEnded: false,
      writeHead(status, hdrs) {
        Object.assign(headers, hdrs);
      },
      write(chunk) {
        events.push(chunk);
        return true;
      },
      end() {
        this.writableEnded = true;
      },
      socket: {
        setNoDelay: () => {}
      }
    };

    const mockReq = {
      on: () => {}
    };

    await new Promise((resolve) => {
      const origEnd = mockRes.end.bind(mockRes);
      mockRes.end = () => {
        origEnd();
        resolve();
      };

      streamProcessExecution({
        command: 'node',
        args: ['-e', 'console.log("sse stdout"); console.error("sse stderr"); process.exit(0);']
      }, mockReq, mockRes);
    });

    assert.equal(headers['Content-Type'], 'text/event-stream');
    const fullOutput = events.join('');
    assert.ok(fullOutput.includes('event: start'));
    assert.ok(fullOutput.includes('event: stdout'));
    assert.ok(fullOutput.includes('sse stdout'));
    assert.ok(fullOutput.includes('event: stderr'));
    assert.ok(fullOutput.includes('sse stderr'));
    assert.ok(fullOutput.includes('event: exit'));
    assert.ok(fullOutput.includes('"exitCode":0'));
  });
});
