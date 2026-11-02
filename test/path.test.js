import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { sanitizePath } from '../src/utils/path.js';
import { getMimeHint } from '../src/utils/mime.js';
import { AppError } from '../src/utils/errors.js';

describe('Path Sanitizer Guardrails', () => {
  test('Valid path resolves to absolute path', () => {
    const input = 'test/fixtures/file.txt';
    const result = sanitizePath(input);
    assert.equal(result, path.resolve(input));
  });

  test('Valid Windows absolute path resolves cleanly', () => {
    const input = 'C:\\safe\\folder\\file.txt';
    const result = sanitizePath(input);
    assert.equal(result, path.resolve(input));
  });

  test('Empty, non-string, or whitespace path throws ERR_INVALID_PATH', () => {
    assert.throws(() => sanitizePath(''), {
      name: 'AppError',
      statusCode: 400,
      code: 'ERR_INVALID_PATH'
    });
    assert.throws(() => sanitizePath('   '), {
      name: 'AppError',
      statusCode: 400,
      code: 'ERR_INVALID_PATH'
    });
    assert.throws(() => sanitizePath(null), {
      name: 'AppError',
      statusCode: 400,
      code: 'ERR_INVALID_PATH'
    });
    assert.throws(() => sanitizePath(123), {
      name: 'AppError',
      statusCode: 400,
      code: 'ERR_INVALID_PATH'
    });
  });

  test('Path with ASCII control characters throws ERR_INVALID_PATH', () => {
    assert.throws(() => sanitizePath('C:\\safe\\file\x00.txt'), {
      name: 'AppError',
      statusCode: 400,
      code: 'ERR_INVALID_PATH'
    });
    assert.throws(() => sanitizePath('folder/\x1F/bad.txt'), {
      name: 'AppError',
      statusCode: 400,
      code: 'ERR_INVALID_PATH'
    });
  });

  test('DOS device names throw ERR_RESERVED_DEVICE', () => {
    const devices = ['con', 'prn', 'aux', 'nul', 'com1', 'com9', 'lpt1', 'lpt9'];
    for (const dev of devices) {
      assert.throws(() => sanitizePath(`C:\\safe\\${dev}.txt`), {
        name: 'AppError',
        statusCode: 400,
        code: 'ERR_RESERVED_DEVICE'
      });
      assert.throws(() => sanitizePath(`sub/${dev.toUpperCase()}/file`), {
        name: 'AppError',
        statusCode: 400,
        code: 'ERR_RESERVED_DEVICE'
      });
    }
  });

  test('NTFS Alternate Data Stream throws ERR_FORBIDDEN_STREAM', () => {
    assert.throws(() => sanitizePath('C:\\safe\\file.txt:hidden'), {
      name: 'AppError',
      statusCode: 400,
      code: 'ERR_FORBIDDEN_STREAM'
    });
    assert.throws(() => sanitizePath('relative/path.txt:stream:$DATA'), {
      name: 'AppError',
      statusCode: 400,
      code: 'ERR_FORBIDDEN_STREAM'
    });
  });
});

describe('MIME Lookup Utility', () => {
  test('Known extensions return correct MIME types', () => {
    assert.equal(getMimeHint('data.json'), 'application/json; charset=utf-8');
    assert.equal(getMimeHint('README.TXT'), 'text/plain; charset=utf-8');
    assert.equal(getMimeHint('script.js'), 'text/javascript; charset=utf-8');
    assert.equal(getMimeHint('module.mjs'), 'text/javascript; charset=utf-8');
    assert.equal(getMimeHint('index.html'), 'text/html; charset=utf-8');
    assert.equal(getMimeHint('style.css'), 'text/css; charset=utf-8');
    assert.equal(getMimeHint('photo.png'), 'image/png');
    assert.equal(getMimeHint('photo.jpg'), 'image/jpeg');
    assert.equal(getMimeHint('photo.jpeg'), 'image/jpeg');
    assert.equal(getMimeHint('vector.svg'), 'image/svg+xml');
    assert.equal(getMimeHint('doc.pdf'), 'application/pdf');
  });

  test('Unknown or missing extension falls back to application/octet-stream', () => {
    assert.equal(getMimeHint('unknown.xyz'), 'application/octet-stream');
    assert.equal(getMimeHint('noext'), 'application/octet-stream');
    assert.equal(getMimeHint('.hidden'), 'application/octet-stream');
  });
});
