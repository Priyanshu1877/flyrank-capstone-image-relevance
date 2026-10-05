import { createApp } from './app.js';
import { env } from './config/env.js';

const app = createApp();
const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT, () => {
  console.log(`[FlyRank Server] Running on http://localhost:${PORT} in ${env.NODE_ENV} mode`);
});
