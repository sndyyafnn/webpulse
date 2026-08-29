const fs = require('fs');
const path = require('path');
const http = require('http');
const readline = require('readline');
const statsAggregator = require('./statsAggregator');

class NginxLogParser {
  constructor(logPath) {
    this.configuredPath = logPath || process.env.NGINX_LOG_PATH || '/var/log/target/okkabun_logs/access.log';
    this.containerName = process.env.TARGET_CONTAINER_NAME || 'okkabun-nginx';
    this.activeLogFile = null;
    this.filePosition = 0;
    this.isTailRunning = false;
    this.isDockerStreamActive = false;
  }

  start() {
    console.log(`[LogParser] Initializing log parser. Target container: ${this.containerName}`);
    this.resolveAndStartLogSource();

    // Check periodically if log source status changes
    setInterval(() => {
      if (!this.activeLogFile && !this.isDockerStreamActive) {
        this.resolveAndStartLogSource();
      } else if (this.activeLogFile) {
        this.readNewLines();
      }
    }, 1000);
  }

  resolveAndStartLogSource() {
    // 1. Try finding physical log file on disk
    this.resolvePhysicalFile();

    if (this.activeLogFile) {
      console.log(`[LogParser SUCCESS] Tailing physical log file: ${this.activeLogFile}`);
      try {
        const stats = fs.statSync(this.activeLogFile);
        this.filePosition = stats.size;
      } catch (e) {}
      this.readNewLines();
      return;
    }

    // 2. Fallback: Stream directly from Docker socket if physical file is missing
    if (fs.existsSync('/var/run/docker.sock')) {
      console.log(`[LogParser DOCKER STREAM] Physical log file not found. Fallback to streaming container logs: ${this.containerName} via /var/run/docker.sock`);
      this.startDockerSocketStream();
    } else {
      console.log(`[LogParser INFO] Waiting for log file at ${this.configuredPath} or docker.sock access...`);
    }
  }

  resolvePhysicalFile() {
    try {
      if (fs.existsSync(this.configuredPath) && fs.statSync(this.configuredPath).isFile()) {
        this.activeLogFile = this.configuredPath;
        return;
      }

      const targetDir = fs.existsSync(this.configuredPath) && fs.statSync(this.configuredPath).isDirectory()
        ? this.configuredPath
        : path.dirname(this.configuredPath);

      if (fs.existsSync(targetDir)) {
        const files = fs.readdirSync(targetDir);
        const logCandidate = files.find(f => f.endsWith('.log') || f.includes('access'));
        if (logCandidate) {
          this.activeLogFile = path.join(targetDir, logCandidate);
          return;
        }
      }
    } catch (err) {
      // Ignore physical file error and proceed to docker socket
    }
  }

  startDockerSocketStream() {
    if (this.isDockerStreamActive) return;
    this.isDockerStreamActive = true;

    try {
      // PENTING: tail=0 agar HANYA membaca log BARU dan tidak mengulang 50 log lama dari masa lalu
      const options = {
        socketPath: '/var/run/docker.sock',
        path: `/containers/${this.containerName}/logs?stdout=1&stderr=1&follow=1&tail=0`,
        method: 'GET'
      };

      const req = http.request(options, (res) => {
        console.log(`[LogParser DOCKER STREAM] Successfully connected to Docker logs stream of ${this.containerName} (live tail=0)`);
        let buffer = '';

        res.on('data', (chunk) => {
          buffer += chunk.toString('utf-8');
          const lines = buffer.split('\n');
          buffer = lines.pop();

          for (let line of lines) {
            // Strip Docker log header frames (8 bytes) if raw stream
            if (line.length > 8 && line.charCodeAt(0) <= 2) {
              line = line.substring(8);
            }
            line = line.trim();
            if (line) {
              const entry = this.parseLine(line);
              if (entry) {
                statsAggregator.recordRequest(entry);
              }
            }
          }
        });

        res.on('end', () => {
          console.log('[LogParser DOCKER STREAM] Log stream ended. Reconnecting...');
          this.isDockerStreamActive = false;
        });
      });

      req.on('error', (err) => {
        console.error(`[LogParser DOCKER STREAM ERR] Failed to stream from ${this.containerName}:`, err.message);
        this.isDockerStreamActive = false;
      });

      req.end();
    } catch (err) {
      console.error('[LogParser DOCKER STREAM ERR]', err.message);
      this.isDockerStreamActive = false;
    }
  }

  readNewLines() {
    if (this.isTailRunning || !this.activeLogFile) return;
    if (!fs.existsSync(this.activeLogFile)) {
      this.activeLogFile = null;
      return;
    }

    try {
      const stats = fs.statSync(this.activeLogFile);
      if (!stats.isFile()) return;

      if (stats.size < this.filePosition) {
        console.log('[LogParser INFO] Log rotation detected, resetting file position.');
        this.filePosition = 0;
      }

      if (stats.size === this.filePosition) return;

      this.isTailRunning = true;
      const stream = fs.createReadStream(this.activeLogFile, {
        start: this.filePosition,
        end: stats.size,
        encoding: 'utf-8'
      });

      stream.on('error', (err) => {
        console.error('[LogParser ERR] Read stream error:', err.message);
        this.isTailRunning = false;
      });

      const rl = readline.createInterface({
        input: stream,
        crlfDelay: Infinity
      });

      rl.on('line', (line) => {
        if (line && line.trim()) {
          const entry = this.parseLine(line.trim());
          if (entry) {
            statsAggregator.recordRequest(entry);
          }
        }
      });

      rl.on('error', (err) => {
        console.error('[LogParser ERR] Readline error:', err.message);
        this.isTailRunning = false;
      });

      rl.on('close', () => {
        this.filePosition = stats.size;
        this.isTailRunning = false;
      });
    } catch (err) {
      console.error('[LogParser ERR] Tail error:', err.message);
      this.isTailRunning = false;
    }
  }

  parseLine(line) {
    let sessionId = null;
    const sessionMatch = line.match(/PHPSESSID=([a-zA-Z0-9,-]+)/i);
    if (sessionMatch) {
      sessionId = sessionMatch[1];
    }

    // 1. Try parsing JSON format
    if (line.startsWith('{') && line.endsWith('}')) {
      try {
        const data = JSON.parse(line);
        return {
          ip: data.remote_addr || data.client_ip || 'unknown',
          status: parseInt(data.status || 200, 10),
          bytes: parseInt(data.body_bytes_sent || data.bytes_sent || 0, 10),
          responseTimeMs: Math.round(parseFloat(data.request_time || 0) * 1000),
          path: data.request ? data.request.split(' ')[1] || '/' : '/',
          userAgent: data.http_user_agent || '',
          sessionId: data.phpsessid || sessionId
        };
      } catch (e) {
        // Fallback
      }
    }

    // 2. Flexible Nginx Combined format parser
    const regex = /^(\S+)\s+\S+\s+\S+\s+\[([^\]]+)\]\s+"([A-Z]+)\s+([^"]+?)(?:\s+HTTP\/[^"]+)?"\s+(\d{3})\s+(\d+)(?:\s+"[^"]*"\s+"([^"]*)")?(?:\s+([\d.]+))?/;
    const match = line.match(regex);

    if (match) {
      const ip = match[1];
      const path = match[4];
      const status = parseInt(match[5], 10);
      const bytes = parseInt(match[6], 10);
      const userAgent = match[7] || '';
      const respTimeSec = parseFloat(match[8] || '0');

      return {
        ip,
        status,
        bytes,
        responseTimeMs: Math.round(respTimeSec * 1000),
        path,
        userAgent,
        sessionId
      };
    }

    // Fallback robust parser
    const ipMatch = line.match(/^(\S+)/);
    const statusMatch = line.match(/\s(\d{3})\s/);
    const bytesMatch = line.match(/\s\d{3}\s+(\d+)/);

    return {
      ip: ipMatch ? ipMatch[1] : '127.0.0.1',
      status: statusMatch ? parseInt(statusMatch[1], 10) : 200,
      bytes: bytesMatch ? parseInt(bytesMatch[1], 10) : 500,
      responseTimeMs: 25,
      path: '/',
      userAgent: '',
      sessionId
    };
  }
}

module.exports = NginxLogParser;
