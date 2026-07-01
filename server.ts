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

// --- Helpers ---
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

function json(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// --- Preload static assets at startup ---
const INDEX_HTML = Bun.file("index.html");
const TEMP_HTML = Bun.file("temperature.html");
const LLMS_TXT = Bun.file("llms.txt");

// --- Server ---
Bun.serve({
  port: 3000,
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    // --- API routes ---
    if (path === "/api/claim" && method === "POST") {
      const body = await req.json().catch(() => ({}));
      const username = (body.username || "").toString().trim().toLowerCase();
      if (!username || !/^[a-z0-9_-]{2,32}$/.test(username)) {
        return json({ error: "Invalid username. Use 2-32 chars: a-z, 0-9, -, _" }, 400);
      }

      const data = pruneExpired(loadData());
      if (data[username]) {
        return json({ error: "Username already claimed." }, 409);
      }

      const token = randomToken();
      const now = Date.now();
      data[username] = {
        token,
        temperature: null,
        unit: "F",
        lastSeen: now,
        claimedAt: now,
      };
      saveData(data);
      return json({ username, token, message: "Username claimed! Keep your token safe — you'll need it to submit temperatures." }, 201);
    }

    if (path === "/api/temperature" && method === "POST") {
      const body = await req.json().catch(() => ({}));
      const token = (body.token || "").toString();
      const temp = Number(body.temperature);
      const unit: "C" | "F" = body.unit === "C" ? "C" : "F";

      if (!token) return json({ error: "Missing token." }, 401);
      if (isNaN(temp)) return json({ error: "Invalid temperature." }, 400);

      const data = pruneExpired(loadData());
      const entry = Object.entries(data).find(([_, r]) => r.token === token);
      if (!entry) return json({ error: "Invalid or expired token." }, 403);

      const [username, rec] = entry;
      rec.temperature = temp;
      rec.unit = unit;
      rec.lastSeen = Date.now();
      saveData(data);

      return json({ username, temperature: rec.temperature, unit: rec.unit, message: "Temperature updated!" }, 200);
    }

    // GET /api/temperature/<username>
    const tempMatch = path.match(/^\/api\/temperature\/([a-z0-9_-]+)$/);
    if (tempMatch && method === "GET") {
      const username = tempMatch[1].toLowerCase();
      const data = pruneExpired(loadData());
      const rec = data[username];
      if (!rec) return json({ error: "User not found." }, 404);
      return json({
        username,
        temperature: rec.temperature,
        unit: rec.unit,
        lastSeen: rec.lastSeen,
        claimedAt: rec.claimedAt,
      }, 200);
    }

    // --- SPA route: /t/<username> ---
    const userMatch = path.match(/^\/t\/([a-z0-9_-]+)$/);
    if (userMatch && method === "GET") {
      return new Response(TEMP_HTML, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // --- Static files ---
    if (path === "/" || path === "/index.html") {
      return new Response(INDEX_HTML, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    if (path === "/llms.txt") {
      return new Response(LLMS_TXT, {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log("🍺 howcoldismy.beer server running on http://localhost:3000");
