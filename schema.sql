-- Schema Database untuk web-stats.instiperjogja.ac.id
-- Host: 10.7.171.20:3306

CREATE DATABASE IF NOT EXISTS `web_stats_db` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `web_stats_db`;

-- Tabel 1: Agregasi Lalu Lintas Per Menit (Time-series data)
CREATE TABLE IF NOT EXISTS `traffic_metrics` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `site_name` VARCHAR(100) NOT NULL DEFAULT 'okkabun.instiperjogja.ac.id',
  `timestamp` DATETIME NOT NULL,
  `total_requests` INT UNSIGNED NOT NULL DEFAULT 0,
  `peak_rps` INT UNSIGNED NOT NULL DEFAULT 0,
  `active_ips` INT UNSIGNED NOT NULL DEFAULT 0,
  `avg_response_time_ms` INT UNSIGNED NOT NULL DEFAULT 0,
  `total_bytes` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `status_2xx` INT UNSIGNED NOT NULL DEFAULT 0,
  `status_3xx` INT UNSIGNED NOT NULL DEFAULT 0,
  `status_4xx` INT UNSIGNED NOT NULL DEFAULT 0,
  `status_5xx` INT UNSIGNED NOT NULL DEFAULT 0,
  INDEX `idx_site_timestamp` (`site_name`, `timestamp`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Tabel 2: Catatan Peak Traffic & Users Harian
CREATE TABLE IF NOT EXISTS `daily_peaks` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `site_name` VARCHAR(100) NOT NULL DEFAULT 'okkabun.instiperjogja.ac.id',
  `date` DATE NOT NULL,
  `peak_active_users` INT UNSIGNED NOT NULL DEFAULT 0,
  `peak_active_users_time` DATETIME NULL,
  `peak_rps` INT UNSIGNED NOT NULL DEFAULT 0,
  `peak_rps_time` DATETIME NULL,
  `total_daily_requests` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `avg_daily_response_ms` INT UNSIGNED NOT NULL DEFAULT 0,
  `updated_at` DATETIME NOT NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_site_date` (`site_name`, `date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Tabel 3: Log Health Check & Probe Latency
CREATE TABLE IF NOT EXISTS `health_probes` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `site_name` VARCHAR(100) NOT NULL DEFAULT 'okkabun.instiperjogja.ac.id',
  `timestamp` DATETIME NOT NULL,
  `status_code` INT NOT NULL DEFAULT 0,
  `latency_ms` INT UNSIGNED NOT NULL DEFAULT 0,
  `is_healthy` TINYINT(1) NOT NULL DEFAULT 1,
  INDEX `idx_probe_timestamp` (`site_name`, `timestamp`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
