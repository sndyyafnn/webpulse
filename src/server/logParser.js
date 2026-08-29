const fs = require('fs');
const path = require('path');
const readline = require('readline');
const statsAggregator = require('./statsAggregator');

class NginxLogParser {
  constructor(logPath) {
    this.configuredPath = logPath || process.env.NGINX_LOG_PATH || '/var/log/target/okkabun_logs/access.log';
    this.activeLogFile = null;
    this.filePosition = 0;
    this.isTailRunning = false;
  }

  start() {
    console.log(`[LogParser] Initializing log parser with target path: ${this.configuredPath}`);
    this.resolveTargetFile();

    // Check for log updates every 1 second
    setInterval(() => this.readNewLines(), 1000);
  }

  resolveTargetFile() {
    try {
      // 1. Direct file check
      if (fs.existsSync(this.configuredPath)) {
        const stats = fs.statSync(this.configuredPath);
        if (stats.isFile()) {
          this.activeLogFile = this.configuredPath;
          return;
        }
      }

      // 2. Directory auto-discovery (if configuredPath is a directory or parent directory exists)
      const targetDir = fs.existsSync(this.configuredPath) && fs.statSync(this.configuredPath).isDirectory()
        ? this.configuredPath
        : path.dirname(this.configuredPath);

      if (fs.existsSync(targetDir)) {
        const files = fs.readdirSync(targetDir);
        const logCandidate = files.find(f => f.endsWith('.log') || f.includes('access'));
        if (logCandidate) {
          this.activeLogFile = path.join(targetDir, logCandidate);
          console.log(`[LogParser AUTO-DISCOVERY] Found active log file: ${this.activeLogFile}`);
          return;
        }
      }

      console.log(`[LogParser INFO] Waiting for log file at ${this.configuredPath} or inside ${targetDir}...`);
    } catch (err) {
      console.error(`[LogParser ERR] Error resolving log file:`, err.message);
    }
  }

  readNewLines() {
    if (this.isTailRunning) return;
    
    if (!this.activeLogFile || !fs.existsSync(this.activeLogFile)) {
      this.resolveTargetFile();
      return;
    }

    try {
      const stats = fs.statSync(this.activeLogFile);
      if (!stats.isFile()) return;

      if (stats.size < this.filePosition) {
        // Log rotation detected
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
        // Fallback to regex
      }
    }

    // 2. Flexible Nginx Combined format parser
    // Matches IP - - [date] "METHOD PATH HTTP/X" STATUS BYTES "REFERER" "USER_AGENT" [RESPONSE_TIME]
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
