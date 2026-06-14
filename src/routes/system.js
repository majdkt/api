/**
 * /api/system
 *
 * GET  /            – Extended system telemetry
 * POST /diagnostics – Safe diagnostic command execution
 */

import { Router } from 'express';
import si from 'systeminformation';
import { exec } from 'child_process';
import { createConnection } from 'net';
import Docker from 'dockerode';

export const router = Router();

const PING_HOST   = process.env.PING_HOST   || '1.1.1.1';
const DOCKER_SOCK = process.env.DOCKER_SOCKET || '/var/run/docker.sock';
const docker      = new Docker({ socketPath: DOCKER_SOCK });

// ── TCP-based latency fallback ────────────────────────────────────────────────
// Used when ICMP ping is unavailable (no CAP_NET_RAW). Measures time to
// establish a TCP connection to port 53 on the ping host.
function tcpLatency(host, port = 53, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = createConnection({ host, port, timeout: timeoutMs });
    socket.on('connect', () => {
      resolve(Date.now() - start);
      socket.destroy();
    });
    socket.on('error',   () => { resolve(null); socket.destroy(); });
    socket.on('timeout', () => { resolve(null); socket.destroy(); });
  });
}

// ── Safe shell diagnostic commands ───────────────────────────────────────────
// All commands are available after installing procps + iproute2 in the Dockerfile.
// 'docker' is handled separately via dockerode (no Docker CLI in the container).
const SAFE_COMMANDS = {
  storage:     'df -h',
  memory:      'free -h',
  processes:   'ps -eo pid,%cpu,%mem,comm --sort=-%cpu | head -n 15',
  network:     'ip -brief address show',
  connections: 'ss -s',
  uptime:      'uptime',
};

// ── GET /api/system ───────────────────────────────────────────────────────────
router.get('/', async (_req, res, next) => {
  try {
    const [cpu, mem, os, time, load, disk, temp, netInt, graphics] = await Promise.all([
      si.cpu(),
      si.mem(),
      si.osInfo(),
      si.time(),
      si.currentLoad(),
      si.fsSize(),
      si.cpuTemperature().catch(() => ({ main: null, cores: [] })),
      si.networkInterfaces().catch(() => []),
      si.graphics().catch(() => null),
    ]);

    // Try ICMP ping first; fall back to TCP latency if it returns null
    let latency = await si.inetLatency(PING_HOST).catch(() => null);
    if (latency === null) {
      latency = await tcpLatency(PING_HOST);
    }

    const diskUsage = disk
      .filter(d => d.mount === '/' || d.type !== 'squashfs')
      .slice(0, 6)
      .map(d => ({
        fs:    d.fs,
        mount: d.mount,
        size:  d.size,
        used:  d.used,
        use:   Math.round(d.use),
      }));

    const activeNetwork = netInt
      .filter(n => n.ip4 && n.iface !== 'lo' && !n.iface.startsWith('br-') && !n.iface.startsWith('docker'))
      .map(n => ({
        iface: n.iface,
        ip4:   n.ip4,
        speed: n.speed || 0,
        dhcp:  n.dhcp,
        mac:   n.mac,
      }));

    const gpus = graphics?.controllers?.map(g => ({
      vendor: g.vendor,
      model:  g.model,
      vram:   g.vram,
      temp:   g.temperatureGpu,
    })) || [];

    res.json({
      cpu: {
        model:       `${cpu.manufacturer} ${cpu.brand}`,
        cores:       cpu.physicalCores,
        threads:     cpu.cores,
        speed:       cpu.speed,
        loadPercent: Math.round(load.currentLoad),
        loadPerCore: load.cpus?.map(c => Math.round(c.load)) || [],
        temp:        temp.main || null,
      },
      memory: {
        total:       mem.total,
        used:        mem.used,
        free:        mem.free,
        usedPercent: Math.round((mem.used / mem.total) * 100),
      },
      uptime: {
        seconds: time.uptime,
        human:   formatUptime(time.uptime),
      },
      os: {
        distro:   os.distro,
        release:  os.release,
        kernel:   os.kernel,
        arch:     os.arch,
        hostname: os.hostname,
      },
      disk:        diskUsage,
      network:     activeNetwork,
      gpu:         gpus,
      pingLatency: latency,
      pingHost:    PING_HOST,
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/system/diagnostics ─────────────────────────────────────────────
router.post('/diagnostics', async (req, res) => {
  const { commandId } = req.body;

  // 'docker' is handled via dockerode – no Docker CLI in the container
  if (commandId === 'docker') {
    try {
      const info = await docker.info();
      const output = [
        `Containers:  ${info.Containers}  (running: ${info.ContainersRunning}, paused: ${info.ContainersPaused}, stopped: ${info.ContainersStopped})`,
        `Images:      ${info.Images}`,
        `Docker Root: ${info.DockerRootDir}`,
        `Storage:     ${info.Driver}`,
        `Kernel:      ${info.KernelVersion}`,
        `OS:          ${info.OperatingSystem}`,
        `CPUs:        ${info.NCPU}`,
        `Memory:      ${(info.MemTotal / 1024 / 1024 / 1024).toFixed(1)} GB`,
      ].join('\n');

      return res.json({ commandId, command: 'docker info (via socket)', output });
    } catch (err) {
      return res.status(500).json({ error: `Docker info failed: ${err.message}` });
    }
  }

  if (!commandId || !SAFE_COMMANDS[commandId]) {
    return res.status(400).json({ error: 'Invalid or unauthorized command ID' });
  }

  const cmd = SAFE_COMMANDS[commandId];
  exec(cmd, { timeout: 5000, shell: '/bin/sh' }, (error, stdout, stderr) => {
    if (error) {
      return res.status(500).json({
        error:  error.message,
        stdout: stdout.toString(),
        stderr: stderr.toString(),
      });
    }
    res.json({
      commandId,
      command: cmd,
      output:  stdout.toString() || stderr.toString() || 'Command completed with no output.',
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
