import { readFileSync, writeFileSync, existsSync } from "fs";

// --- Data persistence ---
// TODO: migrate to SQLite (e.g. bun:sqlite) for better concurrency & durability

interface UserRecord {
  token: string;
  temperature: number | null;
  unit: "C" | "F";
  lastSeen: number; // epoch ms
  claimedAt: number;
}

type DataShape = Record<string, UserRecord>;

const DATA_FILE = "data.json";
const TOKEN_EXPIRY_MS = 8 * 24 * 60 * 60 * 1000; // 8 days

function loadData(): DataShape {
  try {
    if (!existsSync(DATA_FILE)) return {};
    const text = readFileSync(DATA_FILE, "utf-8");
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function saveData(data: DataShape) {
  writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function randomToken(): string {
  return crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
}

function pruneExpired(data: DataShape): DataShape {
  const now = Date.now();
  let changed = false;
  for (const [user, rec] of Object.entries(data)) {
    if (now - rec.lastSeen > TOKEN_EXPIRY_MS) {
      delete data[user];
      changed = true;
    }
  }
  if (changed) saveData(data);
  return data;
}

// --- Preload static assets ---
const INDEX_HTML = Bun.file("index.html");
const TEMP_HTML = Bun.file("temperature.html");
const LLMS_TXT = Bun.file("llms.txt");

Bun.serve({
  port: 3000,
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
          return Response.json({ error: "Invalid username. Use 2-32 chars: a-z, 0-9, -, _" }, { status: 400 });
        }

        const data = pruneExpired(loadData());
        if (data[username]) {
          return Response.json({ error: "Username already claimed." }, { status: 409 });
        }

        const token = randomToken();
        const now = Date.now();
        data[username] = { token, temperature: null, unit: "F", lastSeen: now, claimedAt: now };
        saveData(data);
        return Response.json({ username, token, message: "Username claimed! Keep your token safe — you'll need it to submit temperatures." }, { status: 201 });
      },
    },

    "/api/temperature": {
      POST: async (req: Request) => {
        const body = await req.json().catch(() => ({}));
        const token = (body.token || "").toString();
        const temp = Number(body.temperature);
        const unit: "C" | "F" = body.unit === "C" ? "C" : "F";

        if (!token) return Response.json({ error: "Missing token." }, { status: 401 });
        if (isNaN(temp)) return Response.json({ error: "Invalid temperature." }, { status: 400 });

        const data = pruneExpired(loadData());
        const entry = Object.entries(data).find(([_, r]) => r.token === token);
        if (!entry) return Response.json({ error: "Invalid or expired token." }, { status: 403 });

        const [username, rec] = entry;
        rec.temperature = temp;
        rec.unit = unit;
        rec.lastSeen = Date.now();
        saveData(data);

        return Response.json({ username, temperature: rec.temperature, unit: rec.unit, message: "Temperature updated!" });
      },
    },

    "/api/temperature/:username": {
      GET: (req: Request) => {
        const username = req.params.username.toLowerCase();
        const data = pruneExpired(loadData());
        const rec = data[username];
        if (!rec) return Response.json({ error: "User not found." }, { status: 404 });
        return Response.json({ username, temperature: rec.temperature, unit: rec.unit, lastSeen: rec.lastSeen, claimedAt: rec.claimedAt });
      },
    },
  },
  fetch: () => new Response("Not found", { status: 404 }),
});

console.log("🍺 howcoldismy.beer server running on http://localhost:3000");
