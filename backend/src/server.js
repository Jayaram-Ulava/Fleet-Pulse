import { createApp } from './app.js';

const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const server = createApp().listen(port, '0.0.0.0', () => {
  console.log(`Fleet Pulse mock API listening on port ${port}`);
});

process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
