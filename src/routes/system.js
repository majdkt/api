
/**
 * /api/system
 *
 * GET / – CPU, memory, uptime, OS info
 */

import { Router } from 'express';
import si from 'systeminformation';

export const router = Router();

router.get('/', async (_req, res, next) => {
  try {
    const [cpu, mem, os, time, load, disk] = await Promise.all([
      si.cpu(),
      si.mem(),
      si.osInfo(),
      si.time(),
      si.currentLoad(),
      si.fsSize(),
    ]);

    const diskUsage = disk
      .filter(d => d.mount === '/' || d.type !== 'squashfs')
      .slice(0, 4)
      .map(d => ({
        fs: d.fs,
        mount: d.mount,
        size: d.size,
        used: d.used,
        use: Math.round(d.use),
      }));

    res.json({
      cpu: {
        model: `${cpu.manufacturer} ${cpu.brand}`,
        cores: cpu.physicalCores,
        threads: cpu.cores,
        speed: cpu.speed,
        loadPercent: Math.round(load.currentLoad),
      },
      memory: {
        total: mem.total,
        used: mem.used,
        free: mem.free,
        usedPercent: Math.round((mem.used / mem.total) * 100),
      },
      uptime: {
        seconds: time.uptime,
        human: formatUptime(time.uptime),
      },
      os: {
        distro: os.distro,
        release: os.release,
        kernel: os.kernel,
        arch: os.arch,
        hostname: os.hostname,
      },
      disk: diskUsage,
    });
  } catch (err) {
    next(err);
  }
});

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  return parts.join(' ') || '<1m';
}
