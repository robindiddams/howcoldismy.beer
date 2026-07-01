import { readFileSync, writeFileSync, existsSync } from "fs";
import { randomToken } from "./ecoji";
import INDEX_HTML_FILE from "./index.html" with { type: "file" };
import TEMP_HTML_FILE from "./temperature.html" with { type: "file" };
import LLMS_TXT_FILE from "./llms.txt" with { type: "file" };

// Read embedded files at startup into strings for serving as Responses
const INDEX_HTML_STR = readFileSync(INDEX_HTML_FILE, "utf-8");
const TEMP_HTML_STR = readFileSync(TEMP_HTML_FILE, "utf-8");
const LLMS_TXT_STR = readFileSync(LLMS_TXT_FILE, "utf-8");

// --- Data persistence ---
// TODO: migrate to SQLite (e.g. bun:sqlite) for better concurrency & durability

interface UserRecord {
  token: string;
  temperature: number | null;
  unit: "C" | "F";
  preset: string | null; // e.g. "super-chill", "frigid", "damn-cold"
  lastSeen: number; // epoch ms
  claimedAt: number;
}

interface DataShape {
  _counter: number;
  users: Record<string, UserRecord>;
}

const DATA_FILE = process.env.DATA_FILE || "data.json";
const TOKEN_EXPIRY_MS = 8 * 24 * 60 * 60 * 1000; // 8 days

// Preset temperature vibes
const PRESETS: Record<string, { label: string; temp: number; unit: "F" }> = {
  "super-chill": { label: "Super chill", temp: 40, unit: "F" },
  "frigid": { label: "Absolutely Frigid", temp: 28, unit: "F" },
  "damn-cold": { label: "Damn Cold", temp: 33, unit: "F" },
};

function loadData(): DataShape {
  try {
    if (!existsSync(DATA_FILE)) return { _counter: 0, users: {} };
    const raw = JSON.parse(readFileSync(DATA_FILE, "utf-8"));
    if (!raw.users) return { _counter: raw._counter || 0, users: raw };
    return raw;
  } catch {
    return { _counter: 0, users: {} };
  }
}

function saveData(data: DataShape) {
  writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function pruneExpired(data: DataShape): DataShape {
  const now = Date.now();
  let changed = false;
  for (const [user, rec] of Object.entries(data.users)) {
    if (now - rec.lastSeen > TOKEN_EXPIRY_MS) {
      delete data.users[user];
      changed = true;
    }
  }
  if (changed) saveData(data);
  return data;
}

// --- Preload static assets (embedded in binary) ---
const INDEX_HTML = new Response(INDEX_HTML_STR, { headers: { "Content-Type": "text/html" } });
const TEMP_HTML = new Response(TEMP_HTML_STR, { headers: { "Content-Type": "text/html" } });
const LLMS_TXT = new Response(LLMS_TXT_STR, { headers: { "Content-Type": "text/plain" } });

Bun.serve({
  port: Number(process.env.PORT) || 6334,
  routes: {
    // --- Static ---
    "/": INDEX_HTML,
    "/llms.txt": LLMS_TXT,

    // --- Temperature page (SPA) ---
    "/t/:username": TEMP_HTML,

    // --- API ---
    "/api/claim": {
      POST: async (req: Request) => {
        const body = await req.json().catch(() => ({}));
        const username = (body.username || "").toString().trim().toLowerCase();
        if (!username || !/^[a-z0-9_-]{2,32}$/.test(username)) {
          return Response.json({ error: "you gotta be chill with this regex: ^[a-z0-9_-]{2,32}$" }, { status: 400 });
        }

        const data = pruneExpired(loadData());
        if (data.users[username]) {
          return Response.json({ error: "Username already claimed." }, { status: 409 });
        }

        const token = randomToken();
        const now = Date.now();
        data.users[username] = { token, temperature: null, unit: "F", preset: null, lastSeen: now, claimedAt: now };
        saveData(data);
        return Response.json({ username, token, message: "Username claimed! Keep your token safe." }, { status: 201 });
      },
    },

    "/api/temperature": {
      POST: async (req: Request) => {
        const body = await req.json().catch(() => ({}));
        const token = (body.token || "").toString();
        const unit: "C" | "F" = body.unit === "C" ? "C" : "F";
        const preset = (body.preset || "").toString() || null;

        if (!token) return Response.json({ error: "Missing token." }, { status: 401 });

        let temp: number;
        let presetId: string | null = null;

        if (preset && PRESETS[preset]) {
          temp = PRESETS[preset].temp;
          presetId = preset;
        } else {
          temp = Number(body.temperature);
          if (isNaN(temp)) return Response.json({ error: "Invalid temperature." }, { status: 400 });
        }

        const data = pruneExpired(loadData());
        const entry = Object.entries(data.users).find(([_, r]) => r.token === token);
        if (!entry) return Response.json({ error: "Invalid or expired token." }, { status: 403 });

        const [username, rec] = entry;
        rec.temperature = temp;
        rec.unit = unit;
        rec.preset = presetId;
        rec.lastSeen = Date.now();
        data._counter = (data._counter || 0) + 1;
        saveData(data);

        return Response.json({ username, temperature: rec.temperature, unit: rec.unit, preset: presetId, message: "Checkin logged!" });
      },
    },

    "/api/temperature/:username": {
      GET: (req: Request) => {
        const username = req.params.username.toLowerCase();
        const data = pruneExpired(loadData());
        const rec = data.users[username];
        if (!rec) return Response.json({ error: "User not found." }, { status: 404 });
        return Response.json({ username, temperature: rec.temperature, unit: rec.unit, preset: rec.preset, lastSeen: rec.lastSeen, claimedAt: rec.claimedAt });
      },
    },

    "/api/recent": {
      GET: () => {
        const data = pruneExpired(loadData());
        const now = Date.now();
        const recent = Object.entries(data.users)
          .filter(([_, r]) => r.temperature !== null)
          .sort((a, b) => b[1].lastSeen - a[1].lastSeen)
          .slice(0, 8)
          .map(([username, r]) => {
            const secs = Math.floor((now - r.lastSeen) / 1000);
            let ago: string;
            if (secs < 60) ago = secs + "s ago";
            else if (secs < 3600) ago = Math.floor(secs / 60) + "m ago";
            else if (secs < 86400) ago = Math.floor(secs / 3600) + "h ago";
            else ago = Math.floor(secs / 86400) + "d ago";
            return { username, temperature: r.temperature, unit: r.unit, preset: r.preset, ago };
          });
        return Response.json(recent);
      },
    },
  },
  fetch: () => new Response("Not found", { status: 404 }),
});

console.log("🍺 howcoldismy.beer server running on http://localhost:6334");
