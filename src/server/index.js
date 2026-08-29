const express = require('express');
const path = require('path');
const cors = require('cors');
require('dotenv').config();

const { testConnection, pool } = require('./db');
const statsAggregator = require('./statsAggregator');
const NginxLogParser = require('./logParser');
const probeWorker = require('./probeWorker');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Serve static frontend files
app.use(express.static(path.join(__dirname, '../../public')));

// API Endpoint 1: Real-time Live Snapshot
app.get('/api/stats/live', (req, res) => {
  const liveStats = statsAggregator.getLiveSnapshot();
  const healthStatus = probeWorker.getLatestStatus();

  res.json({
    success: true,
    data: {
      ...liveStats,
      probe: healthStatus
    }
  });
});

// API Endpoint 2: Historical metrics from MySQL DB (10.7.171.20)
app.get('/api/stats/history', async (req, res) => {
  try {
    const siteName = process.env.TARGET_SITE_NAME || 'okkabun.instiperjogja.ac.id';
    const limit = parseInt(req.query.limit || '60', 10);

    const [rows] = await pool.query(
      `SELECT 
        DATE_FORMAT(timestamp, '%H:%i') as time,
        total_requests,
        peak_rps,
        active_ips,
        avg_response_time_ms,
        status_2xx,
        status_4xx,
        status_5xx
       FROM traffic_metrics 
       WHERE site_name = ?
       ORDER BY timestamp DESC
       LIMIT ?`,
      [siteName, limit]
    );

    res.json({
      success: true,
      data: rows.reverse()
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API Endpoint 3: Daily Peak History
app.get('/api/stats/peaks', async (req, res) => {
  try {
    const siteName = process.env.TARGET_SITE_NAME || 'okkabun.instiperjogja.ac.id';

    const [rows] = await pool.query(
      `SELECT 
        DATE_FORMAT(date, '%Y-%m-%d') as date,
        peak_active_users,
        DATE_FORMAT(peak_active_users_time, '%H:%i:%s') as peak_users_at,
        peak_rps,
        DATE_FORMAT(peak_rps_time, '%H:%i:%s') as peak_rps_at,
        total_daily_requests,
        avg_daily_response_ms
       FROM daily_peaks
       WHERE site_name = ?
       ORDER BY date DESC
       LIMIT 30`,
      [siteName]
    );

    res.json({
      success: true,
      data: rows
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Wildcard route to serve dashboard SPA index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../../public/index.html'));
});

// Start Server & Background Services
async function initServer() {
  console.log('=====================================================');
  console.log('  INSTIPER Web Traffic & Load Monitoring Service     ');
  console.log('=====================================================');

  // Test DB connection
  await testConnection();

  // Initialize Aggregator & Workers
  statsAggregator.start();
  probeWorker.start();

  // Start Nginx Log Parser (0-code-change on okkabun)
  const logParser = new NginxLogParser();
  logParser.start();

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[WebStats App] Listening on http://0.0.0.0:${PORT}`);
    console.log(`[WebStats App] Monitoring Target: ${process.env.TARGET_SITE_NAME || 'okkabun.instiperjogja.ac.id'}`);
  });
}

initServer().catch(err => {
  console.error('[WebStats ERR] Fatal initialization error:', err);
});
