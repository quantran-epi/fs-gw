import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createGatewayServer } from '../src/server.js';
import { Router } from '../src/router.js';
import { healthHandler } from '../src/routes/health.route.js';

describe('Gateway Server & Security Integration', () => {
  let server;
  const PORT = 4821;

  before(async () => {
    const router = new Router();
    router.register('GET', '/health', healthHandler);
    server = createGatewayServer(router, { port: PORT });
    await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  test('GET /health returns 200 with standard envelope', async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.data.status, 'ok');
    assert.equal(typeof body.data.uptime, 'number');
    assert.equal(body.data.platform, process.platform);
    assert.equal(body.data.node, process.version);
  });

  test('Request with foreign Host header returns 403 Forbidden', async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/health`, {
      headers: { Host: 'evil.attacker.com' }
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.code, 'ERR_FORBIDDEN_HOST');
    assert.equal(body.error, 'Forbidden: Invalid Host header');
  });

  test('Request to unregistered route returns 404 Not Found', async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/nonexistent`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.code, 'ERR_NOT_FOUND');
  });
});
