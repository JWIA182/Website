import express from "express";
import cors from "cors";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "data.json");

const defaultStore = {
  settings: {
    focus: 25,
    short: 5,
    long: 15,
    cycles: 4,
    autoStart: false,
    chime: true,
  },
  tasks: [],
  stats: {
    totalMinutes: 0,
    sessions: 0,
    tasksDone: 0,
    streak: 0,
    longestStreak: 0,
    lastSessionDate: null,
  },
  state: {
    activeTaskId: null,
  },
};

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

let store = structuredClone(defaultStore);

async function loadStore() {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    store = {
      settings: { ...defaultStore.settings, ...(parsed.settings || {}) },
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      stats: { ...defaultStore.stats, ...(parsed.stats || {}) },
      state: { ...defaultStore.state, ...(parsed.state || {}) },
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      await saveStore();
    } else {
      console.error("Failed to load data store", error);
    }
  }
}

async function saveStore() {
  const snapshot = JSON.stringify(store, null, 2);
  await fs.writeFile(DATA_FILE, snapshot, "utf8");
}

function respondWith(resource, res) {
  res.json(store[resource]);
}

app.get("/api/settings", (req, res) => respondWith("settings", res));
app.put("/api/settings", async (req, res, next) => {
  try {
    store.settings = { ...store.settings, ...(req.body || {}) };
    await saveStore();
    respondWith("settings", res);
  } catch (error) {
    next(error);
  }
});

app.get("/api/tasks", (req, res) => respondWith("tasks", res));
app.put("/api/tasks", async (req, res, next) => {
  try {
    store.tasks = Array.isArray(req.body) ? req.body : store.tasks;
    await saveStore();
    respondWith("tasks", res);
  } catch (error) {
    next(error);
  }
});

app.get("/api/stats", (req, res) => respondWith("stats", res));
app.put("/api/stats", async (req, res, next) => {
  try {
    store.stats = { ...store.stats, ...(req.body || {}) };
    await saveStore();
    respondWith("stats", res);
  } catch (error) {
    next(error);
  }
});

app.get("/api/state", (req, res) => respondWith("state", res));
app.put("/api/state", async (req, res, next) => {
  try {
    store.state = { ...store.state, ...(req.body || {}) };
    await saveStore();
    respondWith("state", res);
  } catch (error) {
    next(error);
  }
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ message: "Internal server error" });
});

loadStore().then(() => {
  app.listen(PORT, () => {
    console.log(`FocusFlow API listening on port ${PORT}`);
  });
});
