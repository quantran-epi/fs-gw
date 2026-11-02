export class AppError extends Error {
  constructor(message, statusCode = 500, code = 'ERR_INTERNAL_SERVER_ERROR') {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
  }
}
