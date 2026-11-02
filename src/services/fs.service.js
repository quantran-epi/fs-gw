import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { AppError } from '../utils/errors.js';
import { getMimeHint } from '../utils/mime.js';

export async function readFileContent(resolvedPath, encoding = 'utf8') {
  try {
    const stat = await fs.stat(resolvedPath);
    if (!stat.isFile()) {
      throw new AppError(`Path is not a file: ${resolvedPath}`, 400, 'ERR_NOT_A_FILE');
    }

    const content = await fs.readFile(resolvedPath, encoding === 'base64' ? 'base64' : 'utf8');
    return {
      content,
      size: stat.size,
      encoding,
      mime: getMimeHint(resolvedPath)
    };
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new AppError(`File not found: ${resolvedPath}`, 404, 'ERR_NOT_FOUND');
    }
    if (err instanceof AppError) throw err;
    throw new AppError(err.message, 500, err.code || 'ERR_FS_READ');
  }
}

export async function atomicWriteFile(targetPath, content, encoding = 'utf8', atomic = true) {
  const dir = path.dirname(targetPath);
  await fs.mkdir(dir, { recursive: true });

  const buffer = encoding === 'base64' ? Buffer.from(content, 'base64') : Buffer.from(content, 'utf8');

  if (!atomic) {
    await fs.writeFile(targetPath, buffer);
    return { path: targetPath, bytesWritten: buffer.length };
  }

  // Co-located temp file to prevent EXDEV cross-device errors
  const baseName = path.basename(targetPath);
  const tempPath = path.join(dir, `.${baseName}.${crypto.randomBytes(6).toString('hex')}.tmp`);

  try {
    await fs.writeFile(tempPath, buffer);
    try {
      await fs.rename(tempPath, targetPath);
    } catch (renameErr) {
      if (renameErr.code === 'EPERM' || renameErr.code === 'EBUSY') {
        // Fallback for Windows momentary lock
        await new Promise((r) => setTimeout(r, 25));
        try {
          await fs.rename(tempPath, targetPath);
        } catch {
          await fs.copyFile(tempPath, targetPath);
        }
      } else {
        throw renameErr;
      }
    }
    return { path: targetPath, bytesWritten: buffer.length };
  } finally {
    await fs.unlink(tempPath).catch(() => {});
  }
}

export async function statPath(resolvedPath) {
  try {
    const stat = await fs.stat(resolvedPath);
    return {
      exists: true,
      isFile: stat.isFile(),
      isDirectory: stat.isDirectory(),
      isSymbolicLink: stat.isSymbolicLink(),
      size: stat.size,
      mtime: stat.mtimeMs,
      birthtime: stat.birthtimeMs
    };
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') {
      return { exists: false };
    }
    throw new AppError(err.message, 500, err.code || 'ERR_FS_STAT');
  }
}

export async function listDirectory(resolvedPath) {
  try {
    const dirents = await fs.readdir(resolvedPath, { withFileTypes: true });
    const entries = dirents.map((d) => ({
      name: d.name,
      isFile: d.isFile(),
      isDirectory: d.isDirectory(),
      isSymbolicLink: d.isSymbolicLink()
    }));
    return { entries };
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new AppError(`Directory not found: ${resolvedPath}`, 404, 'ERR_NOT_FOUND');
    }
    if (err.code === 'ENOTDIR') {
      throw new AppError(`Path is not a directory: ${resolvedPath}`, 400, 'ERR_NOT_A_DIRECTORY');
    }
    throw new AppError(err.message, 500, err.code || 'ERR_FS_LIST');
  }
}

export async function makeDirectory(resolvedPath) {
  try {
    await fs.mkdir(resolvedPath, { recursive: true });
    return { created: true, path: resolvedPath };
  } catch (err) {
    throw new AppError(err.message, 500, err.code || 'ERR_FS_MKDIR');
  }
}

export async function deletePath(resolvedPath) {
  try {
    await fs.rm(resolvedPath, { recursive: true, force: true });
    return { deleted: true, path: resolvedPath };
  } catch (err) {
    throw new AppError(err.message, 500, err.code || 'ERR_FS_DELETE');
  }
}
