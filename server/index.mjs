import { createVideoServer } from './video-server.mjs';

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 4318);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
const app = await createVideoServer();
app.server.listen(port, host, () => {
  console.log(`Flexitools is ready at http://${host}:${port}`);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
  await app.close();
  process.exit(0);
});
