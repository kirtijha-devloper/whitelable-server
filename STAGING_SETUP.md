# POS Server — Staging Setup Guide

Live: `https://pos.abheepay.com` → frontend `/var/www/pos.abheepay.com/pos-client/dist` + API proxy `/api` → `localhost:5003` (`/var/www/pos.abheepay.com/pos-server`, branch `Dev2`, PM2 `pos-server`, DB `posdb`)
Staging: `https://pos-staging.abheepay.com` → frontend `/var/www/pos-staging.abheepay.com/pos-client/dist` + API proxy `/api` → `localhost:5004` (`/var/www/pos-staging.abheepay.com/pos-server`, branch `staging`, PM2 `pos-server-staging`, DB `posdb_staging`)

> Name is `pos-staging.abheepay.com`, NOT `staging.abheepay.com` (that vhost already exists on your VPS). `staging.pos.abheepay.com` would also work, but `staging-pos` avoids confusion with `staging.abheepay.com`.

Flow:

```text
push to `staging` → GitHub Action → pos-staging.abheepay.com (tester tests here)
merge staging → Dev2 → GitHub Action → pos.abheepay.com (live)
```

Existing live workflow `.github/workflows/pos-server-deploy.yml` (Dev2 → live) stays as-is. A second workflow is added for staging.

---

## 1. DNS

Add an `A` record in your domain panel:

```text
pos-staging.abheepay.com → <same VPS IP as pos.abheepay.com>
```

Verify (from VPS):

```bash
nslookup pos-staging.abheepay.com
```

---

## 2. VPS: clone staging copies

SSH to the VPS (`posadmin@srv712000`):

```bash
sudo mkdir -p /var/www/pos-staging.abheepay.com
sudo chown -R $USER:$USER /var/www/pos-staging.abheepay.com
cd /var/www/pos-staging.abheepay.com
git clone <your-pos-server-repo-url> pos-server
git clone <your-pos-client-repo-url> pos-client
```

Create the `staging` branches once (from your local PCs, in each repo):

```bash
git checkout -b staging
git push -u origin staging
```

Then on the VPS:

```bash
cd /var/www/pos-staging.abheepay.com/pos-server
git fetch origin
git checkout staging
cd /var/www/pos-staging.abheepay.com/pos-client
git fetch origin
git checkout staging
```

If the tester only uses Postman (no UI), you can skip `pos-client` and use a backend-only vhost (see §5B).

---

## 3. VPS: staging database + Redis isolation

Do NOT share the live DB.

```bash
sudo -u postgres psql -c "CREATE DATABASE posdb_staging OWNER posuser;"
# test connection
PGPASSWORD='pos@_2525' psql -h localhost -U posuser -d posdb_staging -c "select 1;"
```

Redis: live uses DB `0`. Use DB `1` for staging to isolate Bull queues (`walletWorker`, webhook workers). Staging `.env` must contain:

```text
REDIS_URL=redis://127.0.0.1:6379/1
```

---

## 4. VPS: staging `.env`

Create the file manually on the server (never commit — `.env` is already in `.gitignore`):

```bash
nano /var/www/pos-staging.abheepay.com/pos-server/.env
```

Copy the live `.env`, then change at minimum:

```text
PORT=5004
NODE_ENV=staging
DB_NAME=posdb_staging
DB_USER=posuser
DB_PASS=pos@_2525
DB_HOST=localhost
DB_DIALECT=postgres
REDIS_URL=redis://127.0.0.1:6379/1
# Use TEST/sandbox keys for all gateways:
# BILLAVENUE_API_URL, VIMO_BASE_URL, SEVENPAY_*, IPAY_*, Razorpay, Worldline
# Use a different JWT secret from live if possible
# ENABLE_BRANCHX_PENDING_CRON=false  # keep false unless testing that cron
```

> Critical: if staging uses live payment keys + webhooks, you will double-charge / double-settle. Use sandbox keys. Disable public webhook forwarding on staging.

---

## 5A. Apache: staging vhost (full mirror — frontend + backend, RECOMMENDED)

This mirrors your live config exactly, only paths/ports/names change. Create the port-80 file; `certbot` will generate the `-le-ssl.conf` for 443.

```bash
sudo nano /etc/apache2/sites-available/pos-staging.abheepay.com.conf
```

Paste:

```apache
<VirtualHost *:80>
    ServerName pos-staging.abheepay.com

    DocumentRoot /var/www/pos-staging.abheepay.com/pos-client/dist
    DirectoryIndex index.html

    <Directory /var/www/pos-staging.abheepay.com/pos-client/dist>
        Options -Indexes +FollowSymLinks
        AllowOverride All
        Require all granted
    </Directory>

    # 👇 Proxy API calls to staging backend (live uses 5003, staging uses 5004)
    ProxyPreserveHost On
    ProxyPass /api http://localhost:5004/api
    ProxyPassReverse /api http://localhost:5004/api

    ErrorLog ${APACHE_LOG_DIR}/staging-pos-error.log
    CustomLog ${APACHE_LOG_DIR}/staging-pos-access.log combined

    RewriteEngine on
    RewriteCond %{SERVER_NAME} =pos-staging.abheepay.com
    RewriteRule ^ https://%{SERVER_NAME}%{REQUEST_URI} [END,NE,R=permanent]
</VirtualHost>
```

> SPA routing: your live `-le-ssl.conf` has the `RewriteCond %{REQUEST_FILENAME} !-f` → `/index.html` block inside the `<Directory>`. Certbot does NOT copy that block automatically. After running certbot, re-add it to the 443 vhost (see verification step below).

Enable + SSL:

```bash
sudo a2enmod proxy proxy_http rewrite ssl headers mime
sudo a2ensite pos-staging.abheepay.com
sudo apache2ctl configtest
sudo systemctl reload apache2
sudo certbot --apache -d pos-staging.abheepay.com
# test
curl -I http://pos-staging.abheepay.com
curl -I https://pos-staging.abheepay.com/api/health || curl -I https://pos-staging.abheepay.com/api/
```

After certbot, check the generated file and ensure it looks like live + SPA block:

```bash
cat /etc/apache2/sites-enabled/pos-staging.abheepay.com-le-ssl.conf
```

It must contain (edit if missing):

```apache
<VirtualHost *:443>
    ServerName pos-staging.abheepay.com
    DocumentRoot /var/www/pos-staging.abheepay.com/pos-client/dist
    DirectoryIndex index.html

    <Directory /var/www/pos-staging.abheepay.com/pos-client/dist>
        Options -Indexes +FollowSymLinks
        AllowOverride All
        Require all granted
        <IfModule mod_rewrite.c>
            RewriteEngine On
            RewriteCond %{REQUEST_FILENAME} !-f
            RewriteCond %{REQUEST_FILENAME} !-d
            RewriteRule ^ /index.html [L]
        </IfModule>
    </Directory>

    <IfModule mime_module>
        AddType application/javascript .js
    </IfModule>

    ProxyPreserveHost On
    ProxyPass /api http://localhost:5004/api
    ProxyPassReverse /api http://localhost:5004/api

    ErrorLog ${APACHE_LOG_DIR}/staging-pos-error.log
    CustomLog ${APACHE_LOG_DIR}/staging-pos-access.log combined

    SSLCertificateFile /etc/letsencrypt/live/pos-staging.abheepay.com/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/pos-staging.abheepay.com/privkey.pem
    Include /etc/letsencrypt/options-ssl-apache.conf
</VirtualHost>
```

Then `sudo apache2ctl configtest && sudo systemctl reload apache2`.

Build/deploy the staging frontend once:

```bash
cd /var/www/pos-staging.abheepay.com/pos-client
# set its .env to point API to https://pos-staging.abheepay.com/api
npm install && npm run build
```

---

## 5B. Apache: backend-only vhost (alternative, no UI)

Use this only if the tester works with Postman. Same file path, different content:

```apache
<VirtualHost *:80>
    ServerName pos-staging.abheepay.com
    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:5004/
    ProxyPassReverse / http://127.0.0.1:5004/
    ErrorLog ${APACHE_LOG_DIR}/staging-pos-error.log
    CustomLog ${APACHE_LOG_DIR}/staging-pos-access.log combined
</VirtualHost>
```

---

## 6. PM2: add staging app

Update `ecosystem.config.js` in the repo (works on both servers, `cwd` selects the right folder):

```js
module.exports = {
  apps: [
    {
      name: "pos-server",
      script: "server.js",
      cwd: "/var/www/pos.abheepay.com/pos-server",
      env: { NODE_ENV: "production", PORT: "5003" /* live DB/redis */ }
    },
    {
      name: "pos-server-staging",
      script: "server.js",
      cwd: "/var/www/pos-staging.abheepay.com/pos-server",
      env: { NODE_ENV: "staging", PORT: "5004" }
      // DB/redis come from the .env file on the staging server, don't hardcode secrets here
    }
  ]
};
```

First start on the VPS:

```bash
cd /var/www/pos-staging.abheepay.com/pos-server
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 14
npm install --production
mkdir -p logs
npx sequelize db:migrate
pm2 start ecosystem.config.js --only pos-server-staging
pm2 save
pm2 list
curl http://127.0.0.1:5004/api/health || curl http://127.0.0.1:5004/
```

---

## 7. GitHub Action: auto-deploy staging

Create `.github/workflows/pos-server-staging-deploy.yml`:

```yaml
name: Deploy POS Server - Staging

on:
  push:
    branches:
      - staging

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Deploy Staging via SSH
        uses: appleboy/ssh-action@v1.0.3
        with:
          host: ${{ secrets.SERVER_HOST }}
          username: ${{ secrets.SERVER_USER }}
          key: ${{ secrets.SERVER_SSH_KEY }}
          script: |
            cd /var/www/pos-staging.abheepay.com/pos-server
            git fetch origin
            git reset --hard origin/staging
            export NVM_DIR="$HOME/.nvm"
            [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
            nvm use 14
            npm install --production
            mkdir -p logs
            npx sequelize db:migrate || { echo "Migration failed"; exit 1; }
            pm2 reload ecosystem.config.js --only pos-server-staging
            echo "Staging deployed"
```

No new secrets needed — reuses `SERVER_HOST` / `SERVER_USER` / `SERVER_SSH_KEY` since it is the same VPS. Push to `staging` = auto-deploy staging. Push/merge to `Dev2` = auto-deploy live (existing file).

Add a second workflow in the `pos-client` repo with the same trigger that builds `dist` in `/var/www/pos-staging.abheepay.com/pos-client`.

---

## 8. Tester workflow

1. Devs work on feature branches → PR to `staging`.
2. Merge auto-deploys to `https://pos-staging.abheepay.com` in ~1 min.
3. Tester only needs the URL + test logins, no SSH. Seed a test user in `posdb_staging`.
4. Bug → fix on a new branch → merge to `staging` → retest.
5. Approved → PR `staging` → `Dev2` → auto-deploys live.

Protect branches in GitHub: Settings → Branches → require PR + tester approval for `Dev2`.

Verify end-to-end:

```bash
git checkout staging && git push origin staging  # watch the Actions tab
pm2 logs pos-server-staging --lines 50
cat /var/log/apache2/staging-pos-error.log
```

Rollback staging:

```bash
cd /var/www/pos-staging.abheepay.com/pos-server
git reset --hard origin/staging~1 && pm2 reload ecosystem.config.js --only pos-server-staging
```
