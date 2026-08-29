const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || '10.7.171.20',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'web_stats_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
});

async function testConnection() {
  try {
    const connection = await pool.getConnection();
    console.log(`[DB] Connected to MySQL host at ${process.env.DB_HOST}:${process.env.DB_PORT}`);
    connection.release();
    return true;
  } catch (err) {
    console.error(`[DB WARN] MySQL Connection Warning (${process.env.DB_HOST}):`, err.message);
    return false;
  }
}

module.exports = {
  pool,
  testConnection
};
