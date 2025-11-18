const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) =>
  Array.from(scope.querySelectorAll(selector));

const STORAGE_KEYS = {
  settings: "focusflow:settings",
  tasks: "focusflow:tasks",
  stats: "focusflow:stats",
  state: "focusflow:state",
  projects: "focusflow:projects",
  sessions: "focusflow:sessions",
};

const defaultSettings = {
  focus: 25,
  short: 5,
  long: 15,
  cycles: 4,
  autoStart: false,
  chime: true,
};

const chime = $("#chime-sound");

let settings = load(STORAGE_KEYS.settings, defaultSettings);
let tasks = load(STORAGE_KEYS.tasks, []);
let stats = load(STORAGE_KEYS.stats, {
  totalMinutes: 0,
  sessions: 0,
  tasksDone: 0,
  streak: 0,
  longestStreak: 0,
  lastSessionDate: null,
});
let projects = load(STORAGE_KEYS.projects, []);
let sessions = load(STORAGE_KEYS.sessions, []);

const state = {
  mode: "focus",
  remaining: settings.focus * 60,
  timerId: null,
  cycleCount: 0,
  activeTaskId: load(STORAGE_KEYS.state, { activeTaskId: null }).activeTaskId,
  sessionStart: null,
};

const countdownEl = $("#countdown");
const statusEl = $("#timer-status");
const primaryAction = $("#primary-action");
const skipBtn = $("#skip-action");
const modeButtons = $$(".mode-btn");
const taskList = $("#task-list");
const taskTemplate = $("#task-item-template");
const taskForm = $("#task-form");
const projectForm = $("#project-form");
const clearFinishedBtn = $("#clear-finished");
const settingsForm = $("#settings-form");
const resetStatsBtn = $("#reset-stats");
const streakCountEl = $("#streak-count");
const activeTaskEl = $("#active-task");
const projectSelect = $("#project-select");
const projectList = $("#project-list");
const sessionList = $("#session-list");
const clearSessionsBtn = $("#clear-sessions");

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
  projectForm.addEventListener("submit", handleProjectSubmit);
  clearFinishedBtn.addEventListener("click", clearCompletedTasks);
  resetStatsBtn.addEventListener("click", resetStats);
  clearSessionsBtn.addEventListener("click", clearSessions);
  settingsForm.addEventListener("submit", handleSettingsSubmit);

  populateSettingsForm();
  renderTasks();
  renderProjects();
  renderSessions();
  renderStats();
  updateActiveTaskLabel();
  renderTimer();
}

function load(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    if (!value) {
      return cloneFallback(fallback);
    }
    const parsed = JSON.parse(value);
    if (Array.isArray(fallback)) {
      return Array.isArray(parsed) ? parsed : cloneFallback(fallback);
    }
    return { ...fallback, ...parsed };
  } catch {
    return cloneFallback(fallback);
  }
}

function cloneFallback(fallback) {
  if (Array.isArray(fallback)) {
    return [...fallback];
  }
  return { ...fallback };
}

function persist() {
  localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
  localStorage.setItem(STORAGE_KEYS.tasks, JSON.stringify(tasks));
  localStorage.setItem(STORAGE_KEYS.stats, JSON.stringify(stats));
  localStorage.setItem(STORAGE_KEYS.projects, JSON.stringify(projects));
  localStorage.setItem(STORAGE_KEYS.sessions, JSON.stringify(sessions));
  localStorage.setItem(
    STORAGE_KEYS.state,
    JSON.stringify({ activeTaskId: state.activeTaskId })
  );
}

function switchMode(mode) {
  if (state.mode === mode) return;
  state.mode = mode;
  state.remaining = settings[mode] * 60;
  state.sessionStart = null;
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
  if (!state.sessionStart) {
    state.sessionStart = Date.now();
  }
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
  state.sessionStart = null;
}

function nextMode() {
  if (state.mode === "focus") {
    return state.cycleCount && state.cycleCount % settings.cycles === 0
      ? "long"
      : "short";
  }
  return "focus";
}

function handleTaskSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const title = form.task.value.trim();
  if (!title) return;
  const estimate = Number(form.estimate.value) || 1;
  const projectId = form.project.value || null;
  tasks.push({
    id: crypto.randomUUID(),
    title,
    estimate,
    completed: 0,
    done: false,
    projectId,
  });
  form.reset();
  renderTasks();
  persist();
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
    const projectBadge = $(".task-project", node);

    node.dataset.id = task.id;
    title.textContent = task.title;
    checkbox.checked = task.done;
    progress.textContent = `${task.completed}/${task.estimate}`;
    node.classList.toggle("active", state.activeTaskId === task.id);
    const project = projects.find((p) => p.id === task.projectId);
    if (project) {
      projectBadge.textContent = project.name;
      projectBadge.style.setProperty("--project-color", project.color);
    } else {
      projectBadge.textContent = "";
      projectBadge.removeAttribute("style");
    }

    checkbox.addEventListener("change", () => toggleTask(task.id));
    selectBtn.addEventListener("click", () => setActiveTask(task.id));
    deleteBtn.addEventListener("click", () => deleteTask(task.id));

    taskList.appendChild(node);
  });
}

function toggleTask(id) {
  const current = tasks.find((task) => task.id === id);
  if (!current) return;
  const nextDone = !current.done;
  tasks = tasks.map((task) =>
    task.id === id ? { ...task, done: nextDone } : task
  );
  adjustTaskDoneStat(current.done, nextDone);
  renderTasks();
  renderStats();
  persist();
}

function adjustTaskDoneStat(previous, next) {
  if (previous === next) return;
  if (next) {
    stats.tasksDone += 1;
  } else {
    stats.tasksDone = Math.max(0, stats.tasksDone - 1);
  }
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

function handleProjectSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const name = form.projectName.value.trim();
  if (!name) return;
  const color = form.projectColor.value || "#6b5bff";
  projects.push({
    id: crypto.randomUUID(),
    name,
    color,
  });
  form.reset();
  form.projectColor.value = "#6b5bff";
  renderProjects();
  renderTasks();
  persist();
}

function renderProjects() {
  updateProjectSelectOptions();
  projectList.innerHTML = "";
  if (!projects.length) {
    const empty = document.createElement("li");
    empty.className = "project-empty";
    empty.textContent = "Create a project to group related tasks.";
    projectList.appendChild(empty);
    return;
  }
  projects.forEach((project) => {
    const item = document.createElement("li");
    item.className = "project-item";
    const meta = document.createElement("div");
    meta.className = "project-meta";

    const dot = document.createElement("span");
    dot.className = "project-dot";
    dot.style.setProperty("--project-color", project.color);

    const info = document.createElement("div");
    info.className = "project-info";
    const title = document.createElement("p");
    title.textContent = project.name;
    const statsLine = document.createElement("small");
    const taskCount = getProjectTaskCount(project.id);
    const minutes = getProjectMinutes(project.id);
    statsLine.textContent = `${taskCount} task${taskCount === 1 ? "" : "s"} • ${minutes} min`;
    info.appendChild(title);
    info.appendChild(statsLine);

    meta.appendChild(dot);
    meta.appendChild(info);

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "text-btn";
    deleteBtn.type = "button";
    deleteBtn.textContent = "Remove";
    deleteBtn.addEventListener("click", () => deleteProject(project.id));

    item.appendChild(meta);
    item.appendChild(deleteBtn);
    projectList.appendChild(item);
  });
}

function updateProjectSelectOptions() {
  if (!projectSelect) return;
  const current = projectSelect.value;
  projectSelect.innerHTML = "";
  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "No project";
  projectSelect.appendChild(defaultOption);
  projects.forEach((project) => {
    const option = document.createElement("option");
    option.value = project.id;
    option.textContent = project.name;
    projectSelect.appendChild(option);
  });
  if (current && projects.some((project) => project.id === current)) {
    projectSelect.value = current;
  }
}

function deleteProject(id) {
  projects = projects.filter((project) => project.id !== id);
  tasks = tasks.map((task) =>
    task.projectId === id ? { ...task, projectId: null } : task
  );
  if (state.activeTaskId && !tasks.find((task) => task.id === state.activeTaskId)) {
    state.activeTaskId = null;
  }
  updateActiveTaskLabel();
  renderProjects();
  renderTasks();
  persist();
}

function getProjectTaskCount(projectId) {
  return tasks.filter((task) => task.projectId === projectId).length;
}

function getProjectMinutes(projectId) {
  return sessions.reduce((total, session) => {
    if (session.projectId === projectId && session.mode === "focus") {
      return total + session.minutes;
    }
    return total;
  }, 0);
}

function renderSessions() {
  sessionList.innerHTML = "";
  if (!sessions.length) {
    const empty = document.createElement("li");
    empty.className = "session-empty";
    empty.textContent = "Complete a focus to start building history.";
    sessionList.appendChild(empty);
    return;
  }
  sessions.slice(0, 12).forEach((session) => {
    const item = document.createElement("li");
    item.className = "session-item";

    const header = document.createElement("div");
    header.className = "session-item__header";

    const mode = document.createElement("span");
    mode.className = `session-mode session-mode--${session.mode}`;
    mode.textContent = formatModeLabel(session.mode);

    const timestamp = document.createElement("time");
    timestamp.dateTime = session.completedAt;
    timestamp.textContent = formatSessionTime(session.completedAt);

    header.appendChild(mode);
    header.appendChild(timestamp);

    const body = document.createElement("div");
    body.className = "session-item__body";
    const taskTitle = document.createElement("p");
    taskTitle.textContent = session.taskTitle;
    body.appendChild(taskTitle);

    if (session.projectName) {
      const badge = document.createElement("span");
      badge.className = "session-project";
      if (session.projectColor) {
        badge.style.setProperty("--project-color", session.projectColor);
      }
      badge.textContent = session.projectName;
      body.appendChild(badge);
    }

    const minutes = document.createElement("span");
    minutes.className = "session-minutes";
    minutes.textContent = `${session.minutes} min`;

    item.appendChild(header);
    item.appendChild(body);
    item.appendChild(minutes);
    sessionList.appendChild(item);
  });
}

function clearSessions() {
  sessions = [];
  renderSessions();
  renderProjects();
  persist();
}

function formatModeLabel(mode) {
  if (mode === "focus") return "Focus";
  if (mode === "short") return "Short break";
  return "Long break";
}

function formatSessionTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleString([], {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
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
  if (!task) {
    activeTaskEl.textContent = "No task selected";
    return;
  }
  const project = projects.find((p) => p.id === task.projectId);
  const suffix = project ? ` • ${project.name}` : "";
  activeTaskEl.textContent = `Currently: ${task.title}${suffix}`;
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
  const minutes = getElapsedMinutes();
  const completedAt = new Date();
  const startedAt = state.sessionStart
    ? new Date(state.sessionStart)
    : completedAt;
  const activeTask = tasks.find((task) => task.id === state.activeTaskId);
  const project = activeTask
    ? projects.find((p) => p.id === activeTask.projectId)
    : null;
  const entry = {
    id: crypto.randomUUID(),
    mode: state.mode,
    minutes,
    completedAt: completedAt.toISOString(),
    startedAt: startedAt.toISOString(),
    taskId: activeTask?.id || null,
    taskTitle: activeTask?.title || "Unassigned focus",
    projectId: project?.id || null,
    projectName: project?.name || null,
    projectColor: project?.color || null,
  };
  sessions = [entry, ...sessions].slice(0, 50);
  stats.sessions += 1;
  if (state.mode === "focus") {
    stats.totalMinutes += minutes;
    updateStreak();
  }
  renderSessions();
  renderStats();
  persist();
}

function getElapsedMinutes() {
  if (!state.sessionStart) {
    return Math.round(settings[state.mode]);
  }
  const elapsedMs = Math.max(0, Date.now() - state.sessionStart);
  const elapsedMinutes = Math.round(elapsedMs / 60000);
  return Math.max(1, elapsedMinutes);
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
