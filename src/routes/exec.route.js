import { readJsonBody } from '../middleware/body.js';
import { sendJson } from '../utils/response.js';
import { AppError } from '../utils/errors.js';
import { validateExecInput } from '../utils/command.js';
import * as processService from '../services/process.service.js';

export function registerExecRoutes(router) {
  router.register('POST', '/exec/run', async (req, res) => {
    const body = await readJsonBody(req);
    const options = validateExecInput(body);
    const result = await processService.runProcess(options);
    sendJson(res, 200, result);
  });

  router.register('POST', '/exec/kill', async (req, res) => {
    const body = await readJsonBody(req);
    const target = body.pid !== undefined && body.pid !== null ? Number(body.pid) : body.id;
    if (!target) {
      throw new AppError('Field "pid" (number) or "id" (string) must be provided', 400, 'ERR_INVALID_TARGET');
    }
    const result = await processService.registry.kill(target);
    sendJson(res, 200, result);
  });

  router.register('POST', '/exec/stream', async (req, res) => {
    const body = await readJsonBody(req);
    const options = validateExecInput(body);
    processService.streamProcessExecution(options, req, res);
  });

  router.register('GET', '/exec/stream', async (req, res, parsedUrl) => {
    const command = parsedUrl.searchParams.get('command');
    const args = parsedUrl.searchParams.getAll('arg');
    const cwd = parsedUrl.searchParams.get('cwd') || undefined;
    const timeout = parsedUrl.searchParams.get('timeout') || undefined;
    const shell = parsedUrl.searchParams.get('shell') === 'true';

    const options = validateExecInput({ command, args, cwd, timeout, shell });
    processService.streamProcessExecution(options, req, res);
  });
}
