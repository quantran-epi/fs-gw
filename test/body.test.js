import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readJsonBody } from '../src/middleware/body.js';
import { AppError } from '../src/utils/errors.js';

describe('Bounded JSON Body Parser', () => {
  test('Valid JSON payload parses correctly', async () => {
    const payload = JSON.stringify({ foo: 'bar', count: 42 });
    const stream = Readable.from([Buffer.from(payload)]);

    const result = await readJsonBody(stream);
    assert.deepEqual(result, { foo: 'bar', count: 42 });
  });

  test('Empty payload returns empty object', async () => {
    const stream = Readable.from([]);
    const result = await readJsonBody(stream);
    assert.deepEqual(result, {});
  });

  test('Malformed JSON payload throws AppError 400 with ERR_INVALID_JSON', async () => {
    const malformed = '{ broken: ';
    const stream = Readable.from([Buffer.from(malformed)]);

    await assert.rejects(
      async () => {
        await readJsonBody(stream);
      },
      (err) => {
        assert.ok(err instanceof AppError || err.name === 'AppError');
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, 'ERR_INVALID_JSON');
        assert.match(err.message, /Malformed JSON/);
        return true;
      }
    );
  });

  test('Payload exceeding size limit throws AppError 413 with ERR_PAYLOAD_TOO_LARGE', async () => {
    const maxBytes = 100;
    const oversized = Buffer.alloc(101, 'a');
    const stream = Readable.from([oversized]);

    await assert.rejects(
      async () => {
        await readJsonBody(stream, maxBytes);
      },
      (err) => {
        assert.ok(err instanceof AppError || err.name === 'AppError');
        assert.equal(err.statusCode, 413);
        assert.equal(err.code, 'ERR_PAYLOAD_TOO_LARGE');
        return true;
      }
    );
  });
});
