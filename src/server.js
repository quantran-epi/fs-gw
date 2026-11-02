import http from 'node:http';
import { validateHost } from './middleware/security.js';
import { sendError } from './utils/response.js';

export function createGatewayServer(router, options = {}) {
  const server = http.createServer(async (req, res) => {
    // Dynamic port resolution: options.port or actual listening port
    const port = options.port || (server.address() && typeof server.address() === 'object' ? server.address().port : 4820);

    // 1. Host header validation for DNS rebinding protection
    if (!validateHost(req, port)) {
      return sendError(res, 403, 'Forbidden: Invalid Host header', 'ERR_FORBIDDEN_HOST');
    }

    // 2. Dispatch to router
    try {
      await router.dispatch(req, res);
    } catch (err) {
      const status = err.statusCode || 500;
      const code = err.code || 'ERR_INTERNAL_SERVER_ERROR';
      sendError(res, status, err.message, code);
    }
  });

  return server;
}
