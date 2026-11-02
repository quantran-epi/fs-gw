import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createGatewayServer } from '../src/server.js';
import { Router } from '../src/router.js';

describe('CORS Middleware Integration', () => {
  let server;
  let port;

  before(async () => {
    const router = new Router();
    router.register('GET', '/test', (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    server = createGatewayServer(router);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  test('OPTIONS preflight with Vite localhost origin returns 204 and CORS headers', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/test`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5173',
        'Access-Control-Request-Method': 'POST'
      }
    });

    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    assert.ok(res.headers.get('access-control-allow-methods').includes('OPTIONS'));
    assert.ok(res.headers.get('access-control-allow-methods').includes('GET'));
    assert.ok(res.headers.get('access-control-allow-methods').includes('POST'));
    assert.ok(res.headers.get('access-control-allow-headers').includes('Content-Type'));
  });

  test('OPTIONS preflight with Tauri origin returns 204 and CORS headers', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/test`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'tauri://localhost'
      }
    });

    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), 'tauri://localhost');
  });

  test('OPTIONS preflight with 127.0.0.1 origin returns 204 and CORS headers', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/test`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://127.0.0.1:3000'
      }
    });

    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), 'http://127.0.0.1:3000');
  });

  test('Request with unauthorized origin does not receive Access-Control-Allow-Origin', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/test`, {
      method: 'GET',
      headers: {
        Origin: 'https://malicious-website.com'
      }
    });

    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), null);
  });
});
