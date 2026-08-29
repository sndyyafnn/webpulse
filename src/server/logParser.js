const fs = require('fs');
const readline = require('readline');
const statsAggregator = require('./statsAggregator');

class NginxLogParser {
  constructor(logPath) {
    this.logPath = logPath || process.env.NGINX_LOG_PATH || '/var/log/target/okkabun_access.log';
    this.filePosition = 0;
    this.watcher = null;
    this.isTailRunning = false;
  }

  start() {
    console.log(`[LogParser] Starting Nginx log stream watcher on: ${this.logPath}`);
    this.checkAndInitFile();
    
    // Check for file updates every 1 second
    setInterval(() => this.readNewLines(), 1000);
  }

  checkAndInitFile() {
    try {
      if (fs.existsSync(this.logPath)) {
        const stats = fs.statSync(this.logPath);
        // Start tailing from current end of file (or last 64KB for initial context)
        const initialOffset = Math.max(0, stats.size - 65536);
        this.filePosition = initialOffset;
        this.readNewLines();
      } else {
        console.log(`[LogParser INFO] Waiting for log file to exist at ${this.logPath}...`);
      }
    } catch (err) {
      console.error(`[LogParser ERR] Error initializing log file:`, err.message);
    }
  }

  readNewLines() {
    if (this.isTailRunning) return;
    if (!fs.existsSync(this.logPath)) return;

    try {
      const stats = fs.statSync(this.logPath);
      if (stats.size < this.filePosition) {
        // Log rotation detected
        console.log('[LogParser INFO] Log rotation detected, resetting file position.');
        this.filePosition = 0;
      }

      if (stats.size === this.filePosition) return;

      this.isTailRunning = true;
      const stream = fs.createReadStream(this.logPath, {
        start: this.filePosition,
        end: stats.size,
        encoding: 'utf-8'
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

      rl.on('close', () => {
        this.filePosition = stats.size;
        this.isTailRunning = false;
      });

      stream.on('error', (err) => {
        console.error('[LogParser ERR] Read stream error:', err.message);
        this.isTailRunning = false;
      });
    } catch (err) {
      console.error('[LogParser ERR] Tail error:', err.message);
      this.isTailRunning = false;
    }
  }

  parseLine(line) {
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
          userAgent: data.http_user_agent || ''
        };
      } catch (e) {
        // Fallback to regex
      }
    }

    // 2. Try parsing standard Nginx Combined format with optional response_time at end
    // Pattern: IP - - [date] "METHOD PATH HTTP/X" STATUS BYTES "REFERER" "USER_AGENT" [RESPONSE_TIME]
    const regex = /^(\S+)\s+\S+\s+\S+\s+\[([^\]]+)\]\s+"([A-Z]+)\s+([^"]+)\s+HTTP\/[^"]+"\s+(\d{3})\s+(\d+)(?:\s+"[^"]*"\s+"([^"]*)")?(?:\s+([\d.]+))?/;
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
        userAgent
      };
    }

    // Simple fallback match if regex fails on custom log line
    const statusMatch = line.match(/\s(\d{3})\s/);
    return {
      ip: line.split(' ')[0] || '127.0.0.1',
      status: statusMatch ? parseInt(statusMatch[1], 10) : 200,
      bytes: 500,
      responseTimeMs: 25,
      path: '/',
      userAgent: ''
    };
  }
}

module.exports = NginxLogParser;
