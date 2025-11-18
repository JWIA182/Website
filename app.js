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
};

const countdownEl = $("#countdown");
const statusEl = $("#timer-status");
const primaryAction = $("#primary-action");
const skipBtn = $("#skip-action");
const modeButtons = $$(".mode-btn");
const taskList = $("#task-list");
const taskTemplate = $("#task-item-template");
const taskForm = $("#task-form");
const projectSelect = $("#project-input");
const clearFinishedBtn = $("#clear-finished");
const projectForm = $("#project-form");
const projectList = $("#project-list");
const resetProjectsBtn = $("#reset-projects");
const settingsForm = $("#settings-form");
const resetStatsBtn = $("#reset-stats");
const streakCountEl = $("#streak-count");
const activeTaskEl = $("#active-task");
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
  clearFinishedBtn.addEventListener("click", clearCompletedTasks);
  projectForm.addEventListener("submit", handleProjectSubmit);
  resetProjectsBtn.addEventListener("click", resetProjects);
  resetStatsBtn.addEventListener("click", resetStats);
  clearSessionsBtn.addEventListener("click", clearSessions);
  settingsForm.addEventListener("submit", handleSettingsSubmit);

  populateSettingsForm();
  renderTasks();
  renderProjects();
  renderStats();
  renderSessionLog();
  updateActiveTaskLabel();
  renderTimer();
}

function load(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    if (!value) return cloneFallback(fallback);
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
  if (Array.isArray(fallback)) return [...fallback];
  if (typeof fallback === "object" && fallback !== null) {
    return { ...fallback };
  }
  return fallback;
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
  form.project.value = "";
  renderTasks();
  updateActiveTaskLabel();
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
    const projectChip = $(".task-project", node);

    node.dataset.id = task.id;
    title.textContent = task.title;
    checkbox.checked = task.done;
    progress.textContent = `${task.completed}/${task.estimate}`;
    node.classList.toggle("active", state.activeTaskId === task.id);

    const project = projects.find((p) => p.id === task.projectId);
    if (project) {
      projectChip.textContent = project.name;
      projectChip.style.setProperty("--project-color", project.color);
      projectChip.hidden = false;
    } else {
      projectChip.hidden = true;
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
  updateActiveTaskLabel();
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
  if (!task) {
    activeTaskEl.textContent = "No task selected";
    return;
  }
  const project = projects.find((p) => p.id === task.projectId);
  activeTaskEl.textContent = project
    ? `Currently: ${task.title} (${project.name})`
    : `Currently: ${task.title}`;
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
  const activeTask = tasks.find((task) => task.id === state.activeTaskId);
  const project = projects.find((p) => p.id === activeTask?.projectId);
  sessions.push({
    id: crypto.randomUUID(),
    completedAt: new Date().toISOString(),
    mode: state.mode,
    duration: minutes,
    taskId: activeTask?.id ?? null,
    projectId: activeTask?.projectId ?? null,
    taskTitle: activeTask?.title ?? null,
    projectName: project?.name ?? null,
  });
  sessions = sessions.slice(-200);
  renderStats();
  renderSessionLog();
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

function handleProjectSubmit(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const name = formData.get("projectName").trim();
  if (!name) return;
  const defaultColor = "#6366f1";
  const color = formData.get("projectColor") || defaultColor;
  projects.push({ id: crypto.randomUUID(), name, color });
  event.currentTarget.reset();
  event.currentTarget.projectColor.value = defaultColor;
  renderProjects();
  renderTasks();
  updateActiveTaskLabel();
  persist();
}

function renderProjects() {
  if (!projectSelect) return;
  const currentValue = projectSelect.value;
  projectSelect.innerHTML = "";
  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "No project";
  projectSelect.appendChild(defaultOption);

  projectList.innerHTML = "";
  if (!projects.length) {
    const empty = document.createElement("li");
    empty.className = "empty-state";
    empty.textContent = "No projects yet";
    projectList.appendChild(empty);
    projectSelect.value = "";
    return;
  }

  projects.forEach((project) => {
    const option = document.createElement("option");
    option.value = project.id;
    option.textContent = project.name;
    projectSelect.appendChild(option);

    const item = document.createElement("li");
    item.className = "project-item";
    item.innerHTML = `
      <div class="project-info">
        <span class="project-swatch" style="--project-color: ${project.color}"></span>
        <span class="project-name">${project.name}</span>
      </div>
      <button class="text-btn delete-project" aria-label="Delete project">
        ✕
      </button>
    `;
    const deleteBtn = $(".delete-project", item);
    deleteBtn.addEventListener("click", () => deleteProject(project.id));
    projectList.appendChild(item);
  });

  if (currentValue && projects.some((project) => project.id === currentValue)) {
    projectSelect.value = currentValue;
  }
}

function deleteProject(id) {
  projects = projects.filter((project) => project.id !== id);
  tasks = tasks.map((task) =>
    task.projectId === id ? { ...task, projectId: null } : task
  );
  updateActiveTaskLabel();
  renderProjects();
  renderTasks();
  persist();
}

function resetProjects() {
  projects = [];
  tasks = tasks.map((task) => ({ ...task, projectId: null }));
  renderProjects();
  renderTasks();
  updateActiveTaskLabel();
  persist();
}

function renderSessionLog() {
  sessionList.innerHTML = "";
  if (!sessions.length) {
    const empty = document.createElement("li");
    empty.className = "empty-state";
    empty.textContent = "No sessions logged yet";
    sessionList.appendChild(empty);
    return;
  }
  sessions
    .slice(-10)
    .reverse()
    .forEach((session) => {
      const li = document.createElement("li");
      li.className = "session-item";
      const project = projects.find((p) => p.id === session.projectId);
      const task = tasks.find((t) => t.id === session.taskId);
      const taskLabel = task?.title ?? session.taskTitle ?? "Unassigned";
      const projectLabel = project
        ? ` · ${project.name}`
        : session.projectName
        ? ` · ${session.projectName}`
        : "";
      li.innerHTML = `
        <div>
          <strong>${session.mode === "focus" ? "Focus" : "Break"}</strong>
          <span>${taskLabel}${projectLabel}</span>
        </div>
        <div class="session-meta">
          <span>${session.duration} min</span>
          <span>${formatSessionTime(session.completedAt)}</span>
        </div>
      `;
      sessionList.appendChild(li);
    });
}

function formatSessionTime(timestamp) {
  const date = new Date(timestamp);
  return `${date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })} · ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function clearSessions() {
  sessions = [];
  renderSessionLog();
  persist();
}
