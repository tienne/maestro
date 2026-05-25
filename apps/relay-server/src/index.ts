import { createServer } from './server';

const PORT = parseInt(process.env.PORT ?? '3001', 10);

const server = createServer();

server.listen(PORT, () => {
  console.log(`[relay] WebSocket relay server listening on port ${PORT}`);
});

process.on('SIGTERM', () => {
  console.log('[relay] SIGTERM received, shutting down...');
  server.close(() => {
    console.log('[relay] Server closed');
    process.exit(0);
  });
});
