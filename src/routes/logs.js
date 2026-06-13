/**
 * /api/logs
 *
 * GET /      – list available log sources (Docker containers)
 * GET /:id   – tail logs from a Docker container
 */

import { Router } from 'express';
import Docker from 'dockerode';

export const router = Router();

// Docker socket path is configurable via DOCKER_SOCKET env var.
const docker = new Docker({
  socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock',
});

// List log sources (containers for now)
router.get('/', async (_req, res, next) => {
  try {
    const containers = await docker.listContainers({ all: true });
    const sources = containers.map(c => ({
      id:    c.Id.slice(0, 12),
      name:  (c.Names?.[0] ?? '').replace(/^\//, ''),
      state: c.State,
    }));
    res.json({ sources });
  } catch (err) {
    next(err);
  }
});

// Tail last N lines from a container's stdout+stderr
router.get('/:id', async (req, res, next) => {
  try {
    const tail = parseInt(req.query.tail ?? '100', 10);
    const container = docker.getContainer(req.params.id);
    const logBuffer = await container.logs({
      stdout: true,
      stderr: true,
      tail,
      timestamps: true,
    });

    // dockerode returns a Buffer; strip the 8-byte multiplexed stream header
    const lines = logBuffer
      .toString('utf8')
      .split('\n')
      .filter(Boolean)
      .map(line => {
        // Each Docker log line starts with an 8-byte header – strip it if present
        return line.replace(/^[\x00-\x08].{7}/, '').trimStart();
      });

    res.json({ id: req.params.id, lines });
  } catch (err) {
    next(err);
  }
});
