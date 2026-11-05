# Raspberry Pi + Tailscale setup

Run job-triage as an always-on service on a Pi 5 so your **phone** can use the UI over Tailscale. Your laptop stays for development and local testing.

## Prerequisites

- Raspberry Pi OS **64-bit** (Bookworm or newer)
- Pi 5 with enough free disk (~2GB+ for Node, Chromium, deps)
- [Tailscale](https://tailscale.com) account (free personal)
- Git remote for this repo (so you can `git pull` on the Pi)

## 1. Node 22 on the Pi

```bash
# Using nvm (recommended)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
# restart shell / source nvm
nvm install 22
nvm use 22
node -v   # v22.x
```

## 2. Tailscale

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
tailscale status
# Note MagicDNS name, e.g. raspberrypi.tailXXXX.ts.net
```

On your **phone**: install Tailscale, sign in to the same account, stay connected.

## 3. Clone and install

```bash
cd ~
git clone <your-repo-url> job-triage
cd job-triage
npm install
npm install --prefix web

# Playwright system deps + Chromium (Stage 2)
sudo npx playwright install-deps
npx playwright install chromium
```

Optional virtual display for headed Chromium without a monitor:

```bash
sudo apt-get install -y xvfb
```

## 4. Environment

```bash
cp .env.example .env
nano .env   # set ANTHROPIC_API_KEY (and optional ANTHROPIC_MODEL)
```

Never commit `.env`.

## 5. Build the web UI

```bash
npm run build --prefix web
```

## 6. systemd service

Create `/etc/systemd/system/job-triage.service` (adjust paths and user):

```ini
[Unit]
Description=Job triage Next.js UI
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/job-triage/web
Environment=NODE_ENV=production
Environment=HOST=0.0.0.0
Environment=PORT=4173
EnvironmentFile=/home/pi/job-triage/.env
# If Node is via nvm, point ExecStart at the absolute node binary:
#   which node
ExecStart=/home/pi/.nvm/versions/node/v22.23.2/bin/node /home/pi/job-triage/web/node_modules/next/dist/bin/next start -H 0.0.0.0 -p 4173
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable job-triage
sudo systemctl start job-triage
sudo systemctl status job-triage
```

## 7. Open from the phone

1. Phone on Tailscale.
2. For day-to-day browsing: `http://<magicdns>:4173` works fine.
3. **To install as a home-screen app (PWA)** Chrome needs **HTTPS**. Plain `http://…ts.net:4173` only allows “Create shortcut” (opens Chrome). Enable Tailscale Serve once per machine:

```bash
# First time: open the link Tailscale prints (enable Serve on your tailnet), then:
tailscale serve --bg 4173
tailscale serve status
# Phone: https://<magicdns>/   (no :4173 — Serve terminates TLS on 443)
```

Do **not** port-forward 4173 on your 5G modem. Tailscale is enough.

### Stage 2 on the Pi (unattended)

From the UI Pipeline tab: leave **Unattended** checked (passes `--no-pause`). Optionally enable **Headless**.

CLI example:

```bash
cd ~/job-triage
# Best effort without waiting for Enter:
npm run fetch-details -- <basename> --limit 5 --no-pause

# Or with xvfb + headed Chromium:
xvfb-run -a npm run fetch-details -- <basename> --limit 5 --no-pause
```

Failures stay in SQLite (`detail_status` / errors); retry later.

## 8. Update after laptop development

On the **laptop**:

```bash
# develop + test
HOST=0.0.0.0 npm run preview
# phone on same Wi‑Fi → http://<laptop-lan-ip>:4173
git push
```

On the **Pi**:

```bash
cd ~/job-triage
git pull
npm install
npm install --prefix web
npm run build --prefix web
sudo systemctl restart job-triage
```

## Local laptop testing (before Pi)

Same codebase:

```bash
nvm use   # Node 22+
npm install
npm install --prefix web
npm run preview
# Listens on 0.0.0.0:4173 by default
# Phone on Wi‑Fi: http://<your-laptop-ip>:4173
# Localhost only: HOST=127.0.0.1 npm run preview
```

Use the **Apply** tab on the phone, **Pipeline** for upload / fetch / Stage 3, **Triage** for the full table.
