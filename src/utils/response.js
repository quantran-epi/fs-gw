export function sendJson(res, statusCode, data) {
  const body = JSON.stringify({ ok: true, data });
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

export function sendError(res, statusCode, message, code = 'ERR_GENERIC') {
  const body = JSON.stringify({ ok: false, error: message, code });
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}
