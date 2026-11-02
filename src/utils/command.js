import { AppError } from './errors.js';
import { sanitizePath } from './path.js';

export function validateExecInput(body) {
  if (!body || typeof body !== 'object') {
    throw new AppError('Request body must be a JSON object', 400, 'ERR_INVALID_BODY');
  }

  const { command, args = [], cwd, env = {}, timeout = 60000, shell = false } = body;

  if (typeof command !== 'string' || command.trim().length === 0) {
    throw new AppError('Field "command" must be a non-empty string', 400, 'ERR_INVALID_COMMAND');
  }

  // Reject ASCII control characters (< 32)
  for (let i = 0; i < command.length; i++) {
    if (command.charCodeAt(i) < 32) {
      throw new AppError('Field "command" contains invalid control characters', 400, 'ERR_INVALID_COMMAND');
    }
  }

  if (!Array.isArray(args) || !args.every(a => typeof a === 'string' || typeof a === 'number')) {
    throw new AppError('Field "args" must be an array of strings or numbers', 400, 'ERR_INVALID_ARGS');
  }

  let sanitizedCwd;
  if (cwd !== undefined && cwd !== null) {
    sanitizedCwd = sanitizePath(cwd);
  }

  if (typeof env !== 'object' || Array.isArray(env) || env === null) {
    throw new AppError('Field "env" must be an object of key-value pairs', 400, 'ERR_INVALID_ENV');
  }

  const parsedTimeout = Number(timeout);
  if (isNaN(parsedTimeout) || parsedTimeout < 0 || parsedTimeout > 600000) {
    throw new AppError('Field "timeout" must be a number between 0 and 600000ms', 400, 'ERR_INVALID_TIMEOUT');
  }

  return {
    command: command.trim(),
    args: args.map(String),
    cwd: sanitizedCwd,
    env,
    timeout: parsedTimeout,
    shell: Boolean(shell)
  };
}
