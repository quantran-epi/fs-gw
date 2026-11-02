import { readJsonBody } from '../middleware/body.js';
import { sanitizePath } from '../utils/path.js';
import { sendJson } from '../utils/response.js';
import * as fsService from '../services/fs.service.js';

export function registerFsRoutes(router) {
  router.register('POST', '/fs/read', async (req, res) => {
    const body = await readJsonBody(req);
    const targetPath = sanitizePath(body.path);
    const result = await fsService.readFileContent(targetPath, body.encoding);
    sendJson(res, 200, result);
  });

  router.register('POST', '/fs/write', async (req, res) => {
    const body = await readJsonBody(req);
    const targetPath = sanitizePath(body.path);
    const result = await fsService.atomicWriteFile(targetPath, body.content ?? '', body.encoding, body.atomic);
    sendJson(res, 200, result);
  });

  router.register('POST', '/fs/stat', async (req, res) => {
    const body = await readJsonBody(req);
    const targetPath = sanitizePath(body.path);
    const result = await fsService.statPath(targetPath);
    sendJson(res, 200, result);
  });

  router.register('POST', '/fs/list', async (req, res) => {
    const body = await readJsonBody(req);
    const targetPath = sanitizePath(body.path);
    const result = await fsService.listDirectory(targetPath);
    sendJson(res, 200, result);
  });

  router.register('POST', '/fs/mkdir', async (req, res) => {
    const body = await readJsonBody(req);
    const targetPath = sanitizePath(body.path);
    const result = await fsService.makeDirectory(targetPath);
    sendJson(res, 200, result);
  });

  router.register('POST', '/fs/delete', async (req, res) => {
    const body = await readJsonBody(req);
    const targetPath = sanitizePath(body.path);
    const result = await fsService.deletePath(targetPath);
    sendJson(res, 200, result);
  });
}
