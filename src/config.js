export const CONFIG = {
  host: '127.0.0.1',
  port: Number(process.env.FS_GW_PORT) || 4820,
  maxBodySize: 10 * 1024 * 1024 // 10MB
};
