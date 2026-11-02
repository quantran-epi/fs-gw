import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  readFileContent,
  atomicWriteFile,
  statPath,
  listDirectory,
  makeDirectory,
  deletePath
} from '../src/services/fs.service.js';
import { AppError } from '../src/utils/errors.js';

describe('Filesystem Service Core Operations', () => {
  const testDir = path.resolve('test-tmp-fs-service');

  before(async () => {
    await fs.mkdir(testDir, { recursive: true });
  });

  after(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('atomicWriteFile and readFileContent', () => {
    test('Writes UTF-8 text atomically and creates nested parent directories', async () => {
      const nestedFile = path.join(testDir, 'nested', 'deep', 'hello.txt');
      const writeRes = await atomicWriteFile(nestedFile, 'Hello World', 'utf8', true);
      assert.equal(writeRes.path, nestedFile);
      assert.equal(writeRes.bytesWritten, 11);

      const readRes = await readFileContent(nestedFile, 'utf8');
      assert.equal(readRes.content, 'Hello World');
      assert.equal(readRes.size, 11);
      assert.equal(readRes.encoding, 'utf8');
      assert.equal(readRes.mime, 'text/plain; charset=utf-8');

      // Verify no temporary files remain
      const dirFiles = await fs.readdir(path.dirname(nestedFile));
      assert.deepEqual(dirFiles, ['hello.txt']);
    });

    test('Writes Base64 binary and reads back as base64', async () => {
      const binFile = path.join(testDir, 'data.bin');
      const sampleBase64 = Buffer.from([0x01, 0x02, 0x03, 0x04]).toString('base64');
      const writeRes = await atomicWriteFile(binFile, sampleBase64, 'base64', true);
      assert.equal(writeRes.bytesWritten, 4);

      const readRes = await readFileContent(binFile, 'base64');
      assert.equal(readRes.content, sampleBase64);
      assert.equal(readRes.size, 4);
      assert.equal(readRes.encoding, 'base64');
      assert.equal(readRes.mime, 'application/octet-stream');
    });

    test('Non-atomic write writes directly', async () => {
      const directFile = path.join(testDir, 'direct.txt');
      const writeRes = await atomicWriteFile(directFile, 'Direct Content', 'utf8', false);
      assert.equal(writeRes.bytesWritten, 14);

      const readRes = await readFileContent(directFile);
      assert.equal(readRes.content, 'Direct Content');
    });

    test('readFileContent throws 404 ERR_NOT_FOUND when file does not exist', async () => {
      const missingFile = path.join(testDir, 'does-not-exist.txt');
      await assert.rejects(
        async () => readFileContent(missingFile),
        (err) => {
          assert.ok(err instanceof AppError);
          assert.equal(err.statusCode, 404);
          assert.equal(err.code, 'ERR_NOT_FOUND');
          return true;
        }
      );
    });

    test('readFileContent throws 400 ERR_NOT_A_FILE when target is a directory', async () => {
      await assert.rejects(
        async () => readFileContent(testDir),
        (err) => {
          assert.ok(err instanceof AppError);
          assert.equal(err.statusCode, 400);
          assert.equal(err.code, 'ERR_NOT_A_FILE');
          return true;
        }
      );
    });
  });

  describe('statPath', () => {
    test('Returns exists: false without throwing for missing path', async () => {
      const missing = path.join(testDir, 'no-such-path');
      const res = await statPath(missing);
      assert.deepEqual(res, { exists: false });
    });

    test('Returns file metadata for existing file', async () => {
      const target = path.join(testDir, 'stat-test.txt');
      await fs.writeFile(target, 'test data');

      const res = await statPath(target);
      assert.equal(res.exists, true);
      assert.equal(res.isFile, true);
      assert.equal(res.isDirectory, false);
      assert.equal(res.isSymbolicLink, false);
      assert.equal(res.size, 9);
      assert.ok(typeof res.mtime === 'number');
      assert.ok(typeof res.birthtime === 'number');
    });

    test('Returns directory metadata for existing directory', async () => {
      const res = await statPath(testDir);
      assert.equal(res.exists, true);
      assert.equal(res.isFile, false);
      assert.equal(res.isDirectory, true);
    });
  });

  describe('listDirectory', () => {
    test('Returns directory entries with boolean flags', async () => {
      const listSubdir = path.join(testDir, 'list-dir');
      await fs.mkdir(listSubdir, { recursive: true });
      await fs.writeFile(path.join(listSubdir, 'f1.txt'), '1');
      await fs.mkdir(path.join(listSubdir, 'subfolder'));

      const res = await listDirectory(listSubdir);
      assert.ok(Array.isArray(res.entries));
      assert.equal(res.entries.length, 2);

      const f1 = res.entries.find((e) => e.name === 'f1.txt');
      assert.ok(f1);
      assert.equal(f1.isFile, true);
      assert.equal(f1.isDirectory, false);

      const sub = res.entries.find((e) => e.name === 'subfolder');
      assert.ok(sub);
      assert.equal(sub.isFile, false);
      assert.equal(sub.isDirectory, true);
    });

    test('Throws 404 ERR_NOT_FOUND when directory does not exist', async () => {
      const missingDir = path.join(testDir, 'missing-list-dir');
      await assert.rejects(
        async () => listDirectory(missingDir),
        (err) => {
          assert.ok(err instanceof AppError);
          assert.equal(err.statusCode, 404);
          assert.equal(err.code, 'ERR_NOT_FOUND');
          return true;
        }
      );
    });

    test('Throws 400 ERR_NOT_A_DIRECTORY when path is a file', async () => {
      const targetFile = path.join(testDir, 'not-a-dir.txt');
      await fs.writeFile(targetFile, 'content');
      await assert.rejects(
        async () => listDirectory(targetFile),
        (err) => {
          assert.ok(err instanceof AppError);
          assert.equal(err.statusCode, 400);
          assert.equal(err.code, 'ERR_NOT_A_DIRECTORY');
          return true;
        }
      );
    });
  });

  describe('makeDirectory and deletePath', () => {
    test('makeDirectory creates recursive directories', async () => {
      const target = path.join(testDir, 'a', 'b', 'c');
      const res = await makeDirectory(target);
      assert.equal(res.created, true);
      assert.equal(res.path, target);

      const stat = await fs.stat(target);
      assert.equal(stat.isDirectory(), true);
    });

    test('deletePath removes files and directories recursively and does not throw if missing', async () => {
      const targetDir = path.join(testDir, 'to-delete');
      await fs.mkdir(targetDir, { recursive: true });
      await fs.writeFile(path.join(targetDir, 'temp.txt'), 'temp');

      const delRes = await deletePath(targetDir);
      assert.equal(delRes.deleted, true);
      assert.equal(delRes.path, targetDir);

      const check = await statPath(targetDir);
      assert.equal(check.exists, false);

      // Does not throw if path doesn't exist
      const missingRes = await deletePath(path.join(testDir, 'already-gone'));
      assert.equal(missingRes.deleted, true);
    });
  });
});
