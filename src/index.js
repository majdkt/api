import express from 'express';
import { router as containersRouter } from './routes/containers.js';
import { router as systemRouter } from './routes/system.js';
import { router as logsRouter } from './routes/logs.js';

const app = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());

// CORS – allow the Astro dev server and production origins
app.use((req, res, next) => {
  const origin = req.headers.origin || '';
  const allowed = [
    'http://localhost:4321',  // Astro dev
    'http://localhost:4322',  // Astro preview
    process.env.FRONTEND_ORIGIN,
  ].filter(Boolean);

  if (allowed.includes(origin) || !origin) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/containers', containersRouter);
app.use('/api/system', systemRouter);
app.use('/api/logs', logsRouter);

// Health probe
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: Date.now() }));

// 404 handler
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// Global error handler
app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({ error: err.message ?? 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Teze API listening on http://0.0.0.0:${PORT}`);
});
