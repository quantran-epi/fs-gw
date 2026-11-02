import { CONFIG } from '../config.js';
import { AppError } from '../utils/errors.js';

export async function readJsonBody(req, maxBytes = CONFIG.maxBodySize || 10 * 1024 * 1024) {
  let totalBytes = 0;
  const chunks = [];

  for await (const chunk of req) {
    totalBytes += chunk.length;
    if (totalBytes > maxBytes) {
      if (!req.destroyed && typeof req.destroy === 'function') {
        req.destroy();
      }
      throw new AppError('Payload Too Large: exceeds 10MB limit', 413, 'ERR_PAYLOAD_TOO_LARGE');
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(raw);
  } catch (parseErr) {
    throw new AppError(`Malformed JSON payload: ${parseErr.message}`, 400, 'ERR_INVALID_JSON');
  }
}
