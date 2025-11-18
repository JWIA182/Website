const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) =>
  Array.from(scope.querySelectorAll(selector));

const API_BASE =
  window.FOCUSFLOW_API_BASE ||
  (window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1"
    ? "http://localhost:4000/api"
    : "/api");

const defaultSettings = {
  focus: 25,
  short: 5,
  long: 15,
  cycles: 4,
  autoStart: false,
  chime: true,
};

const defaultStats = {
  totalMinutes: 0,
  sessions: 0,
  tasksDone: 0,
  streak: 0,
  longestStreak: 0,
  lastSessionDate: null,
};

const chime = $("#chime-sound");

let settings = { ...defaultSettings };
let tasks = [];
let stats = { ...defaultStats };

let syncErrorMessage = "";

const state = {
  mode: "focus",
  remaining: settings.focus * 60,
  timerId: null,
  cycleCount: 0,
  activeTaskId: null,
};

const countdownEl = $("#countdown");
const statusEl = $("#timer-status");
const primaryAction = $("#primary-action");
const skipBtn = $("#skip-action");
const modeButtons = $$(".mode-btn");
const taskList = $("#task-list");
const taskTemplate = $("#task-item-template");
const taskForm = $("#task-form");
const clearFinishedBtn = $("#clear-finished");
const settingsForm = $("#settings-form");
const resetStatsBtn = $("#reset-stats");
const streakCountEl = $("#streak-count");
const activeTaskEl = $("#active-task");

const statsEls = {
  minutes: $("#total-minutes"),
  sessions: $("#session-count"),
  tasks: $("#tasks-done"),
  longest: $("#longest-streak"),
};

init();

async function init() {
  await Promise.all([
    loadSettings(),
    loadTasks(),
    loadStats(),
    loadTimerState(),
  ]);
  setup();
}

function setup() {
  modeButtons.forEach((btn) =>
    btn.addEventListener("click", () => switchMode(btn.dataset.mode))
  );
  primaryAction.addEventListener("click", toggleTimer);
  skipBtn.addEventListener("click", skipInterval);
  taskForm.addEventListener("submit", handleTaskSubmit);
  clearFinishedBtn.addEventListener("click", clearCompletedTasks);
  resetStatsBtn.addEventListener("click", resetStats);
  settingsForm.addEventListener("submit", handleSettingsSubmit);

  populateSettingsForm();
  renderTasks();
  renderStats();
  updateActiveTaskLabel();
  renderTimer();
}

function switchMode(mode) {
  if (state.mode === mode) return;
  state.mode = mode;
  state.remaining = settings[mode] * 60;
  stopTimer();
  renderTimer();
  updateModeButtons();
}

function updateModeButtons() {
  modeButtons.forEach((btn) =>
    btn.classList.toggle("active", btn.dataset.mode === state.mode)
  );
  const label =
    state.mode === "focus"
      ? "Focus"
      : state.mode === "short"
      ? "Short Break"
      : "Long Break";
  primaryAction.textContent = `Start ${label}`;
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const s = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}`;
}

function renderTimer() {
  countdownEl.textContent = formatTime(state.remaining);
  renderStatus();
}

function renderStatus() {
  if (syncErrorMessage) {
    statusEl.textContent = syncErrorMessage;
    statusEl.classList.add("error");
    return;
  }
  statusEl.textContent = state.timerId ? "In progress" : "Ready when you are.";
  statusEl.classList.remove("error");
}

function toggleTimer() {
  if (state.timerId) {
    stopTimer();
    statusEl.textContent = "Paused";
    return;
  }
  startTimer();
}

function startTimer() {
  statusEl.textContent = "Let\'s focus";
  primaryAction.textContent = "Pause";
  state.timerId = setInterval(() => {
    state.remaining -= 1;
    renderTimer();
    if (state.remaining <= 0) {
      handleIntervalComplete();
    }
  }, 1000);
}

function stopTimer() {
  clearInterval(state.timerId);
  state.timerId = null;
  updateModeButtons();
  renderTimer();
}

function skipInterval() {
  if (!state.timerId && state.remaining === settings[state.mode] * 60) {
    switchMode(nextMode());
    return;
  }
  handleIntervalComplete(true);
}

function handleIntervalComplete(skipped = false) {
  stopTimer();
  state.remaining = settings[state.mode] * 60;

  if (!skipped) {
    recordSession();
    if (state.mode === "focus") {
      state.cycleCount += 1;
      creditActiveTask();
    }
  }

  const next = nextMode();
  switchMode(next);
  if (settings.autoStart) {
    startTimer();
  }
  if (settings.chime && !skipped) {
    chime.currentTime = 0;
    chime.play().catch(() => {});
  }
}

function nextMode() {
  if (state.mode === "focus") {
    return state.cycleCount && state.cycleCount % settings.cycles === 0
      ? "long"
      : "short";
  }
  return "focus";
}

async function handleTaskSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const title = form.task.value.trim();
  if (!title) return;
  const estimate = Number(form.estimate.value) || 1;
  tasks.push({
    id: crypto.randomUUID(),
    title,
    estimate,
    completed: 0,
    done: false,
  });
  form.reset();
  renderTasks();
  await persistTasks();
}

function renderTasks() {
  taskList.innerHTML = "";
  tasks.forEach((task) => {
    const node = taskTemplate.content.firstElementChild.cloneNode(true);
    const checkbox = $(".task-check", node);
    const title = $(".task-title", node);
    const progress = $(".task-progress", node);
    const selectBtn = $(".select-task", node);
    const deleteBtn = $(".delete-task", node);

    node.dataset.id = task.id;
    title.textContent = task.title;
    checkbox.checked = task.done;
    progress.textContent = `${task.completed}/${task.estimate}`;
    node.classList.toggle("active", state.activeTaskId === task.id);

    checkbox.addEventListener("change", () => toggleTask(task.id));
    selectBtn.addEventListener("click", () => setActiveTask(task.id));
    deleteBtn.addEventListener("click", () => deleteTask(task.id));

    taskList.appendChild(node);
  });
}

async function toggleTask(id) {
  tasks = tasks.map((task) =>
    task.id === id ? { ...task, done: !task.done } : task
  );
  if (tasks.find((t) => t.id === id)?.done) {
    stats.tasksDone += 1;
  }
  renderTasks();
  renderStats();
  const saved = await persistTasks({ reloadStats: true });
  if (!saved) return;
  await persistStats();
}

async function setActiveTask(id) {
  state.activeTaskId = id;
  updateActiveTaskLabel();
  renderTasks();
  await persistTimerState();
}

async function deleteTask(id) {
  const wasActive = state.activeTaskId === id;
  tasks = tasks.filter((task) => task.id !== id);
  if (wasActive) {
    state.activeTaskId = null;
    updateActiveTaskLabel();
  }
  renderTasks();
  const saved = await persistTasks({ reloadState: wasActive });
  if (!saved) return;
  if (wasActive) {
    await persistTimerState();
  }
}

async function clearCompletedTasks() {
  tasks = tasks.filter((task) => !task.done);
  const activeExists = tasks.find((task) => task.id === state.activeTaskId);
  const lostActive = Boolean(state.activeTaskId) && !activeExists;
  if (lostActive) {
    state.activeTaskId = null;
    updateActiveTaskLabel();
  }
  renderTasks();
  const saved = await persistTasks({ reloadState: lostActive });
  if (!saved || !lostActive) return;
  await persistTimerState();
}

async function creditActiveTask() {
  if (!state.activeTaskId) return;
  tasks = tasks.map((task) => {
    if (task.id !== state.activeTaskId) return task;
    const completed = Math.min(task.estimate, task.completed + 1);
    const done = completed >= task.estimate ? true : task.done;
    if (done && !task.done) {
      stats.tasksDone += 1;
    }
    return { ...task, completed, done };
  });
  renderTasks();
  renderStats();
  const saved = await persistTasks({ reloadStats: true });
  if (!saved) return;
  await persistStats();
}

function updateActiveTaskLabel() {
  const task = tasks.find((t) => t.id === state.activeTaskId);
  activeTaskEl.textContent = task
    ? `Currently: ${task.title}`
    : "No task selected";
}

async function handleSettingsSubmit(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  settings = {
    focus: Number(formData.get("focus")),
    short: Number(formData.get("short")),
    long: Number(formData.get("long")),
    cycles: Number(formData.get("cycles")),
    autoStart: Boolean(formData.get("autoStart")),
    chime: Boolean(formData.get("chime")),
  };
  state.remaining = settings[state.mode] * 60;
  stopTimer();
  renderTimer();
  await persistSettings();
}

function populateSettingsForm() {
  settingsForm.focus.value = settings.focus;
  settingsForm.short.value = settings.short;
  settingsForm.long.value = settings.long;
  settingsForm.cycles.value = settings.cycles;
  settingsForm.autoStart.checked = settings.autoStart;
  settingsForm.chime.checked = settings.chime;
}

async function recordSession() {
  const minutes = Math.round(settings[state.mode]);
  stats.sessions += 1;
  if (state.mode === "focus") {
    stats.totalMinutes += minutes;
    updateStreak();
  }
  renderStats();
  await persistStats();
}

function updateStreak() {
  const today = new Date();
  const todayKey = today.toDateString();
  if (!stats.lastSessionDate) {
    stats.streak = 1;
  } else {
    const last = new Date(stats.lastSessionDate);
    const diff = Math.floor((today - last) / (1000 * 60 * 60 * 24));
    if (diff === 0) {
      // already counted today
    } else if (diff === 1) {
      stats.streak += 1;
    } else {
      stats.streak = 1;
    }
  }
  stats.lastSessionDate = todayKey;
  stats.longestStreak = Math.max(stats.longestStreak, stats.streak);
  streakCountEl.textContent = stats.streak;
}

function renderStats() {
  statsEls.minutes.textContent = stats.totalMinutes;
  statsEls.sessions.textContent = stats.sessions;
  statsEls.tasks.textContent = stats.tasksDone;
  statsEls.longest.textContent = stats.longestStreak;
  streakCountEl.textContent = stats.streak;
}

async function resetStats() {
  stats = { ...defaultStats };
  renderStats();
  await persistStats();
}

async function loadSettings() {
  const data = await getResource("settings", defaultSettings);
  settings = { ...defaultSettings, ...data };
  state.remaining = settings[state.mode] * 60;
}

async function loadTasks() {
  const data = await getResource("tasks", []);
  tasks = Array.isArray(data) ? data : [];
}

async function loadStats() {
  const data = await getResource("stats", defaultStats);
  stats = { ...defaultStats, ...data };
}

async function loadTimerState() {
  const data = await getResource("state", { activeTaskId: null });
  state.activeTaskId = data?.activeTaskId ?? null;
}

async function persistSettings() {
  return persistResource("settings", settings);
}

async function persistTasks({ reloadStats = false, reloadState = false } = {}) {
  return persistResource("tasks", tasks, {
    onError: async () => {
      await reloadResource("tasks");
      const reloads = [];
      if (reloadStats) reloads.push(reloadResource("stats"));
      if (reloadState) reloads.push(reloadResource("state"));
      await Promise.all(reloads);
    },
  });
}

async function persistStats() {
  return persistResource("stats", stats);
}

async function persistTimerState() {
  return persistResource("state", { activeTaskId: state.activeTaskId });
}

async function persistResource(resource, payload, { onError } = {}) {
  try {
    await requestJSON(`${API_BASE}/${resource}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    clearSyncError();
    return true;
  } catch (error) {
    console.error(`Failed to persist ${resource}`, error);
    setSyncError("Unable to save changes. Reverting to the last saved data.");
    if (onError) {
      await onError(error);
    } else {
      await reloadResource(resource);
    }
    return false;
  }
}

async function reloadResource(resource) {
  try {
    const data = await requestJSON(`${API_BASE}/${resource}`);
    switch (resource) {
      case "settings":
        settings = { ...defaultSettings, ...data };
        state.remaining = settings[state.mode] * 60;
        stopTimer();
        renderTimer();
        populateSettingsForm();
        break;
      case "tasks":
        tasks = Array.isArray(data) ? data : [];
        renderTasks();
        if (!tasks.find((task) => task.id === state.activeTaskId)) {
          state.activeTaskId = null;
          updateActiveTaskLabel();
        }
        break;
      case "stats":
        stats = { ...defaultStats, ...data };
        renderStats();
        break;
      case "state":
        state.activeTaskId = data?.activeTaskId ?? null;
        updateActiveTaskLabel();
        renderTasks();
        break;
      default:
        break;
    }
    clearSyncError();
  } catch (error) {
    console.error(`Failed to reload ${resource}`, error);
    setSyncError("Still offline. We'll retry when you're back online.");
  }
}

async function getResource(resource, fallback) {
  try {
    const data = await requestJSON(`${API_BASE}/${resource}`);
    clearSyncError();
    return data;
  } catch (error) {
    console.error(`Failed to load ${resource}`, error);
    setSyncError("Offline mode: showing defaults until sync resumes.");
    return fallback;
  }
}

async function requestJSON(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

function setSyncError(message) {
  syncErrorMessage = message;
  renderStatus();
}

function clearSyncError() {
  if (!syncErrorMessage) return;
  syncErrorMessage = "";
  renderStatus();
}
