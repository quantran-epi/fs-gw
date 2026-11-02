import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { AppError } from '../utils/errors.js';

/**
 * Terminates an entire Windows process hierarchy via taskkill.exe /pid <PID> /T /F.
 */
export function killProcessTree(pid) {
  return new Promise((resolve) => {
    if (!pid || typeof pid !== 'number') {
      return resolve({ success: false, code: -1, message: 'Invalid PID' });
    }

    const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
    let stderr = '';

    killer.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    killer.on('close', (code) => {
      // 0 = Terminated successfully, 128 = Process not found / already dead
      if (code === 0 || code === 128) {
        resolve({
          success: true,
          code,
          message: code === 128 ? 'Process already terminated' : 'Terminated'
        });
      } else {
        resolve({
          success: false,
          code,
          message: stderr.trim()
        });
      }
    });

    killer.on('error', (err) => {
      resolve({ success: false, code: -1, message: err.message });
    });
  });
}

/**
 * Synchronous process tree termination for gateway exit hooks.
 */
export function killProcessTreeSync(pid) {
  if (!pid || typeof pid !== 'number') return;
  try {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
  } catch {
    // Ignore errors during process exit cleanup
  }
}

/**
 * In-memory registry tracking active processes and handling timeout termination.
 */
export class ProcessRegistry {
  constructor() {
    this.active = new Map();
  }

  register(child, metadata = {}) {
    const id = randomUUID();
    const pid = child.pid;
    let timer = null;

    const entry = {
      id,
      pid,
      child,
      timer: null,
      timedOut: false,
      command: metadata.command,
      startTime: Date.now()
    };

    if (metadata.timeout > 0) {
      timer = setTimeout(async () => {
        const current = this.active.get(id);
        if (current) {
          current.timedOut = true;
          await killProcessTree(pid);
        }
      }, metadata.timeout);
      timer.unref?.();
      entry.timer = timer;
    }

    this.active.set(id, entry);

    child.on('close', () => {
      this.unregister(id);
    });

    return entry;
  }

  unregister(id) {
    const entry = this.active.get(id);
    if (entry) {
      if (entry.timer) clearTimeout(entry.timer);
      this.active.delete(id);
    }
  }

  get(idOrPid) {
    if (typeof idOrPid === 'number') {
      for (const entry of this.active.values()) {
        if (entry.pid === idOrPid) return entry;
      }
      return null;
    }
    return this.active.get(idOrPid) || null;
  }

  async kill(idOrPid) {
    const entry = this.get(idOrPid);
    if (!entry) {
      if (typeof idOrPid === 'number') {
        return await killProcessTree(idOrPid);
      }
      return { success: false, code: 404, message: 'Process not found in registry' };
    }
    const result = await killProcessTree(entry.pid);
    this.unregister(entry.id);
    return result;
  }

  killAllSync() {
    for (const entry of this.active.values()) {
      if (entry.timer) clearTimeout(entry.timer);
      killProcessTreeSync(entry.pid);
    }
    this.active.clear();
  }
}

export const registry = new ProcessRegistry();

/**
 * Spawns a child process, buffers stdout/stderr up to maxBuffer, and resolves on close.
 */
export function runProcess({
  command,
  args = [],
  cwd,
  env = {},
  timeout = 60000,
  shell = false,
  maxBuffer = 10 * 1024 * 1024
}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd,
        env: { ...process.env, ...env },
        shell,
        windowsHide: false // EDR compliance: headful user session
      });
    } catch (err) {
      return reject(new AppError(`Failed to spawn process: ${err.message}`, 400, err.code || 'ERR_SPAWN_FAILED'));
    }

    const entry = registry.register(child, { command, timeout });

    const stdoutChunks = [];
    const stderrChunks = [];
    let stdoutSize = 0;
    let stderrSize = 0;
    let truncated = false;

    child.stdout?.on('data', (chunk) => {
      if (stdoutSize + chunk.length <= maxBuffer) {
        stdoutChunks.push(chunk);
        stdoutSize += chunk.length;
      } else {
        truncated = true;
      }
    });

    child.stderr?.on('data', (chunk) => {
      if (stderrSize + chunk.length <= maxBuffer) {
        stderrChunks.push(chunk);
        stderrSize += chunk.length;
      } else {
        truncated = true;
      }
    });

    child.on('error', (err) => {
      reject(new AppError(`Process error: ${err.message}`, 500, err.code || 'ERR_PROCESS_ERROR'));
    });

    child.on('close', (code, signal) => {
      resolve({
        id: entry.id,
        pid: child.pid,
        exitCode: code,
        signal,
        timedOut: entry.timedOut,
        truncated,
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr: Buffer.concat(stderrChunks).toString('utf-8')
      });
    });
  });
}

/**
 * Streams process execution output in real-time using Server-Sent Events (SSE).
 */
export function streamProcessExecution({
  command,
  args = [],
  cwd,
  env = {},
  timeout = 60000,
  shell = false
}, req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.socket?.setNoDelay?.(true);

  let child;
  try {
    child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      shell,
      windowsHide: false
    });
  } catch (err) {
    res.write(`event: error\ndata: ${JSON.stringify({ error: err.message, code: err.code || 'ERR_SPAWN_FAILED' })}\n\n`);
    res.end();
    return;
  }

  const entry = registry.register(child, { command, timeout });

  const sendEvent = (event, data) => {
    if (res.writableEnded) return;
    const ok = res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    // Backpressure control
    if (!ok && child.stdout && !child.stdout.isPaused()) {
      child.stdout.pause();
      res.once('drain', () => {
        if (!child.killed) child.stdout.resume();
      });
    }
  };

  sendEvent('start', { id: entry.id, pid: child.pid });

  child.stdout?.on('data', (chunk) => {
    sendEvent('stdout', { chunk: chunk.toString('utf-8') });
  });

  child.stderr?.on('data', (chunk) => {
    sendEvent('stderr', { chunk: chunk.toString('utf-8') });
  });

  child.on('error', (err) => {
    sendEvent('error', { error: err.message, code: err.code });
  });

  child.on('close', (code, signal) => {
    sendEvent('exit', {
      exitCode: code,
      signal,
      timedOut: entry.timedOut
    });
    res.end();
  });

  // Terminate process tree if client disconnects
  req.on('close', () => {
    if (!child.killed && entry) {
      killProcessTree(child.pid);
    }
  });
}
