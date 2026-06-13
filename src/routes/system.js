
/**
 * /api/system
 *
 * GET  /            – Extended system telemetry
 * POST /diagnostics – Safe diagnostic command execution
 */

import { Router } from 'express';
import si from 'systeminformation';
import { exec } from 'child_process';

export const router = Router();

// Whitelist of safe commands to run on the server
const SAFE_COMMANDS = {
  storage: 'df -h',
  memory: 'free -h',
  docker: 'docker system df',
  processes: 'ps -eo pid,%cpu,%mem,comm --sort=-%cpu | head -n 15',
  network: 'ip -brief address show || ip link show',
  connections: 'ss -s || netstat -an | wc -l',
  uptime: 'uptime'
};

router.get('/', async (_req, res, next) => {
  try {
    // Collect stats in parallel, catching errors on optional subsystems
    const [cpu, mem, os, time, load, disk, temp, netInt, graphics, latency] = await Promise.all([
      si.cpu(),
      si.mem(),
      si.osInfo(),
      si.time(),
      si.currentLoad(),
      si.fsSize(),
      si.cpuTemperature().catch(() => ({ main: null, cores: [] })),
      si.networkInterfaces().catch(() => []),
      si.graphics().catch(() => null),
      si.inetLatency('1.1.1.1').catch(() => null),
    ]);

    const diskUsage = disk
      .filter(d => d.mount === '/' || d.type !== 'squashfs')
      .slice(0, 6)
      .map(d => ({
        fs: d.fs,
        mount: d.mount,
        size: d.size,
        used: d.used,
        use: Math.round(d.use),
      }));

    // Filter network interfaces to return only active/relevant ones
    const activeNetwork = netInt
      .filter(n => n.ip4 && n.iface !== 'lo' && !n.iface.startsWith('br-') && !n.iface.startsWith('docker'))
      .map(n => ({
        iface: n.iface,
        ip4: n.ip4,
        speed: n.speed || 0,
        dhcp: n.dhcp,
        mac: n.mac,
      }));

    // Parse GPU/graphics card information
    const gpus = graphics?.controllers?.map(g => ({
      vendor: g.vendor,
      model: g.model,
      vram: g.vram,
      temp: g.temperatureGpu,
    })) || [];

    res.json({
      cpu: {
        model: `${cpu.manufacturer} ${cpu.brand}`,
        cores: cpu.physicalCores,
        threads: cpu.cores,
        speed: cpu.speed,
        loadPercent: Math.round(load.currentLoad),
        loadPerCore: load.cpus?.map(c => Math.round(c.load)) || [],
        temp: temp.main || null,
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
      network: activeNetwork,
      gpu: gpus,
      pingLatency: latency,
    });
  } catch (err) {
    next(err);
  }
});

// Safe Diagnostic Command Execution
router.post('/diagnostics', (req, res) => {
  const { commandId } = req.body;
  if (!commandId || !SAFE_COMMANDS[commandId]) {
    return res.status(400).json({ error: 'Invalid or unauthorized command ID' });
  }

  const cmd = SAFE_COMMANDS[commandId];
  exec(cmd, { timeout: 5000 }, (error, stdout, stderr) => {
    if (error) {
      return res.status(500).json({
        error: error.message,
        stdout: stdout.toString(),
        stderr: stderr.toString(),
      });
    }
    res.json({
      commandId,
      command: cmd,
      output: stdout.toString() || stderr.toString() || 'Command completed with no output.',
    });
  });
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

