const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) =>
  Array.from(scope.querySelectorAll(selector));

const STORAGE_KEYS = {
  settings: "focusflow:settings",
  tasks: "focusflow:tasks",
  stats: "focusflow:stats",
  state: "focusflow:state",
  catalogues: "focusflow:catalogues",
};

const defaultSettings = {
  focus: 25,
  short: 5,
  long: 15,
  cycles: 4,
  autoStart: false,
  chime: true,
};

const defaultCatalogues = [{ id: "inbox", name: "Inbox" }];
const defaultState = { activeTaskId: null, catalogueFilter: "all" };

const chime = $("#chime-sound");

let settings = load(STORAGE_KEYS.settings, defaultSettings);
let catalogues = load(STORAGE_KEYS.catalogues, defaultCatalogues);
ensureDefaultCatalogue();

let tasks = load(STORAGE_KEYS.tasks, []);
if (!Array.isArray(tasks)) tasks = [];
tasks = tasks.map(applyTaskSchema);
let stats = load(STORAGE_KEYS.stats, {
  totalMinutes: 0,
  sessions: 0,
  tasksDone: 0,
  streak: 0,
  longestStreak: 0,
  lastSessionDate: null,
});

const savedState = load(STORAGE_KEYS.state, defaultState);
const state = {
  mode: "focus",
  remaining: settings.focus * 60,
  timerId: null,
  cycleCount: 0,
  activeTaskId: savedState.activeTaskId,
  catalogueFilter: savedState.catalogueFilter,
};

if (
  state.catalogueFilter !== "all" &&
  !catalogues.find((cat) => cat.id === state.catalogueFilter)
) {
  state.catalogueFilter = "all";
}

const countdownEl = $("#countdown");
const statusEl = $("#timer-status");
const primaryAction = $("#primary-action");
const skipBtn = $("#skip-action");
const modeButtons = $$(".mode-btn");
const taskList = $("#task-list");
const taskTemplate = $("#task-item-template");
const taskForm = $("#task-form");
const catalogueFilterEl = $("#catalogue-filter");
const catalogueSelect = $("#catalogue-select");
const newCatalogueInput = $("#new-catalogue-input");
const fileInput = $("#task-files");
const linkInput = $("#task-links");
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

setup();

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
  if (catalogueFilterEl) {
    catalogueFilterEl.addEventListener("click", handleCatalogueFilter);
  }

  populateSettingsForm();
  renderCatalogueOptions();
  renderCatalogueFilters();
  renderTasks();
  renderStats();
  updateActiveTaskLabel();
  renderTimer();
}

function load(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    if (!value) return clone(fallback);
    const parsed = JSON.parse(value);
    if (Array.isArray(fallback)) {
      return Array.isArray(parsed) ? parsed : clone(fallback);
    }
    if (typeof fallback === "object" && fallback !== null) {
      return { ...fallback, ...parsed };
    }
    return parsed ?? clone(fallback);
  } catch {
    return clone(fallback);
  }
}

function clone(value) {
  if (Array.isArray(value)) return [...value];
  if (typeof value === "object" && value !== null) return { ...value };
  return value;
}

function persist() {
  localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
  localStorage.setItem(STORAGE_KEYS.tasks, JSON.stringify(tasks));
  localStorage.setItem(STORAGE_KEYS.stats, JSON.stringify(stats));
  localStorage.setItem(
    STORAGE_KEYS.catalogues,
    JSON.stringify(catalogues)
  );
  localStorage.setItem(
    STORAGE_KEYS.state,
    JSON.stringify({
      activeTaskId: state.activeTaskId,
      catalogueFilter: state.catalogueFilter,
    })
  );
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
  statusEl.textContent = state.timerId ? "In progress" : "Ready when you are.";
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
  let catalogueId = catalogueSelect?.value || getDefaultCatalogueId();
  const newCatalogueName = newCatalogueInput?.value.trim();
  if (newCatalogueName) {
    const created = addCatalogue(newCatalogueName);
    catalogueId = created.id;
    newCatalogueInput.value = "";
  }
  const uploadedFiles = await readUploadedFiles(fileInput?.files);
  const linkedFiles = parseLinkEntries(linkInput?.value);
  const files = [...uploadedFiles, ...linkedFiles];
  tasks.push({
    id: crypto.randomUUID(),
    title,
    estimate,
    completed: 0,
    done: false,
    catalogueId,
    files,
  });
  form.reset();
  if (catalogueSelect) {
    catalogueSelect.value = catalogueId;
  }
  if (linkInput) linkInput.value = "";
  if (fileInput) fileInput.value = "";
  renderTasks();
  persist();
}

function renderTasks() {
  taskList.innerHTML = "";
  renderCatalogueFilters();
  const visibleTasks =
    state.catalogueFilter === "all"
      ? tasks
      : tasks.filter((task) => task.catalogueId === state.catalogueFilter);

  if (!visibleTasks.length) {
    const empty = document.createElement("li");
    empty.className = "task-empty";
    empty.textContent =
      state.catalogueFilter === "all"
        ? "No tasks yet. Add one to get started."
        : "No tasks in this catalogue yet.";
    taskList.appendChild(empty);
    return;
  }

  visibleTasks.forEach((task) => {
    const node = taskTemplate.content.firstElementChild.cloneNode(true);
    const checkbox = $(".task-check", node);
    const title = $(".task-title", node);
    const progress = $(".task-progress", node);
    const selectBtn = $(".select-task", node);
    const deleteBtn = $(".delete-task", node);
    const cataloguePill = $(".task-catalogue-pill", node);
    const filesList = $(".task-files", node);

    node.dataset.id = task.id;
    title.textContent = task.title;
    checkbox.checked = task.done;
    progress.textContent = `${task.completed}/${task.estimate}`;
    node.classList.toggle("active", state.activeTaskId === task.id);
    if (cataloguePill) {
      cataloguePill.textContent = getCatalogueName(task.catalogueId);
    }
    if (filesList) {
      filesList.innerHTML = "";
      (task.files || []).forEach((file) => {
        const item = document.createElement("li");
        const link = document.createElement("a");
        if (file.type === "upload") {
          link.href = file.data;
          link.download = file.name;
          link.textContent = file.name;
        } else {
          link.href = file.url;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.textContent = file.name || file.url;
        }
        item.appendChild(link);
        filesList.appendChild(item);
      });
      filesList.hidden = !(task.files && task.files.length);
    }

    checkbox.addEventListener("change", () => toggleTask(task.id));
    selectBtn.addEventListener("click", () => setActiveTask(task.id));
    deleteBtn.addEventListener("click", () => deleteTask(task.id));

    taskList.appendChild(node);
  });
}

function toggleTask(id) {
  tasks = tasks.map((task) =>
    task.id === id ? { ...task, done: !task.done } : task
  );
  if (tasks.find((t) => t.id === id)?.done) {
    stats.tasksDone += 1;
  }
  renderTasks();
  renderStats();
  persist();
}

function setActiveTask(id) {
  state.activeTaskId = id;
  updateActiveTaskLabel();
  renderTasks();
  persist();
}

function deleteTask(id) {
  tasks = tasks.filter((task) => task.id !== id);
  if (state.activeTaskId === id) {
    state.activeTaskId = null;
    updateActiveTaskLabel();
  }
  renderTasks();
  persist();
}

function clearCompletedTasks() {
  tasks = tasks.filter((task) => !task.done);
  if (!tasks.find((task) => task.id === state.activeTaskId)) {
    state.activeTaskId = null;
    updateActiveTaskLabel();
  }
  renderTasks();
  persist();
}

function creditActiveTask() {
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
  persist();
}

function updateActiveTaskLabel() {
  const task = tasks.find((t) => t.id === state.activeTaskId);
  activeTaskEl.textContent = task
    ? `Currently: ${task.title} · ${getCatalogueName(task.catalogueId)}`
    : "No task selected";
}

function applyTaskSchema(task) {
  return {
    ...task,
    catalogueId: task.catalogueId || getDefaultCatalogueId(),
    files: Array.isArray(task.files) ? task.files : [],
  };
}

function ensureDefaultCatalogue() {
  if (!Array.isArray(catalogues) || !catalogues.length) {
    catalogues = defaultCatalogues.map((cat) => ({ ...cat }));
  }
}

function getDefaultCatalogueId() {
  ensureDefaultCatalogue();
  return catalogues[0]?.id || defaultCatalogues[0].id;
}

function addCatalogue(name) {
  const trimmed = name.trim();
  if (!trimmed) {
    return catalogues.find((cat) => cat.id === getDefaultCatalogueId());
  }
  const catalogue = { id: crypto.randomUUID(), name: trimmed };
  catalogues.push(catalogue);
  renderCatalogueOptions(catalogue.id);
  renderCatalogueFilters();
  persist();
  return catalogue;
}

function renderCatalogueOptions(selectedId) {
  if (!catalogueSelect) return;
  ensureDefaultCatalogue();
  catalogueSelect.innerHTML = "";
  catalogues.forEach((catalogue) => {
    const option = document.createElement("option");
    option.value = catalogue.id;
    option.textContent = catalogue.name;
    catalogueSelect.appendChild(option);
  });
  const fallbackId = getDefaultCatalogueId();
  const preferredId =
    (selectedId && catalogues.some((cat) => cat.id === selectedId) && selectedId) ||
    (state.catalogueFilter !== "all" &&
      catalogues.some((cat) => cat.id === state.catalogueFilter) &&
      state.catalogueFilter) ||
    fallbackId;
  catalogueSelect.value = preferredId;
}

function renderCatalogueFilters() {
  if (!catalogueFilterEl) return;
  ensureDefaultCatalogue();
  catalogueFilterEl.innerHTML = "";
  const fragment = document.createDocumentFragment();
  fragment.appendChild(
    createCatalogueFilterButton("all", "All", tasks.length)
  );
  catalogues.forEach((catalogue) => {
    const count = tasks.filter((task) => task.catalogueId === catalogue.id).length;
    fragment.appendChild(
      createCatalogueFilterButton(catalogue.id, catalogue.name, count)
    );
  });
  catalogueFilterEl.appendChild(fragment);
}

function createCatalogueFilterButton(id, label, count) {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.id = id;
  button.className = "catalogue-filter__btn";
  if (state.catalogueFilter === id) {
    button.classList.add("active");
  }
  const labelSpan = document.createElement("span");
  labelSpan.textContent = label;
  const countSpan = document.createElement("span");
  countSpan.className = "catalogue-filter__count";
  countSpan.textContent = count;
  button.appendChild(labelSpan);
  button.appendChild(countSpan);
  return button;
}

function handleCatalogueFilter(event) {
  const button = event.target.closest("button");
  if (!button || !button.dataset.id) return;
  const nextFilter = button.dataset.id;
  if (state.catalogueFilter === nextFilter) return;
  state.catalogueFilter = nextFilter;
  renderTasks();
  persist();
}

function getCatalogueName(id) {
  return catalogues.find((cat) => cat.id === id)?.name || "Inbox";
}

function parseLinkEntries(value = "") {
  if (!value) return [];
  return value
    .split(/\n|,/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const url = /^https?:\/\//i.test(entry) ? entry : `https://${entry}`;
      const name = entry.replace(/^https?:\/\//i, "").replace(/\/$/, "");
      return {
        id: crypto.randomUUID(),
        type: "link",
        name: name || url,
        url,
      };
    });
}

async function readUploadedFiles(fileList) {
  if (!fileList || !fileList.length) return [];
  const readers = Array.from(fileList).map((file) => readFileAsDataUrl(file));
  const results = await Promise.allSettled(readers);
  return results
    .filter((result) => result.status === "fulfilled")
    .map((result) => result.value);
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve({
        id: crypto.randomUUID(),
        type: "upload",
        name: file.name,
        size: file.size,
        mime: file.type,
        data: reader.result,
      });
    };
    reader.onerror = () => reject(reader.error || new Error("Upload failed"));
    reader.readAsDataURL(file);
  });
}

function handleSettingsSubmit(event) {
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
  persist();
}

function populateSettingsForm() {
  settingsForm.focus.value = settings.focus;
  settingsForm.short.value = settings.short;
  settingsForm.long.value = settings.long;
  settingsForm.cycles.value = settings.cycles;
  settingsForm.autoStart.checked = settings.autoStart;
  settingsForm.chime.checked = settings.chime;
}

function recordSession() {
  const minutes = Math.round(settings[state.mode]);
  stats.sessions += 1;
  if (state.mode === "focus") {
    stats.totalMinutes += minutes;
    updateStreak();
  }
  renderStats();
  persist();
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

function resetStats() {
  stats = {
    totalMinutes: 0,
    sessions: 0,
    tasksDone: 0,
    streak: 0,
    longestStreak: 0,
    lastSessionDate: null,
  };
  renderStats();
  persist();
}
