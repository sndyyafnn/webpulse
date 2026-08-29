# Panduan Deployment `web-stats` (Akses via IP Direct)

Panduan ini menjelaskan deployment **web-stats** agar dapat **langsung diakses melalui IP Server (Port 3000)** tanpa memerlukan domain/NPM, serta memanfaatkan optimasi konfigurasi Nginx `okkabun-nginx` (tanpa menyentuh kode PHP okkabun).

---

## ⚡ Akses Langsung Via IP

Aplikasi `web-stats` mempublikasikan Port `3000` di host server. Anda dapat langsung membukanya di browser via:

```text
http://<SERVER_IP>:3000
contoh: http://10.7.171.20:3000
```

---

## 🛠️ Langkah Opsional: Optimasi Log Nginx `okkabun-nginx`

Format **Log JSON Nginx** (`json_analytics`) pada Nginx `okkabun` membuat perhitungan *Response Time*, *Peak RPS*, dan *Latency* menjadi **100% presisi**.

Buka file konfigurasi Nginx okkabun (misal: `/srv/docker/okkabun.instiperjogja.ac.id/nginx/default.conf`):

```nginx
log_format json_analytics escape=json
  '{"time_local":"$time_local",'
  '"remote_addr":"$remote_addr",'
  '"request":"$request",'
  '"status": "$status",'
  '"body_bytes_sent":"$body_bytes_sent",'
  '"request_time":"$request_time",'
  '"upstream_response_time":"$upstream_response_time",'
  '"http_user_agent":"$http_user_agent"}';

server {
    listen 80;
    server_name okkabun.instiperjogja.ac.id;

    access_log /var/log/nginx/access.log json_analytics;
}
```

Reload Nginx okkabun:
```bash
docker exec -it okkabun-nginx nginx -s reload
```

---

## 🗄️ Langkah 1: Setup Database MySQL Host (10.7.171.20:3306)

Database default: `webpulse`  
User DB default: `webpulse`  
Password DB default: `@Instiper2026!`

Query penyiapan database:
```sql
CREATE DATABASE IF NOT EXISTS `webpulse`;

CREATE USER IF NOT EXISTS 'webpulse'@'%' IDENTIFIED BY '@Instiper2026!';
GRANT ALL PRIVILEGES ON webpulse.* TO 'webpulse'@'%';
FLUSH PRIVILEGES;
```

Import schema tabel:
```bash
mysql -u webpulse -p'@Instiper2026!' -h 10.7.171.20 webpulse < schema.sql
```

---

## 🚀 Langkah 2: Jalankan Container `web-stats`

```bash
cd /srv/docker/webpulse

# Rebuild & Run
docker compose up -d --build
```

Buka browser dan akses `http://<SERVER_IP>:3000`.
