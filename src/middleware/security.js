export function validateHost(req, port = 4820) {
  const rawHost = req.headers.host;
  if (!rawHost) return false;

  const allowedHosts = new Set([
    '127.0.0.1',
    'localhost',
    `127.0.0.1:${port}`,
    `localhost:${port}`
  ]);

  return allowedHosts.has(rawHost.toLowerCase());
}
