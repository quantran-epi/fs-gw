import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { validateExecInput } from '../src/utils/command.js';
import { AppError } from '../src/utils/errors.js';

describe('Command Input Sanitizer & Guardrails', () => {
  test('Valid command and array args return normalized options with default shell false and timeout 60000', () => {
    const input = {
      command: 'git',
      args: ['status', '--short'],
      cwd: 'test/fixtures',
      env: { NODE_ENV: 'test' },
      timeout: 5000,
      shell: false
    };
    const result = validateExecInput(input);
    assert.equal(result.command, 'git');
    assert.deepEqual(result.args, ['status', '--short']);
    assert.equal(result.cwd, path.resolve('test/fixtures'));
    assert.deepEqual(result.env, { NODE_ENV: 'test' });
    assert.equal(result.timeout, 5000);
    assert.equal(result.shell, false);
  });

  test('Defaults applied when optional fields omitted', () => {
    const result = validateExecInput({ command: 'node' });
    assert.equal(result.command, 'node');
    assert.deepEqual(result.args, []);
    assert.equal(result.cwd, undefined);
    assert.deepEqual(result.env, {});
    assert.equal(result.timeout, 60000);
    assert.equal(result.shell, false);
  });

  test('Missing, null, or non-object body throws ERR_INVALID_BODY', () => {
    assert.throws(() => validateExecInput(null), {
      name: 'AppError',
      statusCode: 400,
      code: 'ERR_INVALID_BODY'
    });
    assert.throws(() => validateExecInput(undefined), {
      name: 'AppError',
      statusCode: 400,
      code: 'ERR_INVALID_BODY'
    });
    assert.throws(() => validateExecInput('string'), {
      name: 'AppError',
      statusCode: 400,
      code: 'ERR_INVALID_BODY'
    });
    assert.throws(() => validateExecInput(123), {
      name: 'AppError',
      statusCode: 400,
      code: 'ERR_INVALID_BODY'
    });
  });

  test('Missing, empty, non-string, or control char command throws ERR_INVALID_COMMAND', () => {
    assert.throws(() => validateExecInput({}), {
      name: 'AppError',
      statusCode: 400,
      code: 'ERR_INVALID_COMMAND'
    });
    assert.throws(() => validateExecInput({ command: '' }), {
      name: 'AppError',
      statusCode: 400,
      code: 'ERR_INVALID_COMMAND'
    });
    assert.throws(() => validateExecInput({ command: '   ' }), {
      name: 'AppError',
      statusCode: 400,
      code: 'ERR_INVALID_COMMAND'
    });
    assert.throws(() => validateExecInput({ command: 123 }), {
      name: 'AppError',
      statusCode: 400,
      code: 'ERR_INVALID_COMMAND'
    });
    assert.throws(() => validateExecInput({ command: 'node\x00' }), {
      name: 'AppError',
      statusCode: 400,
      code: 'ERR_INVALID_COMMAND'
    });
    assert.throws(() => validateExecInput({ command: 'git\x1Fstatus' }), {
      name: 'AppError',
      statusCode: 400,
      code: 'ERR_INVALID_COMMAND'
    });
  });

  test('Non-array args or args with invalid types throw ERR_INVALID_ARGS', () => {
    assert.throws(() => validateExecInput({ command: 'node', args: 'not-array' }), {
      name: 'AppError',
      statusCode: 400,
      code: 'ERR_INVALID_ARGS'
    });
    assert.throws(() => validateExecInput({ command: 'node', args: [null] }), {
      name: 'AppError',
      statusCode: 400,
      code: 'ERR_INVALID_ARGS'
    });
    assert.throws(() => validateExecInput({ command: 'node', args: [{}] }), {
      name: 'AppError',
      statusCode: 400,
      code: 'ERR_INVALID_ARGS'
    });
    assert.throws(() => validateExecInput({ command: 'node', args: [true] }), {
      name: 'AppError',
      statusCode: 400,
      code: 'ERR_INVALID_ARGS'
    });
  });

  test('Args with numbers are mapped to strings', () => {
    const result = validateExecInput({ command: 'node', args: ['-p', 123] });
    assert.deepEqual(result.args, ['-p', '123']);
  });

  test('Invalid cwd propagates sanitizePath errors', () => {
    assert.throws(() => validateExecInput({ command: 'node', cwd: 'C:\\con.txt' }), {
      name: 'AppError',
      statusCode: 400,
      code: 'ERR_RESERVED_DEVICE'
    });
    assert.throws(() => validateExecInput({ command: 'node', cwd: 'C:\\safe\\file:stream' }), {
      name: 'AppError',
      statusCode: 400,
      code: 'ERR_FORBIDDEN_STREAM'
    });
    assert.throws(() => validateExecInput({ command: 'node', cwd: 123 }), {
      name: 'AppError',
      statusCode: 400,
      code: 'ERR_INVALID_PATH'
    });
  });

  test('Invalid env throws ERR_INVALID_ENV', () => {
    assert.throws(() => validateExecInput({ command: 'node', env: 'not-object' }), {
      name: 'AppError',
      statusCode: 400,
      code: 'ERR_INVALID_ENV'
    });
    assert.throws(() => validateExecInput({ command: 'node', env: null }), {
      name: 'AppError',
      statusCode: 400,
      code: 'ERR_INVALID_ENV'
    });
    assert.throws(() => validateExecInput({ command: 'node', env: ['array'] }), {
      name: 'AppError',
      statusCode: 400,
      code: 'ERR_INVALID_ENV'
    });
  });

  test('Invalid timeout throws ERR_INVALID_TIMEOUT', () => {
    assert.throws(() => validateExecInput({ command: 'node', timeout: -1 }), {
      name: 'AppError',
      statusCode: 400,
      code: 'ERR_INVALID_TIMEOUT'
    });
    assert.throws(() => validateExecInput({ command: 'node', timeout: 600001 }), {
      name: 'AppError',
      statusCode: 400,
      code: 'ERR_INVALID_TIMEOUT'
    });
    assert.throws(() => validateExecInput({ command: 'node', timeout: 'abc' }), {
      name: 'AppError',
      statusCode: 400,
      code: 'ERR_INVALID_TIMEOUT'
    });
    assert.throws(() => validateExecInput({ command: 'node', timeout: NaN }), {
      name: 'AppError',
      statusCode: 400,
      code: 'ERR_INVALID_TIMEOUT'
    });
  });
});
