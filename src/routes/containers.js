/**
 * /api/containers
 *
 * GET  /               – list all containers
 * POST /:id/start      – start a container
 * POST /:id/stop       – stop a container
 * POST /:id/restart    – restart a container
 */

import { Router } from 'express';
import Docker from 'dockerode';

export const router = Router();

// Connect to Docker via the Unix socket (default).
// When running inside a container, mount /var/run/docker.sock.
const docker = new Docker({ socketPath: '/var/run/docker.sock' });

// ── Helper ────────────────────────────────────────────────────────────────────
function formatContainer(c) {
  return {
    id: c.Id.slice(0, 12),
    fullId: c.Id,
    name: (c.Names?.[0] ?? '').replace(/^\//, ''),
    image: c.Image,
    status: c.Status,
    state: c.State,            // 'running' | 'exited' | 'paused' …
    created: c.Created,
    ports: c.Ports ?? [],
    labels: c.Labels ?? {},
  };
}

// ── GET /api/containers ───────────────────────────────────────────────────────
router.get('/', async (_req, res, next) => {
  try {
    const containers = await docker.listContainers({ all: true });
    res.json({ containers: containers.map(formatContainer) });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/containers/:id/start ───────────────────────────────────────────
router.post('/:id/start', async (req, res, next) => {
  try {
    const container = docker.getContainer(req.params.id);
    await container.start();
    res.json({ ok: true, action: 'start', id: req.params.id });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/containers/:id/stop ────────────────────────────────────────────
router.post('/:id/stop', async (req, res, next) => {
  try {
    const container = docker.getContainer(req.params.id);
    await container.stop();
    res.json({ ok: true, action: 'stop', id: req.params.id });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/containers/:id/restart ─────────────────────────────────────────
router.post('/:id/restart', async (req, res, next) => {
  try {
    const container = docker.getContainer(req.params.id);
    await container.restart();
    res.json({ ok: true, action: 'restart', id: req.params.id });
  } catch (err) {
    next(err);
  }
});
