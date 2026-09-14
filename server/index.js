import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { apiRouter } from './router.js';
import { initWs } from './stream.js';

const PORT = Number(process.env.VRADIO_PORT || 8080);

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'vradio', time: new Date().toISOString() });
});

app.use('/api', apiRouter);

const server = createServer(app);
initWs(server);

server.listen(PORT, () => {
  console.log(`[vradio] 服务已启动 http://localhost:${PORT}`);
});
