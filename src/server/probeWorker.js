const http = require('http');
const https = require('https');
const { pool } = require('./db');

class ProbeWorker {
  constructor() {
    this.targetUrl = process.env.TARGET_SITE_URL || 'http://okkabun-nginx';
    this.siteName = process.env.TARGET_SITE_NAME || 'okkabun.instiperjogja.ac.id';
    this.intervalMs = parseInt(process.env.PROBE_INTERVAL_MS || '15000', 10);
    this.latestHealth = {
      isHealthy: true,
      statusCode: 200,
      latencyMs: 0,
      lastCheckTime: new Date()
    };
  }

  start() {
    console.log(`[ProbeWorker] Starting synthetic health probe worker target: ${this.targetUrl} (every ${this.intervalMs / 1000}s)`);
    this.runProbe();
    setInterval(() => this.runProbe(), this.intervalMs);
  }

  async runProbe() {
    const startTime = Date.now();
    const client = this.targetUrl.startsWith('https') ? https : http;

    try {
      const req = client.get(this.targetUrl, { timeout: 8000 }, async (res) => {
        const latencyMs = Date.now() - startTime;
        const statusCode = res.statusCode || 200;
        const isHealthy = statusCode >= 200 && statusCode < 400;

        this.latestHealth = {
          isHealthy,
          statusCode,
          latencyMs,
          lastCheckTime: new Date()
        };

        await this.saveProbeResult(statusCode, latencyMs, isHealthy);
      });

      req.on('error', async (err) => {
        const latencyMs = Date.now() - startTime;
        console.error(`[ProbeWorker ERR] Probe failed to reach ${this.targetUrl}:`, err.message);
        this.latestHealth = {
          isHealthy: false,
          statusCode: 503,
          latencyMs,
          lastCheckTime: new Date()
        };

        await this.saveProbeResult(503, latencyMs, false);
      });

      req.on('timeout', () => {
        req.destroy();
      });
    } catch (err) {
      console.error('[ProbeWorker ERR] Probe error:', err.message);
    }
  }

  async saveProbeResult(statusCode, latencyMs, isHealthy) {
    try {
      const query = `
        INSERT INTO health_probes (site_name, timestamp, status_code, latency_ms, is_healthy)
        VALUES (?, NOW(), ?, ?, ?)
      `;
      await pool.execute(query, [this.siteName, statusCode, latencyMs, isHealthy ? 1 : 0]);
    } catch (err) {
      // DB logging fail silent fallback
    }
  }

  getLatestStatus() {
    return this.latestHealth;
  }
}

module.exports = new ProbeWorker();
