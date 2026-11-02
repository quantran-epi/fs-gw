import { AppError } from './utils/errors.js';

export class Router {
  constructor() {
    this.routes = new Map();
  }

  register(method, path, handler) {
    this.routes.set(`${method.toUpperCase()} ${path}`, handler);
  }

  async dispatch(req, res) {
    const parsedUrl = new URL(req.url, 'http://127.0.0.1');
    const key = `${req.method.toUpperCase()} ${parsedUrl.pathname}`;
    const handler = this.routes.get(key);

    if (!handler) {
      throw new AppError(`Route not found: ${req.method} ${parsedUrl.pathname}`, 404, 'ERR_NOT_FOUND');
    }

    await handler(req, res, parsedUrl);
  }
}
