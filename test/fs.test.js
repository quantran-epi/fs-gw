import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createGatewayServer } from '../src/server.js';
import { Router } from '../src/router.js';
import { registerFsRoutes } from '../src/routes/fs.route.js';

describe('FS Route Endpoints Integration', () => {
  let server;
  let port;
  const testTmpDir = path.resolve('test-tmp-e2e-fs');

  before(async () => {
    await fs.mkdir(testTmpDir, { recursive: true });
    const router = new Router();
    registerFsRoutes(router);
    server = createGatewayServer(router);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(testTmpDir, { recursive: true, force: true });
  });

  test('POST /fs/write followed by POST /fs/read returns exact text content and metadata', async () => {
    const targetFile = path.join(testTmpDir, 'notes.txt');
    const writeRes = await fetch(`http://127.0.0.1:${port}/fs/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: targetFile, content: 'Hello Tauri Gateway' })
    });
    assert.equal(writeRes.status, 200);
    const writeBody = await writeRes.json();
    assert.equal(writeBody.ok, true);
    assert.equal(writeBody.data.path, targetFile);
    assert.equal(writeBody.data.bytesWritten, Buffer.byteLength('Hello Tauri Gateway'));

    const readRes = await fetch(`http://127.0.0.1:${port}/fs/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: targetFile })
    });
    assert.equal(readRes.status, 200);
    const readBody = await readRes.json();
    assert.equal(readBody.ok, true);
    assert.equal(readBody.data.content, 'Hello Tauri Gateway');
    assert.equal(readBody.data.size, Buffer.byteLength('Hello Tauri Gateway'));
    assert.equal(readBody.data.mime, 'text/plain; charset=utf-8');
  });

  test('POST /fs/write and POST /fs/read with Base64 encoding handle binary payload', async () => {
    const binaryFile = path.join(testTmpDir, 'nested', 'image.png');
    const originalBuf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const base64Data = originalBuf.toString('base64');

    const writeRes = await fetch(`http://127.0.0.1:${port}/fs/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: binaryFile,
        content: base64Data,
        encoding: 'base64'
      })
    });
    assert.equal(writeRes.status, 200);
    const writeBody = await writeRes.json();
    assert.equal(writeBody.ok, true);
    assert.equal(writeBody.data.bytesWritten, 8);

    const readRes = await fetch(`http://127.0.0.1:${port}/fs/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: binaryFile,
        encoding: 'base64'
      })
    });
    assert.equal(readRes.status, 200);
    const readBody = await readRes.json();
    assert.equal(readBody.ok, true);
    assert.equal(readBody.data.content, base64Data);
    assert.equal(readBody.data.size, 8);
    assert.equal(readBody.data.mime, 'image/png');
  });

  test('POST /fs/stat returns exists: true for existing file and exists: false for non-existent path', async () => {
    const existingFile = path.join(testTmpDir, 'notes.txt');
    const resExisting = await fetch(`http://127.0.0.1:${port}/fs/stat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: existingFile })
    });
    assert.equal(resExisting.status, 200);
    const bodyExisting = await resExisting.json();
    assert.equal(bodyExisting.ok, true);
    assert.equal(bodyExisting.data.exists, true);
    assert.equal(bodyExisting.data.isFile, true);
    assert.equal(bodyExisting.data.isDirectory, false);

    const missingPath = path.join(testTmpDir, 'does-not-exist.txt');
    const resMissing = await fetch(`http://127.0.0.1:${port}/fs/stat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: missingPath })
    });
    assert.equal(resMissing.status, 200);
    const bodyMissing = await resMissing.json();
    assert.equal(bodyMissing.ok, true);
    assert.equal(bodyMissing.data.exists, false);
  });

  test('POST /fs/mkdir creates directories and POST /fs/list enumerates directory contents', async () => {
    const subDir = path.join(testTmpDir, 'folder1', 'subfolder');
    const mkdirRes = await fetch(`http://127.0.0.1:${port}/fs/mkdir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: subDir })
    });
    assert.equal(mkdirRes.status, 200);
    const mkdirBody = await mkdirRes.json();
    assert.equal(mkdirBody.ok, true);
    assert.equal(mkdirBody.data.created, true);

    // Create a child file inside subfolder
    const childFile = path.join(subDir, 'child.json');
    await fetch(`http://127.0.0.1:${port}/fs/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: childFile, content: '{"key": "value"}' })
    });

    const listRes = await fetch(`http://127.0.0.1:${port}/fs/list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: subDir })
    });
    assert.equal(listRes.status, 200);
    const listBody = await listRes.json();
    assert.equal(listBody.ok, true);
    assert.ok(Array.isArray(listBody.data.entries));
    assert.equal(listBody.data.entries.length, 1);
    assert.equal(listBody.data.entries[0].name, 'child.json');
    assert.equal(listBody.data.entries[0].isFile, true);
  });

  test('POST /fs/delete recursively deletes folder and contents', async () => {
    const folderToDelete = path.join(testTmpDir, 'folder1');
    const deleteRes = await fetch(`http://127.0.0.1:${port}/fs/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: folderToDelete })
    });
    assert.equal(deleteRes.status, 200);
    const deleteBody = await deleteRes.json();
    assert.equal(deleteBody.ok, true);
    assert.equal(deleteBody.data.deleted, true);

    const statRes = await fetch(`http://127.0.0.1:${port}/fs/stat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: folderToDelete })
    });
    const statBody = await statRes.json();
    assert.equal(statBody.data.exists, false);
  });

  test('Invalid paths and DOS device names return 400 with standard error envelope', async () => {
    const dosRes = await fetch(`http://127.0.0.1:${port}/fs/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'C:\\test\\CON.txt', content: 'test' })
    });
    assert.equal(dosRes.status, 400);
    const dosBody = await dosRes.json();
    assert.equal(dosBody.ok, false);
    assert.equal(dosBody.code, 'ERR_RESERVED_DEVICE');

    const streamRes = await fetch(`http://127.0.0.1:${port}/fs/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'C:\\test\\file.txt:hidden' })
    });
    assert.equal(streamRes.status, 400);
    const streamBody = await streamRes.json();
    assert.equal(streamBody.ok, false);
    assert.equal(streamBody.code, 'ERR_FORBIDDEN_STREAM');
  });

  test('POST /fs/read on missing file returns 404 with ERR_NOT_FOUND', async () => {
    const missingRes = await fetch(`http://127.0.0.1:${port}/fs/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: path.join(testTmpDir, 'absent.txt') })
    });
    assert.equal(missingRes.status, 404);
    const missingBody = await missingRes.json();
    assert.equal(missingBody.ok, false);
    assert.equal(missingBody.code, 'ERR_NOT_FOUND');
  });
});
