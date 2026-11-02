import path from 'node:path';
import { AppError } from './errors.js';

const DOS_DEVICE_REGEX = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i;

export function sanitizePath(inputPath) {
  if (typeof inputPath !== 'string' || inputPath.trim() === '') {
    throw new AppError('Path must be a non-empty string', 400, 'ERR_INVALID_PATH');
  }

  // Control characters check (0-31)
  for (let i = 0; i < inputPath.length; i++) {
    if (inputPath.charCodeAt(i) < 32) {
      throw new AppError('Path contains invalid control characters', 400, 'ERR_INVALID_PATH');
    }
  }

  // NTFS ADS check (colon after drive letter)
  const withoutDrive = inputPath.replace(/^[a-zA-Z]:/, '');
  if (withoutDrive.includes(':')) {
    throw new AppError('Path contains forbidden stream specifier', 400, 'ERR_FORBIDDEN_STREAM');
  }

  // Windows DOS device check on all segments
  const segments = inputPath.split(/[/\\]/);
  for (const segment of segments) {
    if (DOS_DEVICE_REGEX.test(segment)) {
      throw new AppError(`Path references reserved device name: ${segment}`, 400, 'ERR_RESERVED_DEVICE');
    }
  }

  return path.resolve(inputPath);
}
