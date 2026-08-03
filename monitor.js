/**
 * Soundtrack → Slack offline monitor
 *
 * Runs once per invocation (designed for GitHub Actions cron):
 *   1. Queries the Soundtrack API for all sound zones and their online status
 *   2. Compares against the last known state in state/status.json
 *   3. Sends a Slack message ONLY when a zone changes state (offline/online)
 *   4. Writes the new state back to state/status.json
 *
 * Env vars required:
 *   SOUNDTRACK_API_TOKEN  - Soundtrack API token (used as Basic auth)
 *   SLACK_WEBHOOK_URL     - Slack incoming webhook URL
 * Optional:
 *   SEND_TEST=true        - send a test Slack message and exit (no state change)
 */

const fs = require("fs");
const path = require("path");

const API_URL = "https://api.soundtrackyourbrand.com/v2";
const STATE_FILE = path.join(__dirname, "state", "status.json");

const API_TOKEN = process.env.SOUNDTRACK_API_TOKEN;
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

if (!API_TOKEN || !SLACK_WEBHOOK_URL) {
  console.error("Missing SOUNDTRACK_API_TOKEN or SLACK_WEBHOOK_URL env var.");
  process.exit(1);
}

const QUERY = `
{
  me {
    ... on PublicAPIClient {
      accounts(first: 10) {
        edges {
          node {
            businessName
            locations(first: 50) {
              edges {
                node {
                  name
                  soundZones(first: 50) {
                    edges {
                      node {
                        id
                        name
                        isPaired
                        online
                        device { id name }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
`;

async function fetchZones() {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${API_TOKEN}`,
    },
    body: JSON.stringify({ query: QUERY }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Soundtrack API HTTP ${res.status}: ${body.slice(0, 500)}`);
  }

  const json = await res.json();
  if (json.errors && json.errors.length) {
    throw new Error(`Soundtrack API errors: ${JSON.stringify(json.errors).slice(0, 800)}`);
  }

  const zones = [];
  const accounts = json?.data?.me?.accounts?.edges || [];
  for (const acct of accounts) {
    const locations = acct?.node?.locations?.edges || [];
    for (const loc of locations) {
      const soundZones = loc?.node?.soundZones?.edges || [];
      for (const sz of soundZones) {
        const z = sz.node;
        zones.push({
          id: z.id,
          location: loc.node.name,
          zone: z.name,
          online: Boolean(z.online && z.isPaired),
        });
      }
    }
  }
  return zones;
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return null; // first run
  }
}

function saveState(zones) {
  const state = {
    updatedAt: new Date().toISOString(),
    zones: Object.fromEntries(zones.map((z) => [z.id, { location: z.location, zone: z.zone, online: z.online }])),
  };
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
}

async function sendSlack(text, blocks) {
  const res = await fetch(SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(blocks ? { text, blocks } : { text }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Slack webhook HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
}

function hstTime() {
  return new Date().toLocaleString("en-US", {
    timeZone: "Pacific/Honolulu",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function offlineMessage(z) {
  return {
    text: `🔴 ${z.location} is OFFLINE on Soundtrack`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `🔴 *${z.location}* (zone: ${z.zone}) is *OFFLINE* on Soundtrack\n_${hstTime()} HST — check the device's power, WiFi, and the Soundtrack app._`,
        },
      },
    ],
  };
}

function onlineMessage(z) {
  return {
    text: `🟢 ${z.location} is back ONLINE on Soundtrack`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `🟢 *${z.location}* (zone: ${z.zone}) is back *ONLINE* — ${hstTime()} HST`,
        },
      },
    ],
  };
}

async function main() {
  if (process.env.SEND_TEST === "true") {
    await sendSlack(`✅ Soundtrack monitor test — webhook is working. (${hstTime()} HST)`);
    console.log("Test message sent to Slack.");
    return;
  }

  const zones = await fetchZones();
  if (zones.length === 0) {
    throw new Error("Soundtrack API returned zero zones — not updating state or alerting.");
  }

  console.log(`Checked ${zones.length} zone(s):`);
  for (const z of zones) {
    console.log(`  ${z.online ? "🟢" : "🔴"} ${z.location} / ${z.zone}`);
  }

  const prev = loadState();

  if (!prev) {
    // First run: record baseline silently, no alerts.
    saveState(zones);
    console.log("First run — baseline saved, no alerts sent.");
    return;
  }

  const changes = [];
  for (const z of zones) {
    const before = prev.zones?.[z.id];
    if (!before) continue; // new zone appeared; just start tracking it
    if (before.online && !z.online) changes.push({ type: "offline", zone: z });
    if (!before.online && z.online) changes.push({ type: "online", zone: z });
  }

  for (const c of changes) {
    const msg = c.type === "offline" ? offlineMessage(c.zone) : onlineMessage(c.zone);
    await sendSlack(msg.text, msg.blocks);
    console.log(`Alert sent: ${c.type} — ${c.zone.location}`);
  }

  if (changes.length === 0) {
    console.log("No status changes — staying quiet.");
  }

  saveState(zones);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
