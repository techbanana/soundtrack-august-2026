# Soundtrack → Slack Offline Monitor

Checks all Banan Soundtrack zones (Kaimuki, Noe Valley, Waikiki Shack) every ~5 minutes via GitHub Actions and posts to Slack **only when a location changes state** — 🔴 when it goes offline, 🟢 when it comes back. No startup spam, no laptop required.

## One-time setup (about 10 minutes)

### 1. Create the repo

1. Go to https://github.com/new
2. Name it something like `soundtrack-monitor`, set it to **Private**, create it.

### 2. Upload these files

Easiest with git from Terminal:

```bash
cd ~/Downloads/soundtrack-monitor   # wherever you unzipped this
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/soundtrack-monitor.git
git push -u origin main
```

(Or use the GitHub web UI: "Add file → Upload files". If you go this route, you must also create `.github/workflows/monitor.yml` manually via "Add file → Create new file" since hidden folders don't upload well.)

### 3. Add your two secrets

In the repo: **Settings → Secrets and variables → Actions → New repository secret**

| Name | Value |
|---|---|
| `SOUNDTRACK_API_TOKEN` | Your Soundtrack API token (same one from last time) |
| `SLACK_WEBHOOK_URL` | Your Slack incoming webhook URL |

### 4. Test it

1. Go to the **Actions** tab → "Soundtrack Monitor" → **Run workflow**
2. Set `send_test` to `true` → Run. You should get a ✅ test message in Slack within a minute.
3. Run it again with `send_test` left as `false`. This records the baseline status silently (check the run log — you should see all three locations listed 🟢).

That's it. From now on it runs automatically every ~5 minutes.

## How it behaves

- **Silent when healthy.** No messages unless something changes.
- **🔴 alert** when a zone disconnects from Soundtrack (device off, WiFi down, app closed).
- **🟢 alert** when it reconnects.
- Pausing music or stopping a schedule does **not** trigger an alert — only a true disconnect does.
- Last-known status lives in `state/status.json`, committed by the workflow itself, so restarts/redeploys never re-alert or spam.
- If the Soundtrack API or Slack is unreachable, the run fails visibly in the Actions tab (GitHub emails you on repeated failures) but sends no false alerts.

## Real-world test

Go to one location, kill the WiFi on the Soundtrack device or force-quit the app, and wait up to ~10 minutes (GitHub's cron can lag a few minutes past the 5-minute mark). You should get the 🔴 message, then a 🟢 when you reconnect it.

## Notes

- GitHub Actions cron is "at least every 5 minutes, usually within 5–15." Fine for this purpose; a down location will be caught within ~10 minutes worst case.

### ⚠️ Repo visibility & Actions minutes

GitHub bills Actions on **private** repos at a 1-minute minimum per run. Every-5-minutes = ~8,600 minutes/month, far over the 2,000-minute free allowance. Two options:

1. **Make the repo public (recommended).** Actions are completely free/unlimited on public repos. Your API token and webhook live in GitHub Secrets — never in the code — so the only thing visible is the script itself and the zone names/online status in `state/status.json`. Low sensitivity.
2. **Keep it private and slow the cron down.** Edit `monitor.yml` → change cron to `"*/30 * * * *"` (~1,440 min/month, under the free limit). Detection lag becomes up to ~35 minutes, which may still be fine for background music.
