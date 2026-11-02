import { CONFIG } from './src/config.js';
import { Router } from './src/router.js';
import { createGatewayServer } from './src/server.js';
import { healthHandler } from './src/routes/health.route.js';

function parsePort() {
  const portArgIdx = process.argv.indexOf('--port');
  if (portArgIdx !== -1 && process.argv[portArgIdx + 1]) {
    const parsed = Number(process.argv[portArgIdx + 1]);
    if (!Number.isNaN(parsed) && parsed > 0 && parsed <= 65535) {
      return parsed;
    }
  }
  return CONFIG.port;
}

const port = parsePort();
const host = CONFIG.host;

const router = new Router();
router.register('GET', '/health', healthHandler);

const server = createGatewayServer(router, { port, host });

server.listen(port, host, () => {
  console.log(`[fs-gw] Gateway running on http://${host}:${port}`);
  console.log(`[fs-gw] Process PID: ${process.pid}`);
  console.log(`[fs-gw] Environment: Node ${process.version} (${process.platform})`);
});

function handleShutdown(signal) {
  console.log(`[fs-gw] Received ${signal}. Shutting down cleanly...`);
  server.close(() => {
    console.log('[fs-gw] Server closed.');
    process.exit(0);
  });
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));
