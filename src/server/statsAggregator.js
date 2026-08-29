const { pool } = require('./db');

class StatsAggregator {
  constructor() {
    this.siteName = process.env.TARGET_SITE_NAME || 'okkabun.instiperjogja.ac.id';

    // Live counter (reset every second)
    this.requestsThisSecond = 0;
    this.currentRps = 0;

    // Rolling 1-minute aggregation bucket
    this.minuteBucket = this.createEmptyBucket();

    // Sliding window of active unique client IPs (IP -> lastSeenTimestamp)
    this.activeIpsWindow = new Map(); // 5-min active window

    // Peak trackers for today
    this.dailyPeaks = {
      date: new Date().toISOString().split('T')[0],
      peakActiveUsers: 0,
      peakActiveUsersTime: null,
      peakRps: 0,
      peakRpsTime: null,
      totalRequestsToday: 0
    };

    // History buffer for live UI updates (last 30 minutes)
    this.recentMetricsHistory = [];
  }

  createEmptyBucket() {
    return {
      startTime: Date.now(),
      totalRequests: 0,
      peakRpsInMinute: 0,
      totalResponseTimeMs: 0,
      responseCountWithTime: 0,
      totalBytes: 0,
      status2xx: 0,
      status3xx: 0,
      status4xx: 0,
      status5xx: 0
    };
  }

  start() {
    console.log('[StatsAggregator] Initializing stats aggregation workers...');

    // 1. Every 1 second: calculate current RPS and reset second counter
    setInterval(() => {
      this.currentRps = this.requestsThisSecond;
      if (this.currentRps > this.minuteBucket.peakRpsInMinute) {
        this.minuteBucket.peakRpsInMinute = this.currentRps;
      }
      this.requestsThisSecond = 0;
      this.cleanupOldActiveIps();
      this.updateDailyPeakMetrics();
    }, 1000);

    // 2. Every 1 minute: flush minuteBucket to MySQL database host
    const aggInterval = parseInt(process.env.AGGREGATION_INTERVAL_MS || '60000', 10);
    setInterval(() => this.flushMinuteBucketToDb(), aggInterval);
  }

  recordRequest(entry) {
    this.requestsThisSecond++;
    this.minuteBucket.totalRequests++;
    this.minuteBucket.totalBytes += (entry.bytes || 0);
    this.dailyPeaks.totalRequestsToday++;

    if (entry.responseTimeMs > 0) {
      this.minuteBucket.totalResponseTimeMs += entry.responseTimeMs;
      this.minuteBucket.responseCountWithTime++;
    }

    // Status code categorization
    const s = entry.status || 200;
    if (s >= 200 && s < 300) this.minuteBucket.status2xx++;
    else if (s >= 300 && s < 400) this.minuteBucket.status3xx++;
    else if (s >= 400 && s < 500) this.minuteBucket.status4xx++;
    else if (s >= 500) this.minuteBucket.status5xx++;

    // Track client IP in sliding window (5 minute TTL)
    if (entry.ip && entry.ip !== '-' && entry.ip !== '127.0.0.1') {
      this.activeIpsWindow.set(entry.ip, Date.now());
    }
  }

  cleanupOldActiveIps() {
    const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
    for (const [ip, lastSeen] of this.activeIpsWindow.entries()) {
      if (lastSeen < fiveMinutesAgo) {
        this.activeIpsWindow.delete(ip);
      }
    }
  }

  getActiveUsersCount() {
    return Math.max(1, this.activeIpsWindow.size);
  }

  updateDailyPeakMetrics() {
    const today = new Date().toISOString().split('T')[0];
    if (this.dailyPeaks.date !== today) {
      // New day reset
      this.dailyPeaks = {
        date: today,
        peakActiveUsers: 0,
        peakActiveUsersTime: null,
        peakRps: 0,
        peakRpsTime: null,
        totalRequestsToday: 0
      };
    }

    const currentActiveUsers = this.getActiveUsersCount();
    const nowISO = new Date().toISOString();

    if (currentActiveUsers > this.dailyPeaks.peakActiveUsers) {
      this.dailyPeaks.peakActiveUsers = currentActiveUsers;
      this.dailyPeaks.peakActiveUsersTime = nowISO;
    }

    if (this.currentRps > this.dailyPeaks.peakRps) {
      this.dailyPeaks.peakRps = this.currentRps;
      this.dailyPeaks.peakRpsTime = nowISO;
    }
  }

  async flushMinuteBucketToDb() {
    const bucketToFlush = { ...this.minuteBucket };
    this.minuteBucket = this.createEmptyBucket();

    const timestamp = new Date();
    const activeIps = this.getActiveUsersCount();
    const avgResponseTimeMs = bucketToFlush.responseCountWithTime > 0
      ? Math.round(bucketToFlush.totalResponseTimeMs / bucketToFlush.responseCountWithTime)
      : 0;

    // Save metric item into recent history cache (up to 60 points)
    const metricItem = {
      timestamp: timestamp.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
      totalRequests: bucketToFlush.totalRequests,
      peakRps: bucketToFlush.peakRpsInMinute,
      activeUsers: activeIps,
      avgResponseTimeMs,
      status2xx: bucketToFlush.status2xx,
      status4xx: bucketToFlush.status4xx,
      status5xx: bucketToFlush.status5xx
    };

    this.recentMetricsHistory.push(metricItem);
    if (this.recentMetricsHistory.length > 60) {
      this.recentMetricsHistory.shift();
    }

    try {
      // 1. Insert into traffic_metrics
      const queryMetric = `
        INSERT INTO traffic_metrics 
        (site_name, timestamp, total_requests, peak_rps, active_ips, avg_response_time_ms, total_bytes, status_2xx, status_3xx, status_4xx, status_5xx)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      await pool.execute(queryMetric, [
        this.siteName,
        timestamp,
        bucketToFlush.totalRequests,
        bucketToFlush.peakRpsInMinute,
        activeIps,
        avgResponseTimeMs,
        bucketToFlush.totalBytes,
        bucketToFlush.status2xx,
        bucketToFlush.status3xx,
        bucketToFlush.status4xx,
        bucketToFlush.status5xx
      ]);

      // 2. Upsert daily peaks table
      const today = this.dailyPeaks.date;
      const queryDaily = `
        INSERT INTO daily_peaks 
        (site_name, date, peak_active_users, peak_active_users_time, peak_rps, peak_rps_time, total_daily_requests, avg_daily_response_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          peak_active_users = GREATEST(peak_active_users, VALUES(peak_active_users)),
          peak_active_users_time = IF(VALUES(peak_active_users) > peak_active_users, VALUES(peak_active_users_time), peak_active_users_time),
          peak_rps = GREATEST(peak_rps, VALUES(peak_rps)),
          peak_rps_time = IF(VALUES(peak_rps) > peak_rps, VALUES(peak_rps_time), peak_rps_time),
          total_daily_requests = total_daily_requests + VALUES(total_daily_requests)
      `;

      await pool.execute(queryDaily, [
        this.siteName,
        today,
        this.dailyPeaks.peakActiveUsers,
        this.dailyPeaks.peakActiveUsersTime || timestamp,
        this.dailyPeaks.peakRps,
        this.dailyPeaks.peakRpsTime || timestamp,
        bucketToFlush.totalRequests,
        avgResponseTimeMs
      ]);

    } catch (err) {
      console.error('[StatsAggregator ERR] Failed flushing to DB:', err.message);
    }
  }

  getLiveSnapshot() {
    const avgResponseTimeMs = this.minuteBucket.responseCountWithTime > 0
      ? Math.round(this.minuteBucket.totalResponseTimeMs / this.minuteBucket.responseCountWithTime)
      : 25;

    return {
      siteName: this.siteName,
      currentRps: this.currentRps,
      activeUsersNow: this.getActiveUsersCount(),
      avgResponseTimeMs,
      todayPeaks: {
        peakRpsToday: Math.max(this.dailyPeaks.peakRps, this.currentRps),
        peakActiveUsersToday: this.dailyPeaks.peakActiveUsers,
        totalRequestsToday: this.dailyPeaks.totalRequestsToday
      },
      statusRatio: {
        status2xx: this.minuteBucket.status2xx,
        status3xx: this.minuteBucket.status3xx,
        status4xx: this.minuteBucket.status4xx,
        status5xx: this.minuteBucket.status5xx
      },
      recentHistory: this.recentMetricsHistory
    };
  }
}

module.exports = new StatsAggregator();
