import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createGatewayServer } from '../src/server.js';
import { Router } from '../src/router.js';
import { healthHandler } from '../src/routes/health.route.js';

function makeRawRequest(options) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data ? JSON.parse(data) : null
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

describe('Gateway Server & Security Integration', () => {
  let server;
  let port;

  before(async () => {
    const router = new Router();
    router.register('GET', '/health', healthHandler);
    server = createGatewayServer(router);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  test('GET /health returns 200 with standard envelope', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.data.status, 'ok');
    assert.equal(typeof body.data.uptime, 'number');
    assert.equal(body.data.platform, process.platform);
    assert.equal(body.data.node, process.version);
  });

  test('Request with foreign Host header returns 403 Forbidden', async () => {
    const res = await makeRawRequest({
      hostname: '127.0.0.1',
      port,
      path: '/health',
      method: 'GET',
      headers: { Host: 'evil.attacker.com' }
    });
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.code, 'ERR_FORBIDDEN_HOST');
    assert.equal(res.body.error, 'Forbidden: Invalid Host header');
  });

  test('Request to unregistered route returns 404 Not Found', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/nonexistent`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.code, 'ERR_NOT_FOUND');
  });
});
