# Panduan Deployment `web-stats` (Akses via IP Direct)

Panduan ini menjelaskan deployment **web-stats** agar dapat **langsung diakses melalui IP Server (Port 3000)** tanpa memerlukan domain/NPM, serta memanfaatkan optimasi konfigurasi Nginx `okkabun-nginx` (tanpa menyentuh kode PHP okkabun).

---

## ⚡ Akses Langsung Via IP

Aplikasi `web-stats` mempublikasikan Port `3000` di host server. Anda dapat langsung membukanya di browser via:

```text
http://<SERVER_IP>:3000
contoh: http://10.7.171.20:3000
```

*Catatan: Anda tidak perlu melakukan request domain/subdomain ke admin jaringan maupun setting Nginx Proxy Manager (NPM).*

---

## 🛠️ Langkah Opsional (Disarankan): Optimasi Log Nginx `okkabun-nginx`

Karena Anda mengizinkan perubahan pada konfigurasi Nginx `okkabun` (bukan file PHP), kita bisa mengaktifkan **Format JSON Log** pada Nginx `okkabun`. Hal ini membuat perhitungan *Response Time*, *Peak RPS*, dan *Latency* menjadi **100% presisi**.

### Cara Konfigurasi di `okkabun-nginx`:

Buka file konfigurasi Nginx okkabun (misal: `/srv/docker/okkabun.instiperjogja.ac.id/nginx/default.conf` atau `nginx.conf` inside container `okkabun-nginx`):

```nginx
# 1. Tambahkan format log JSON ini di dalam block http {}
log_format json_analytics escape=json
  '{"time_local":"$time_local",'
  '"remote_addr":"$remote_addr",'
  '"request":"$request",'
  '"status": "$status",'
  '"body_bytes_sent":"$body_bytes_sent",'
  '"request_time":"$request_time",'
  '"upstream_response_time":"$upstream_response_time",'
  '"http_referrer":"$http_referer",'
  '"http_user_agent":"$http_user_agent"}';

server {
    listen 80;
    server_name okkabun.instiperjogja.ac.id;

    # 2. Gunakan log_format json_analytics pada access_log
    access_log /var/log/nginx/access.log json_analytics;

    # ... sisa konfigurasi okkabun php-fpm tetap sama tanpa diubah ...
}
```

Setelah mengubah file config Nginx okkabun, reload Nginx okkabun:
```bash
docker exec -it okkabun-nginx nginx -s reload
```

---

## 🗄️ Langkah 1: Setup Database MySQL Host (10.7.171.20:3306)

Jalankan query SQL dari file `schema.sql` pada MySQL Host:

```bash
mysql -u root -p -h 10.7.171.20 < /srv/apps/web-stats.instiperjogja.ac.id/schema.sql
```

Buat user database (jika belum ada):
```sql
CREATE USER IF NOT EXISTS 'webstats_user'@'%' IDENTIFIED BY 'webstats_password';
GRANT ALL PRIVILEGES ON web_stats_db.* TO 'webstats_user'@'%';
FLUSH PRIVILEGES;
```

---

## 📁 Langkah 2: Copy File ke Struktur Server

```bash
# 1. Buat direktori aplikasi & docker
mkdir -p /srv/apps/web-stats.instiperjogja.ac.id
mkdir -p /srv/docker/web-stats.instiperjogja.ac.id

# 2. Salin seluruh source code proyek ini
cp -r /home/sndyyafnn/Documents/INSTIPER/server/web-stats/* /srv/apps/web-stats.instiperjogja.ac.id/
cp /srv/apps/web-stats.instiperjogja.ac.id/Dockerfile /srv/docker/web-stats.instiperjogja.ac.id/
cp /srv/apps/web-stats.instiperjogja.ac.id/docker-compose.yml /srv/docker/web-stats.instiperjogja.ac.id/
```

---

## 🚀 Langkah 3: Jalankan Container `web-stats`

```bash
cd /srv/docker/web-stats.instiperjogja.ac.id

# Build & Run
docker compose up -d --build

# Cek logs
docker compose logs -f web-stats
```

Setelah container berjalan, buka browser dan akses `http://<SERVER_IP>:3000`.

---

## 📊 Yang Dipantau Tanpa Mengubah Kode PHP okkabun:
1. **Peak Access Traffic (RPS)**: Dihitung per detik dari Nginx log stream.
2. **Peak Active Users Harian**: Sliding window IP unik pengakses dalam 5 menit terakhir.
3. **Latency & Response Time (ms)**: Presisi tinggi dari Nginx `$request_time`.
4. **Server Load**: Pembagian status respon 2xx, 3xx, 4xx, dan 5xx.
