import { sendJson } from '../utils/response.js';

export function healthHandler(req, res) {
  sendJson(res, 200, {
    status: 'ok',
    uptime: process.uptime(),
    platform: process.platform,
    node: process.version
  });
}
