const STORAGE_KEY = "productivity-os-mvp-v12";
const APP_VERSION = "v12";
const SUPABASE_TABLE = "app_states";
const SUPABASE_CONFIG = window.PRODUCTIVITY_OS_SUPABASE || {};
const isSupabaseConfigured = Boolean(
  window.supabase &&
  SUPABASE_CONFIG.url &&
  SUPABASE_CONFIG.publishableKey &&
  !SUPABASE_CONFIG.url.includes("YOUR_") &&
  !SUPABASE_CONFIG.publishableKey.includes("YOUR_")
);
const supabaseClient = isSupabaseConfigured
  ? window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.publishableKey)
  : null;
let currentUser = null;
let syncTimer = null;
let isLoadingRemote = false;
const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const weekdayOptions = [
  { index: 1, label: "월" },
  { index: 2, label: "화" },
  { index: 3, label: "수" },
  { index: 4, label: "목" },
  { index: 5, label: "금" },
  { index: 6, label: "토" },
  { index: 0, label: "일" },
];
const allWeekdays = weekdayOptions.map(day => day.index);

function normalizeWeekdays(value) {
  const source = Array.isArray(value) ? value : allWeekdays;
  const valid = source.map(Number).filter(day => day >= 0 && day <= 6);
  return [...new Set(valid)];
}

function isHabitScheduledOnDate(habit, dateOrKey) {
  const date = typeof dateOrKey === "string" ? fromDateKey(dateOrKey) : new Date(dateOrKey);
  return normalizeWeekdays(habit.weekdays).includes(date.getDay());
}

function formatHabitWeekdays(habit) {
  const weekdays = normalizeWeekdays(habit.weekdays);
  if (weekdays.length === 7) return "매일";
  if (weekdays.length === 0) return "요일 없음";
  return weekdayOptions.filter(day => weekdays.includes(day.index)).map(day => day.label).join(" · ");
}

function weekdayPickerHtml(name, selected = allWeekdays) {
  const selectedSet = new Set(normalizeWeekdays(selected));
  return weekdayOptions.map(day => `
    <label class="weekday-pill">
      <input type="checkbox" name="${name}" value="${day.index}" ${selectedSet.has(day.index) ? "checked" : ""} />
      <span>${day.label}</span>
    </label>
  `).join("");
}

function readWeekdayInputs(root, name) {
  const values = [...root.querySelectorAll(`input[name="${name}"]:checked`)].map(input => Number(input.value));
  return normalizeWeekdays(values);
}

function makeId(prefix = "id") {
  if (window.crypto?.randomUUID) return crypto.randomUUID();
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const seedData = window.PRODUCTIVITY_OS_SEED || {};
const rosSeed = seedData.ros || {};

const defaultRosSettings = {
  topics: ["General", "Research", "Study", "Admin"],
  types: ["Deep Work", "Research Support", "Execution", "Operations"],
  statuses: ["Todo", "Doing", "Waiting", "Done", "Dropped"],
  tracks: ["Research", "Paper/Writing", "Experiment/Sim", "Admin"],
  nowLater: ["Now", "Later"],
  urgencyLevels: ["높음", "보통", "낮음"],
  sources: ["Meeting", "Email/Chat", "Self", "Advisor"],
  taskAreas: ["Research", "Study", "Productivity", "Admin", "Personal"],
  typeDefinitions: [
    { type: "Deep Work", definition: "핵심 주장/핵심 설계/핵심 결과를 실제로 만들어내는 고집중 생산 작업." },
    { type: "Research Support", definition: "Deep Work가 앞으로 나가도록 근거, 재료, 판단 기준을 마련하는 탐색/준비 작업." },
    { type: "Execution", definition: "정해진 일을 처리해서 진행을 막는 장애물을 제거하는 작업." },
    { type: "Operations", definition: "일이 굴러가게 하는 운영, 조율, 의사결정, 정리 작업." },
  ],
  classificationRule: "새로운 주장/결과가 생기면 Deep Work, 근거/재료/셋업이면 Research Support, 이미 결정된 일 처리면 Execution, 시스템 운영이면 Operations.",
};

const defaultRosFlow = {
  goal: "Protect Deep Work, control external inputs, and close exploration branches with Now/Later separation.",
  process: ["Intake Log", "Queue Tasks", "Daily Execution", "Weekly Review", "Questions", "Settings"],
};

const pages = [
  { id: "dashboard", title: "Dashboard", icon: "dashboard" },
  { id: "brain", title: "Brain Dump", icon: "cloud" },
  { id: "tasks", title: "Task Matrix", icon: "matrix" },  
  { id: "ros", title: "Research OS", icon: "terminal" },
  { id: "study", title: "Study Plan", icon: "cap" },
  { id: "dayStarter", title: "Day Starter", icon: "bolt" },
  { id: "habits", title: "Habit Tracker", icon: "habit" },
  { id: "review", title: "Weekly Review", icon: "review" },
];

const rosTabs = [
  { id: "overview", title: "Overview" },
  { id: "intake", title: "Intake Log" },
  { id: "meetings", title: "Meeting Notes" },
  { id: "queue", title: "Queue Tasks" },
  { id: "daily", title: "Daily Execution" },
  { id: "weekly", title: "Weekly Review" },
  { id: "questions", title: "Questions" },
  { id: "settings", title: "Settings" },
];

const closedStatuses = ["done", "resolved", "archived", "dropped", "complete", "completed", "처리 완료", "완료"];
const habitModes = ["month", "week", "day"];
const rosSettingLists = [
  { key: "topics", title: "Topics", hint: "프로젝트/논문/블록 단위" },
  { key: "types", title: "Work Types", hint: "Deep Work / Support / Execution 등" },
  { key: "statuses", title: "Statuses", hint: "Queue와 Daily의 상태 옵션" },
  { key: "tracks", title: "Tracks", hint: "Research / Paper / Admin 등" },
  { key: "nowLater", title: "Now/Later", hint: "Questions의 수렴/나중 분리" },
  { key: "urgencyLevels", title: "긴급도", hint: "Queue 긴급도(첫 항목만 Task Matrix '긴급' 축)" },
  { key: "sources", title: "Sources", hint: "입력 출처" },
  { key: "taskAreas", title: "Task Areas", hint: "Task Matrix의 area 옵션" },
];

function sidebarIconSvg() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" class="sidebar-svg">
    <rect x="4" y="5" width="16" height="14" rx="3"></rect>
    <path d="M10 5v14"></path>
    <path d="M7 9h.01M7 12h.01M7 15h.01"></path>
  </svg>`;
}

function navIconHtml(icon) {
  if (icon === "dashboard") {
    return `<svg viewBox="0 0 24 24" aria-hidden="true" class="nav-svg">
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.6"></rect>
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6"></rect>
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6"></rect>
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6"></rect>
    </svg>`;
  }
  if (icon === "cloud") {
    return `<svg viewBox="0 0 24 24" aria-hidden="true" class="nav-svg">
      <path d="M7.6 18.2h8.5c2.4 0 4.3-1.8 4.3-4.1 0-2.1-1.6-3.8-3.7-4.1-.8-2.4-2.9-4-5.4-4-3 0-5.4 2.2-5.8 5.1-1.7.6-2.9 1.9-2.9 3.6 0 2 1.7 3.5 5 3.5Z"></path>
    </svg>`;
  }
  if (icon === "terminal") {
    return `<svg viewBox="0 0 24 24" aria-hidden="true" class="nav-svg terminal-svg">
      <rect x="3.8" y="5.3" width="16.4" height="13.4" rx="3"></rect>
      <path d="M7.4 10.1 10 12l-2.6 1.9"></path>
      <path d="M12.1 14h4.2"></path>
    </svg>`;
  }
  if (icon === "matrix") {
    return `<svg viewBox="0 0 24 24" aria-hidden="true" class="nav-svg">
      <rect x="4" y="5" width="16" height="14" rx="2"></rect>
      <path d="M4 9.7h16M4 14.3h16"></path>
      <path d="M9.35 5v14M14.65 5v14"></path>
    </svg>`;
  }
  if (icon === "cap") {
    return `<svg viewBox="0 0 24 24" aria-hidden="true" class="nav-svg">
      <path d="M3.5 9.2 12 5l8.5 4.2-8.5 4.2-8.5-4.2Z"></path>
      <path d="M7.2 11.2v4.1c1.4 1.3 3 1.9 4.8 1.9s3.4-.6 4.8-1.9v-4.1"></path>
      <path d="M20.5 9.2v5.4"></path>
    </svg>`;
  }
  if (icon === "habit") {
    return `<svg viewBox="0 0 24 24" aria-hidden="true" class="nav-svg">
      <path d="M20 11.2v.8a8 8 0 1 1-4.8-7.3"></path>
      <path d="M8.7 11.8 11.2 14.3 20.2 5.3"></path>
    </svg>`;
  }
  if (icon === "bolt") {
    return `<svg viewBox="0 0 24 24" aria-hidden="true" class="nav-svg">
      <path d="M13.5 3.8 5.8 13h5.6l-1 7.2 7.8-9.8h-5.5l.8-6.6Z"></path>
    </svg>`;
  }
  if (icon === "review") {
    return `<svg viewBox="0 0 24 24" aria-hidden="true" class="nav-svg">
      <path d="M6.2 7.9A7.3 7.3 0 0 1 18.7 9"></path>
      <path d="M18.7 5.4V9h-3.6"></path>
      <path d="M17.8 16.1A7.3 7.3 0 0 1 5.3 15"></path>
      <path d="M5.3 18.6V15h3.6"></path>
    </svg>`;
  }
  return `<span class="nav-symbol">${escapeHtml(icon)}</span>`;
}

function todayKey() {
  return toDateKey(new Date());
}

function toDateKey(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function fromDateKey(key) {
  return new Date(`${key}T00:00:00`);
}

function addDays(date, amount) {
  const d = new Date(date);
  d.setDate(d.getDate() + amount);
  return d;
}

function addMonths(date, amount) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + amount);
  return d;
}

function startOfWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function formatKoDate(dateOrKey, options = {}) {
  const date = typeof dateOrKey === "string" ? fromDateKey(dateOrKey) : new Date(dateOrKey);
  return date.toLocaleDateString("ko-KR", options);
}

function buildDefaultIntake() {
  const capture = (rosSeed.captureInbox || []).map(item => ({
    id: makeId("intake"),
    kind: "Inbox",
    date: item.capturedAt || "",
    title: item.item || "Untitled",
    source: item.source || "Self",
    topic: item.topic || "Admin",
    type: item.type || "Execution",
    status: item.status || "Logged",
    due: item.due || "",
    details: item.notes || "",
    decisions: "",
    actions: item.convertTo ? `Convert to ${item.convertTo}` : "",
    openQuestions: "",
    risks: "",
    queued: false,
  }));
  const meetings = (rosSeed.meetings || []).map(item => ({
    id: makeId("intake"),
    kind: "Meeting",
    date: item.date || "",
    title: item.topic || "Meeting",
    source: "Meeting",
    topic: item.topic || "Admin",
    type: "Operations",
    status: item.status || "Logged",
    due: item.due || "",
    details: "",
    decisions: item.decisions || "",
    actions: item.actions || "",
    openQuestions: item.openQuestions || "",
    risks: item.risks || "",
    queued: false,
  }));
  return [...meetings, ...capture];
}

function dailyBucketShape(bucket) {
  const b = bucket && typeof bucket === "object" ? bucket : {};
  return {
    deepWork: Array.isArray(b.deepWork) ? b.deepWork : [],
    processing: Array.isArray(b.processing) ? b.processing : [],
    anchors: Array.isArray(b.anchors) ? b.anchors : [],
  };
}

// ROS daily를 날짜별 버킷 형태 { [dateKey]: {deepWork,processing,anchors} }로 정규화.
// 레거시(top-level deepWork/processing 배열)는 오늘 날짜 버킷으로 래핑.
function normalizeRosDaily(input) {
  const daily = input && typeof input === "object" ? input : {};
  if (Array.isArray(daily.deepWork) || Array.isArray(daily.processing) || Array.isArray(daily.anchors)) {
    return { [todayKey()]: dailyBucketShape(daily) };
  }
  const output = {};
  Object.entries(daily).forEach(([date, bucket]) => { output[date] = dailyBucketShape(bucket); });
  return output;
}

function buildDefaultHabitLogs(habits) {
  const logs = {};
  const monday = startOfWeek(new Date());
  habits.forEach(habit => {
    (habit.days || []).forEach((checked, index) => {
      if (!checked) return;
      const key = toDateKey(addDays(monday, index));
      if (!logs[key]) logs[key] = {};
      logs[key][habit.id] = true;
    });
  });
  return logs;
}

const defaultHabits = (seedData.habits || []).map(habit => ({
  ...habit,
  weekdays: normalizeWeekdays(Array.isArray(habit.weekdays) ? habit.weekdays : allWeekdays),
}));

const defaultHabitLogs = clone(seedData.habitLogs || buildDefaultHabitLogs(defaultHabits));

const defaultExecutionMap = clone(seedData.executionMap || {
  id: "alg-root",
  label: "실행 알고리즘",
  color: "neutral",
  children: [],
});

const defaultState = {
  brain: (seedData.brain || []).map(item => ({
    id: item.id || makeId("brain"),
    text: item.text || "",
    type: item.type || "note",
    tag: item.tag || "",
    processed: Boolean(item.processed),
    createdAt: item.createdAt || new Date().toISOString(),
  })),
  studies: (seedData.studies || []).map(item => ({
    id: item.id || makeId("study"),
    topic: item.topic || "Untitled",
    bucket: item.bucket || "Exploration",
    track: item.track || "Personal",
    target: Number(item.target || 0),
    logged: Number(item.logged || 0),
  })),
  tasks: (seedData.tasks || []).map(item => ({
    id: item.id || makeId("task"),
    title: item.title || "Untitled",
    area: item.area || "Productivity",
    priority: item.priority || "Medium",
    source: item.source || "",
    followUp: Boolean(item.followUp),
    notes: item.notes || "",
    due: item.due || "",
    quadrant: item.quadrant || "schedule",
    done: Boolean(item.done),
  })),
  habits: defaultHabits,
  habitLogs: clone(defaultHabitLogs),
  executionMap: clone(defaultExecutionMap),
  dailyKickoff: {},
  ros: {
    captureInbox: rosSeed.captureInbox || [],
    meetings: rosSeed.meetings || [],
    intake: Array.isArray(rosSeed.intake) ? rosSeed.intake : buildDefaultIntake(),
    queueTasks: rosSeed.queueTasks || [],
    daily: normalizeRosDaily(rosSeed.daily),
    weeklyReviews: rosSeed.weeklyReviews || [],
    questions: rosSeed.questions || [],
    meetingNotes: rosSeed.meetingNotes || [],
    flow: {
      ...defaultRosFlow,
      ...(rosSeed.flow || {}),
    },
    settings: {
      ...defaultRosSettings,
      ...(rosSeed.settings || {}),
      taskAreas: (rosSeed.settings || {}).taskAreas || defaultRosSettings.taskAreas,
    },
  },
  reviews: [],
};

let state = loadState();
let currentPage = localStorage.getItem("productivity-os-page") || "dashboard";
let currentRosTab = localStorage.getItem("productivity-os-ros-tab") || "overview";
let currentHabitMode = localStorage.getItem("productivity-os-habit-mode") || "month";
let currentHabitDate = localStorage.getItem("productivity-os-habit-date") || todayKey();
let currentDayStarterDate = localStorage.getItem("productivity-os-daystarter-date") || todayKey();
let currentRosDailyDate = localStorage.getItem("productivity-os-rosdaily-date") || todayKey();
let currentWeeklyWeekStart = toDateKey(startOfWeek(new Date()));
let currentReviewWeekStart = toDateKey(startOfWeek(new Date()));
let currentTheme = localStorage.getItem("productivity-os-theme") || "light";
const savedSidebarCollapsed = localStorage.getItem("productivity-os-sidebar-collapsed");
let sidebarCollapsed = savedSidebarCollapsed !== null
  ? savedSidebarCollapsed === "true"
  : window.matchMedia("(max-width: 640px)").matches;
let rosDisplayPrefs = loadRosDisplayPrefs();

function loadRosDisplayPrefs() {
  try {
    return {
      intakeView: "list",
      queueView: "list",
      hideQueuedIntake: true,
      hideDoneQueue: true,
      hideDoneTasks: true,
      ...JSON.parse(localStorage.getItem("productivity-os-ros-display") || "{}"),
    };
  } catch {
    return { intakeView: "list", queueView: "list", hideQueuedIntake: true, hideDoneQueue: true, hideDoneTasks: true };
  }
}

function saveRosDisplayPrefs() {
  localStorage.setItem("productivity-os-ros-display", JSON.stringify(rosDisplayPrefs));
}

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return clone(defaultState);
    return normalizeState(JSON.parse(saved));
  } catch (error) {
    console.error(error);
    return clone(defaultState);
  }
}

function normalizeState(input = {}) {
  const base = clone(defaultState);
  const output = { ...base, ...input };
  output.brain = Array.isArray(input.brain) ? input.brain : base.brain;
  output.studies = Array.isArray(input.studies) ? input.studies : base.studies;
  output.tasks = Array.isArray(input.tasks) ? input.tasks : base.tasks;
  output.reviews = Array.isArray(input.reviews) ? input.reviews : base.reviews;

  const incomingHabits = Array.isArray(input.habits) ? input.habits : base.habits;
  output.habits = incomingHabits.map(habit => ({
    id: habit.id || makeId("habit"),
    name: habit.name || "Untitled habit",
    target: Number(habit.target || 1),
    active: habit.active !== false,
    weekdays: normalizeWeekdays(habit.weekdays),
  }));
  output.habitLogs = input.habitLogs && typeof input.habitLogs === "object" ? input.habitLogs : clone(base.habitLogs);

  output.executionMap = input.executionMap && typeof input.executionMap === "object" ? input.executionMap : clone(base.executionMap);
  output.dailyKickoff = input.dailyKickoff && typeof input.dailyKickoff === "object" ? input.dailyKickoff : clone(base.dailyKickoff);

  const inputRos = input.ros || {};
  output.ros = {
    ...base.ros,
    ...inputRos,
    settings: {
      ...base.ros.settings,
      ...(inputRos.settings || {}),
      taskAreas: (inputRos.settings || {}).taskAreas || base.ros.settings.taskAreas,
    },
    intake: Array.isArray(inputRos.intake) ? inputRos.intake : mergeLegacyIntake(inputRos),
    queueTasks: Array.isArray(inputRos.queueTasks) ? inputRos.queueTasks : base.ros.queueTasks,
    daily: inputRos.daily !== undefined ? normalizeRosDaily(inputRos.daily) : clone(base.ros.daily),
    weeklyReviews: Array.isArray(inputRos.weeklyReviews) ? inputRos.weeklyReviews : base.ros.weeklyReviews,
    questions: Array.isArray(inputRos.questions) ? inputRos.questions : base.ros.questions,
    meetingNotes: Array.isArray(inputRos.meetingNotes) ? inputRos.meetingNotes : base.ros.meetingNotes,
  };
  ensureItemIds(output.ros.questions, "question");
  ensureItemIds(output.ros.weeklyReviews, "weekly");
  Object.values(output.ros.daily).forEach(bucket => {
    ensureItemIds(bucket.deepWork, "daily");
    ensureItemIds(bucket.processing, "daily");
  });
  // Now/Later → urgency(3단계) 마이그레이션: 기존 Now=높음, 그 외=낮음(현재 배치 보존).
  (output.ros.queueTasks || []).forEach(task => {
    if (task && !task.urgency) task.urgency = task.nowLater === "Now" ? "높음" : "낮음";
  });
  ensureRosSettings(output.ros.settings);
  return output;
}

// id가 없는 기존 항목에 안정적인 id를 한 번 백필. index 참조 시절 데이터와 호환.
function ensureItemIds(list, prefix) {
  if (!Array.isArray(list)) return;
  list.forEach(item => {
    if (item && !item.id) item.id = makeId(prefix);
  });
}

function mergeLegacyIntake(inputRos) {
  if (!inputRos.captureInbox && !inputRos.meetings) return clone(defaultState.ros.intake);
  const capture = (inputRos.captureInbox || []).map(item => ({
    id: item.id || makeId("intake"),
    kind: "Inbox",
    date: item.capturedAt || item.date || "",
    title: item.item || item.title || "Untitled",
    source: item.source || "Self",
    topic: item.topic || "Admin",
    type: item.type || "Execution",
    status: item.status || "Logged",
    due: item.due || "",
    details: item.notes || item.details || "",
    decisions: "",
    actions: item.convertTo ? `Convert to ${item.convertTo}` : "",
    openQuestions: "",
    risks: "",
    queued: false,
  }));
  const meetings = (inputRos.meetings || []).map(item => ({
    id: item.id || makeId("intake"),
    kind: "Meeting",
    date: item.date || "",
    title: item.topic || item.title || "Meeting",
    source: "Meeting",
    topic: item.topic || "Admin",
    type: "Operations",
    status: item.status || "Logged",
    due: item.due || "",
    details: "",
    decisions: item.decisions || "",
    actions: item.actions || "",
    openQuestions: item.openQuestions || "",
    risks: item.risks || "",
    queued: false,
  }));
  return [...meetings, ...capture];
}

function ensureRosSettings(settings) {
  const fallback = defaultRosSettings;
  ["topics", "types", "statuses", "tracks", "nowLater", "urgencyLevels", "sources", "taskAreas"].forEach(key => {
    if (!Array.isArray(settings[key]) || !settings[key].length) settings[key] = clone(fallback[key] || []);
  });
  if (!Array.isArray(settings.typeDefinitions)) settings.typeDefinitions = clone(fallback.typeDefinitions || []);
  if (!settings.classificationRule) settings.classificationRule = fallback.classificationRule || "";
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  scheduleRemoteSave();
}

function setSyncStatus(text, tone = "neutral") {
  const el = document.querySelector("#syncStatus");
  if (!el) return;
  el.textContent = text;
  el.dataset.tone = tone;
}

function updateAuthUI() {
  const authOpenBtn = document.querySelector("#authOpenBtn");
  const signOutBtn = document.querySelector("#signOutBtn");
  const syncNowBtn = document.querySelector("#syncNowBtn");
  const userLabel = document.querySelector("#userLabel");

  if (!isSupabaseConfigured) {
    setSyncStatus("DB config 필요", "warning");
    if (authOpenBtn) authOpenBtn.hidden = true;
    if (signOutBtn) signOutBtn.hidden = true;
    if (syncNowBtn) syncNowBtn.hidden = true;
    if (userLabel) userLabel.textContent = "Local only";
    return;
  }

  if (currentUser) {
    setSyncStatus("DB 연결됨", "ok");
    if (authOpenBtn) authOpenBtn.hidden = true;
    if (signOutBtn) signOutBtn.hidden = false;
    if (syncNowBtn) syncNowBtn.hidden = false;
    if (userLabel) userLabel.textContent = currentUser.email || "Signed in";
  } else {
    setSyncStatus("로그인 필요", "warning");
    if (authOpenBtn) authOpenBtn.hidden = false;
    if (signOutBtn) signOutBtn.hidden = true;
    if (syncNowBtn) syncNowBtn.hidden = true;
    if (userLabel) userLabel.textContent = "Not signed in";
  }
}

function scheduleRemoteSave() {
  if (!supabaseClient || !currentUser || isLoadingRemote) return;
  setSyncStatus("저장 대기", "saving");
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => pushStateToRemote(), 700);
}

async function pushStateToRemote() {
  if (!supabaseClient || !currentUser) return;
  try {
    setSyncStatus("DB 저장 중", "saving");
    const { error } = await supabaseClient
      .from(SUPABASE_TABLE)
      .upsert({
        user_id: currentUser.id,
        data: state,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
    if (error) throw error;
    setSyncStatus("동기화 완료", "ok");
  } catch (error) {
    console.error(error);
    setSyncStatus("DB 저장 실패", "error");
  }
}

async function loadStateFromRemote() {
  if (!supabaseClient || !currentUser) return;
  isLoadingRemote = true;
  try {
    setSyncStatus("DB 불러오는 중", "saving");
    const { data, error } = await supabaseClient
      .from(SUPABASE_TABLE)
      .select("data, updated_at")
      .eq("user_id", currentUser.id)
      .maybeSingle();
    if (error) throw error;

    if (data?.data) {
      state = normalizeState(data.data);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      setSyncStatus("동기화 완료", "ok");
      render();
    } else {
      await pushStateToRemote();
    }
  } catch (error) {
    console.error(error);
    setSyncStatus("DB 불러오기 실패", "error");
  } finally {
    isLoadingRemote = false;
  }
}

async function initSupabaseAuth() {
  if (!supabaseClient) {
    updateAuthUI();
    return;
  }
  const { data } = await supabaseClient.auth.getSession();
  currentUser = data.session?.user || null;
  updateAuthUI();
  if (currentUser) await loadStateFromRemote();

  supabaseClient.auth.onAuthStateChange(async (_event, session) => {
    currentUser = session?.user || null;
    updateAuthUI();
    if (currentUser) await loadStateFromRemote();
  });
}

function openAuthModal() {
  if (!supabaseClient) {
    alert("supabase-config.js에 Supabase URL과 publishable key를 먼저 입력해야 합니다.");
    return;
  }
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `<div class="modal-card auth-modal" role="dialog" aria-modal="true" aria-label="Supabase 로그인">
    <div class="modal-header">
      <h3>Supabase 로그인</h3>
      <button type="button" class="icon-btn modal-close" aria-label="닫기">×</button>
    </div>
    <form class="modal-form" id="authForm">
      <div class="modal-grid">
        <label class="modal-field full"><span>Email</span><input id="authEmail" type="email" autocomplete="email" required /></label>
        <label class="modal-field full"><span>Password</span><input id="authPassword" type="password" autocomplete="current-password" minlength="6" required /></label>
      </div>
      <p class="auth-help">개인용 계정으로 로그인하면 이 브라우저의 상태가 Supabase app_states 테이블에 동기화됩니다.</p>
      <div class="modal-footer auth-footer">
        <button type="button" class="secondary ghost-top modal-cancel">취소</button>
        <button type="button" class="secondary" id="authSignUpBtn">회원가입</button>
        <button type="submit">로그인</button>
      </div>
    </form>
  </div>`;
  document.body.append(backdrop);
  const close = () => backdrop.remove();
  backdrop.querySelector(".modal-close").addEventListener("click", close);
  backdrop.querySelector(".modal-cancel").addEventListener("click", close);
  backdrop.addEventListener("click", event => { if (event.target === backdrop) close(); });

  async function submitAuth(mode) {
    const email = backdrop.querySelector("#authEmail").value.trim();
    const password = backdrop.querySelector("#authPassword").value;
    if (!email || !password) return;
    try {
      setSyncStatus(mode === "signup" ? "가입 처리 중" : "로그인 중", "saving");
      const result = mode === "signup"
        ? await supabaseClient.auth.signUp({ email, password })
        : await supabaseClient.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      if (!result.data.session && mode === "signup") {
        alert("가입 확인 메일이 발송되었을 수 있습니다. 메일 확인 후 로그인하세요.");
      }
      close();
      updateAuthUI();
    } catch (error) {
      console.error(error);
      alert(error.message || "인증에 실패했습니다.");
      updateAuthUI();
    }
  }

  backdrop.querySelector("#authForm").addEventListener("submit", event => {
    event.preventDefault();
    submitAuth("signin");
  });
  backdrop.querySelector("#authSignUpBtn").addEventListener("click", () => submitAuth("signup"));
  backdrop.querySelector("#authEmail").focus();
}

function setPage(pageId) {
  currentPage = pageId;
  localStorage.setItem("productivity-os-page", pageId);
  render();
}

// URL로 페이지 딥링크: ?page=dayStarter 또는 #dayStarter (위젯/단축어에서 사용).
function pageFromUrl() {
  const fromQuery = new URLSearchParams(location.search).get("page");
  const fromHash = (location.hash || "").replace(/^#\/?/, "").trim();
  const candidate = (fromQuery || fromHash || "").trim();
  return pages.some(p => p.id === candidate) ? candidate : null;
}

function applyUrlRoute() {
  const id = pageFromUrl();
  if (id) {
    currentPage = id;
    localStorage.setItem("productivity-os-page", id);
  }
}

function setRosTab(tabId) {
  currentRosTab = tabId;
  localStorage.setItem("productivity-os-ros-tab", tabId);
  renderResearch();
}

function setHabitMode(mode) {
  currentHabitMode = mode;
  localStorage.setItem("productivity-os-habit-mode", mode);
  render();
}

function setHabitDate(key) {
  currentHabitDate = key;
  localStorage.setItem("productivity-os-habit-date", key);
}

function themeIconSvg(symbol) {
  if (symbol === "sun") {
    return `<svg viewBox="0 0 24 24" aria-hidden="true" class="nav-svg">
      <circle cx="12" cy="12" r="4"></circle>
      <path d="M12 2.5v2.3M12 19.2v2.3M2.5 12h2.3M19.2 12h2.3M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6M6.8 17.2l-1.6 1.6"></path>
    </svg>`;
  }
  return `<svg viewBox="0 0 24 24" aria-hidden="true" class="nav-svg">
    <path d="M20 14.7A8.2 8.2 0 1 1 9.3 4 6.6 6.6 0 0 0 20 14.7Z"></path>
  </svg>`;
}

function applyTheme() {
  document.body.dataset.theme = currentTheme;
  const themeToggle = document.querySelector("#themeToggle");
  if (themeToggle) {
    const switchToLight = currentTheme === "dark";
    themeToggle.innerHTML = themeIconSvg(switchToLight ? "sun" : "moon");
    const label = switchToLight ? "라이트 모드로 전환" : "다크 모드로 전환";
    themeToggle.setAttribute("aria-label", label);
    themeToggle.title = label;
  }
}

function toggleTheme() {
  currentTheme = currentTheme === "dark" ? "light" : "dark";
  localStorage.setItem("productivity-os-theme", currentTheme);
  applyTheme();
}

function applySidebarState() {
  const app = document.querySelector("#app");
  if (!app) return;
  app.classList.toggle("sidebar-collapsed", sidebarCollapsed);
  const toggle = document.querySelector("#sidebarToggle");
  if (toggle) {
    toggle.innerHTML = sidebarIconSvg();
    toggle.classList.toggle("is-collapsed", sidebarCollapsed);
    toggle.setAttribute("aria-label", sidebarCollapsed ? "사이드바 펼치기" : "사이드바 접기");
    toggle.title = sidebarCollapsed ? "사이드바 펼치기" : "사이드바 접기";
  }
}

function toggleSidebar() {
  sidebarCollapsed = !sidebarCollapsed;
  localStorage.setItem("productivity-os-sidebar-collapsed", String(sidebarCollapsed));
  applySidebarState();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatMultiline(value) {
  return escapeHtml(value || "-").replaceAll("\n", "<br>");
}

// 메모 텍스트를 HTML로 변환: 이스케이프 후 URL을 클릭 가능한 링크로, 줄바꿈은 <br>.
function linkifyNotes(value) {
  return escapeHtml(value || "")
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>')
    .replaceAll("\n", "<br>");
}

function formatDate(value) {
  if (!value) return "No due date";
  const date = new Date(value + "T00:00:00");
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("ko-KR", { month: "short", day: "numeric", weekday: "short" });
}

function isClosedStatus(status) {
  const raw = String(status || "").trim();
  const normalized = raw.toLowerCase();
  return closedStatuses.some(keyword => normalized === keyword || normalized.includes(keyword) || raw.includes(keyword));
}

function countBy(rows, key) {
  return rows.reduce((acc, row) => {
    const value = row[key] || "Blank";
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function getOpenQueueTasks() {
  return (state.ros?.queueTasks || []).filter(task => !isClosedStatus(task.status));
}

// 특정 날짜의 daily 버킷을 읽기 전용으로 반환(없으면 임시 빈 버킷, state 미변경).
function readRosDailyBucket(date = currentRosDailyDate) {
  return state.ros?.daily?.[date] || { deepWork: [], processing: [], anchors: [] };
}

// 특정 날짜의 daily 버킷을 반환(없으면 생성 후 영속). 쓰기용.
function ensureRosDailyBucket(date = currentRosDailyDate) {
  if (!state.ros.daily || typeof state.ros.daily !== "object") state.ros.daily = {};
  if (!state.ros.daily[date]) state.ros.daily[date] = { deepWork: [], processing: [], anchors: [] };
  return state.ros.daily[date];
}

// 모든 날짜 버킷의 daily 항목을 순회 (done 전파용).
function forEachDailyItem(fn) {
  Object.values(state.ros.daily || {}).forEach(bucket =>
    ["deepWork", "processing"].forEach(sec => (bucket?.[sec] || []).forEach(fn)));
}

function getDailyWorkItems(date = todayKey()) {
  const daily = readRosDailyBucket(date);
  const deep = (daily.deepWork || [])
    .filter(item => item.title || item.taskId)
    .map(item => ({ ...item, label: item.title, section: "Deep Work" }));
  const processing = (daily.processing || [])
    .filter(item => item.item || item.title || item.action)
    .map(item => ({ ...item, label: item.item || item.title || item.action, section: "Processing" }));
  return [...deep, ...processing];
}

function getRosDailyIncompleteCount() {
  return getDailyWorkItems().filter(item => !isClosedStatus(item.status)).length;
}

// daily 항목을 id로 찾아 그 항목과 소속 섹션(deepWork/processing)을 반환. 현재 네비 날짜 버킷 기준.
function findDailyEntry(id) {
  const bucket = readRosDailyBucket();
  for (const section of ["deepWork", "processing"]) {
    const item = (bucket[section] || []).find(entry => entry.id === id);
    if (item) return { section, item };
  }
  return { section: null, item: null };
}

// queueId를 공유 키로 연결된 레코드(ROS Queue / Task Matrix / 모든 날짜의 ROS Daily)의
// done 상태를 맞춤. 이미 닫힌(Dropped 등) 상태는 보존: done이면 닫혀있을 때 그대로 둠.
function applyLinkedDone(queueId, done) {
  const openStatus = state.ros.settings?.statuses?.[0] || "Todo";
  const syncStatus = (cur, set) => {
    if (done && !isClosedStatus(cur)) set("Done");
    else if (!done && isClosedStatus(cur)) set(openStatus);
  };
  const q = (state.ros.queueTasks || []).find(t => t.id === queueId);
  if (q) syncStatus(q.status, s => { q.status = s; });
  const task = state.tasks.find(t => t.sourceRosId === queueId);
  if (task) task.done = done;
  forEachDailyItem(item => {
    if (item.taskId === queueId) syncStatus(item.status, s => { item.status = s; });
  });
}

function getQueueOpenCount() {
  return getOpenQueueTasks().length;
}

function getIntakeOpenCount() {
  return (state.ros?.intake || []).filter(item => !isClosedStatus(item.status) && !item.queued).length;
}

function getNowQuestionCount() {
  return (state.ros?.questions || []).filter(q => String(q.nowLater || "").toLowerCase() === "now" && !isClosedStatus(q.status)).length;
}

function renderNav() {
  const nav = document.querySelector("#nav");
  nav.innerHTML = pages.map(page => `
    <button class="nav-btn ${page.id === currentPage ? "active" : ""}" data-page="${page.id}" title="${escapeHtml(page.title)}">
      <span class="nav-label">${page.title}</span><span class="nav-icon">${navIconHtml(page.icon)}</span>
    </button>
  `).join("");
  nav.querySelectorAll("button").forEach(btn => btn.addEventListener("click", () => setPage(btn.dataset.page)));
}

const bottomNavItems = ["dashboard", "brain", "dayStarter", "habits"];

function triggerHaptic() {
  if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(12);
}

function renderBottomNav() {
  const bottomNav = document.querySelector("#bottomNav");
  if (!bottomNav) return;
  bottomNav.innerHTML = bottomNavItems.map(id => {
    const page = pages.find(p => p.id === id);
    if (!page) return "";
    return `
    <button class="bottom-nav-btn ${page.id === currentPage ? "active" : ""}" data-page="${page.id}" title="${escapeHtml(page.title)}" aria-label="${escapeHtml(page.title)}">
      <span class="nav-icon">${navIconHtml(page.icon)}</span><span class="bottom-nav-label">${escapeHtml(page.title)}</span>
    </button>`;
  }).join("");
  bottomNav.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("pointerdown", () => btn.classList.add("pressed"));
    ["pointerup", "pointerleave", "pointercancel"].forEach(evt =>
      btn.addEventListener(evt, () => btn.classList.remove("pressed")));
    btn.addEventListener("click", () => {
      triggerHaptic();
      setPage(btn.dataset.page);
    });
  });
}

function render() {
  if (syncRosQueueToTaskMatrix()) saveState();
  const versionEl = document.querySelector("#appVersion");
  if (versionEl) versionEl.textContent = APP_VERSION;
  applyTheme();
  applySidebarState();
  renderNav();
  renderBottomNav();
  const page = pages.find(p => p.id === currentPage) || pages[0];
  document.querySelector("#pageTitle").textContent = page.title;
  const content = document.querySelector("#content");
  content.innerHTML = "";
  const template = document.querySelector(`#${page.id}Template`);
  content.append(template.content.cloneNode(true));

  const renderers = {
    dashboard: renderDashboard,
    brain: renderBrain,
    study: renderStudy,
    tasks: renderTasks,
    habits: renderHabits,
    dayStarter: renderDayStarter,
    ros: renderResearch,
    review: renderReview,
  };
  renderers[page.id]?.();
}

function bindKeyboardClick(element, callback) {
  element.addEventListener("click", callback);
  element.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      callback();
    }
  });
}

function renderDashboard() {
  const openTasks = state.tasks.filter(t => !t.done).length;
  const brainOpen = state.brain.filter(b => !b.processed).length;
  const rosDailyOpen = getRosDailyIncompleteCount();
  const todayHabitStats = getHabitDayStats(todayKey());

  const stats = [
    { label: "Open tasks", value: openTasks, page: "tasks", hint: "Task Matrix" },
    { label: "Brain dump 미분류", value: brainOpen, page: "brain", hint: "Brain Dump" },
    { label: "ROS daily 미완료", value: rosDailyOpen, page: "ros", hint: "Research OS" },
    { label: "Habit checks", value: `${todayHabitStats.checked}/${todayHabitStats.total}`, page: "habits", hint: "오늘 설정된 습관" },
  ];

  const statsGrid = document.querySelector("#statsGrid");
  statsGrid.innerHTML = stats.map(stat => `
    <div class="stat clickable" data-dashboard-link="${stat.page}" role="button" tabindex="0">
      <div class="label">${stat.label}</div>
      <div class="value">${stat.value}</div>
      <div class="stat-hint">${stat.hint}로 이동</div>
    </div>
  `).join("");

  statsGrid.querySelectorAll("[data-dashboard-link]").forEach(card => {
    bindKeyboardClick(card, () => setPage(card.dataset.dashboardLink));
  });

  const studyPanel = document.querySelector("#researchStudyPanel");
  bindKeyboardClick(studyPanel, () => setPage("study"));
  const todayActionsPanel = document.querySelector("#todayActionsPanel");
  if (todayActionsPanel) bindKeyboardClick(todayActionsPanel, () => setPage("dayStarter"));

  const researchStudies = state.studies.filter(s => s.bucket !== "Exploration");
  document.querySelector("#researchStudySummary").innerHTML = researchStudies.length ? researchStudies.slice(0, 4).map(item => {
    const percent = item.target > 0 ? Math.min(100, Math.round((item.logged || 0) / item.target * 100)) : 0;
    return `<div class="mini-card">
      <div class="mini-card-title">
        <strong>${escapeHtml(item.topic)}</strong>
        <span class="chip strong">${percent}%</span>
      </div>
      <div class="progress"><span style="width:${percent}%"></span></div>
      <div class="meta"><span class="chip">${escapeHtml(item.bucket)}</span><span class="chip">${escapeHtml(item.track)}</span><span class="chip">${item.logged}/${item.target}h</span></div>
    </div>`;
  }).join("") : `<div class="empty">연구 공부 항목이 없습니다.</div>`;

  const dayStarterRows = (state.dailyKickoff[todayKey()] || []).filter(row => row.label && row.label.trim());
  document.querySelector("#todayActions").innerHTML = dayStarterRows.length ? dayStarterRows.map(row => {
    const skim = row.skimStart || row.skimEnd ? `${row.skimStart || "--:--"} – ${row.skimEnd || "--:--"}` : "";
    const plan = row.planStart || row.planEnd ? `${row.planStart || "--:--"} – ${row.planEnd || "--:--"}` : "";
    return `
    <div class="card">
      <div class="card-title"><h4>${escapeHtml(row.label)}</h4>${plan ? `<span class="chip">${escapeHtml(plan)}</span>` : ""}</div>
      ${skim ? `<div class="meta"><span class="chip">Skim ${escapeHtml(skim)}</span></div>` : ""}
    </div>`;
  }).join("") : `<div class="empty">Day Starter에 입력된 오늘 항목이 없습니다.</div>`;
}

function renderBrain() {
  const form = document.querySelector("#brainForm");
  form.addEventListener("submit", event => {
    event.preventDefault();
    state.brain.unshift({
      id: makeId("brain"),
      title: document.querySelector("#brainTitle").value.trim(),
      text: document.querySelector("#brainText").value.trim(),
      type: document.querySelector("#brainType").value,
      tag: document.querySelector("#brainTag").value.trim(),
      processed: false,
      createdAt: new Date().toISOString(),
    });
    saveState();
    render();
  });
  const list = document.querySelector("#brainList");
  list.innerHTML = state.brain.length ? state.brain.map(item => `
    <article class="card ${item.processed ? "done" : ""}">
      <div class="card-title">
        ${item.title ? `<h4>${escapeHtml(item.title)}</h4>` : `<span></span>`}
        <span class="chip ${item.processed ? "" : "strong"}">${item.processed ? "processed" : "inbox"}</span>
      </div>
      ${item.text ? `<p class="brain-text">${formatMultiline(item.text)}</p>` : ""}
      <div class="meta">
        <span class="chip">${escapeHtml(item.type)}</span>
        <span class="chip">${escapeHtml(item.tag || "no tag")}</span>
        <span class="chip">${new Date(item.createdAt).toLocaleDateString("ko-KR")}</span>
      </div>
      <div class="actions">
        <button class="small ghost" data-brain-toggle="${item.id}">${item.processed ? "미분류로 되돌리기" : "처리 완료"}</button>
        <button class="small" data-brain-task="${item.id}">Task로 전환</button>
        <button class="small ghost" data-brain-study="${item.id}">Study로 전환</button>
      </div>
      ${iconActions("data-brain-edit", item.id, "data-brain-delete", item.id)}
    </article>
  `).join("") : `<div class="empty">아직 저장된 brain dump가 없습니다.</div>`;

  list.querySelectorAll("[data-brain-toggle]").forEach(btn => btn.addEventListener("click", () => {
    const item = state.brain.find(b => b.id === btn.dataset.brainToggle);
    if (item) item.processed = !item.processed;
    saveState();
    render();
  }));
  list.querySelectorAll("[data-brain-task]").forEach(btn => btn.addEventListener("click", () => {
    const item = state.brain.find(b => b.id === btn.dataset.brainTask);
    if (!item) return;
    state.tasks.unshift({ id: makeId("task"), title: (item.title || item.text).slice(0, 90), area: item.tag || "Productivity", due: "", quadrant: "schedule", done: false });
    item.processed = true;
    saveState();
    render();
  }));
  list.querySelectorAll("[data-brain-study]").forEach(btn => btn.addEventListener("click", () => {
    const item = state.brain.find(b => b.id === btn.dataset.brainStudy);
    if (!item) return;
    state.studies.unshift({ id: makeId("study"), topic: (item.title || item.text).slice(0, 90), bucket: "Exploration", track: "Personal", target: 0, logged: 0 });
    item.processed = true;
    saveState();
    render();
  }));
  list.querySelectorAll("[data-brain-edit]").forEach(btn => btn.addEventListener("click", () => {
    const item = state.brain.find(b => b.id === btn.dataset.brainEdit);
    if (item) openBrainEditor(item);
  }));
  list.querySelectorAll("[data-brain-delete]").forEach(btn => btn.addEventListener("click", () => {
    const item = state.brain.find(b => b.id === btn.dataset.brainDelete);
    if (!askDelete(item?.text || "Brain dump")) return;
    state.brain = state.brain.filter(b => b.id !== btn.dataset.brainDelete);
    saveState();
    render();
  }));
}

function renderStudy() {
  document.querySelector("#researchStudyForm").addEventListener("submit", event => {
    event.preventDefault();
    state.studies.unshift({
      id: makeId("study"),
      topic: document.querySelector("#researchStudyTopic").value.trim(),
      bucket: document.querySelector("#researchStudyBucket").value,
      track: document.querySelector("#researchStudyTrack").value,
      target: Number(document.querySelector("#researchStudyTarget").value || 0),
      logged: 0,
      notes: document.querySelector("#researchStudyNotes").value.trim(),
    });
    saveState();
    render();
  });

  document.querySelector("#explorationStudyForm").addEventListener("submit", event => {
    event.preventDefault();
    state.studies.unshift({
      id: makeId("study"),
      topic: document.querySelector("#explorationTopic").value.trim(),
      bucket: "Exploration",
      track: document.querySelector("#explorationTrack").value,
      target: Number(document.querySelector("#explorationTarget").value || 0),
      logged: 0,
      notes: document.querySelector("#explorationNotes").value.trim(),
    });
    saveState();
    render();
  });

  const researchItems = state.studies.filter(item => item.bucket !== "Exploration");
  const explorationItems = state.studies.filter(item => item.bucket === "Exploration");

  document.querySelector("#researchStudyList").innerHTML = researchItems.length ? researchItems.map(renderStudyCard).join("") : `<div class="empty">Research Core / Support 항목이 없습니다.</div>`;
  document.querySelector("#explorationStudyList").innerHTML = explorationItems.length ? explorationItems.map(renderStudyCard).join("") : `<div class="empty">Exploration 항목이 없습니다.</div>`;

  document.querySelectorAll("[data-study-edit]").forEach(btn => btn.addEventListener("click", () => {
    const item = state.studies.find(s => s.id === btn.dataset.studyEdit);
    if (item) openStudyEditor(item);
  }));
  document.querySelectorAll("[data-study-delete]").forEach(btn => btn.addEventListener("click", () => {
    const item = state.studies.find(s => s.id === btn.dataset.studyDelete);
    if (!askDelete(item?.topic || "Study 항목")) return;
    state.studies = state.studies.filter(s => s.id !== btn.dataset.studyDelete);
    saveState();
    render();
  }));
}

function renderStudyCard(item) {
  const target = Number(item.target || 0);
  const logged = Number(item.logged || 0);
  const percent = target > 0 ? Math.min(100, Math.round(logged / target * 100)) : 0;
  return `<article class="card">
    <div class="card-title"><h4>${escapeHtml(item.topic)}</h4><span class="chip strong">${escapeHtml(item.bucket)}</span></div>
    <div class="progress"><span style="width:${percent}%"></span></div>
    <div class="meta"><span class="chip">${escapeHtml(item.track)}</span><span class="chip">${logged}/${target}h</span><span class="chip">${percent}%</span></div>
    ${item.notes ? `<p class="study-notes">${linkifyNotes(item.notes)}</p>` : ""}
    ${iconActions("data-study-edit", item.id, "data-study-delete", item.id)}
  </article>`;
}

const quadrants = {
  do: { title: "🔥 중요하고 긴급함", desc: "신속 처리/데드라인 핵심 업무: tape-out, 논문 작성, 미팅 자료 준비, 미팅 복기" },
  schedule: { title: "💡 중요하지만 긴급하지 않음", desc: "장기 성장 및 핵심 역량: 아이디어 디벨롭, 논문 읽기, 이론 공부, 운동/독서/생산성 보수" },
  delegate: { title: "➡️ 중요하지 않지만 긴급함", desc: "빨리 처리해야 하지만 큰 가치는 낮음: 과제 방어, 연구실 운영 행정, 미국 준비 등" },
  delete: { title: "💤 중요하지 않고 긴급하지 않음", desc: "휴식/취미/하지 않아도 되는 일: 부차적 자기관리, 미용 관련 등" },
};

// 중요도(세로축)를 결정하는 Type 집합. 여기 속하면 "중요"(위 행).
const IMPORTANT_TYPES = ["Deep Work", "Research Support"];

// ROS Queue 항목을 Task Matrix 사분면으로 라우팅.
// 중요도 = Type(중요 타입 여부), 긴급도 = urgency가 최상위 레벨(기본 "높음")일 때만 긴급.
function routeRosToQuadrant(queueTask) {
  const important = IMPORTANT_TYPES.includes(queueTask.type);
  const topUrgency = state.ros.settings?.urgencyLevels?.[0] || "높음";
  const urgent = queueTask.urgency === topUrgency;
  if (important) return urgent ? "do" : "schedule";
  return urgent ? "delegate" : "delete";
}

const ROS_TOPIC_TO_TASK_AREA = {
  General: "Productivity",
  Research: "Research",
  Study: "Study",
  Admin: "Admin",
};

function rosTopicToTaskArea(topic) {
  const taskAreas = state.ros.settings.taskAreas || [];
  if (taskAreas.includes(topic)) return topic;
  return ROS_TOPIC_TO_TASK_AREA[topic] || taskAreas[0] || "Research";
}

// ROS Queue Tasks를 Task Matrix에 동기화. sourceRosId로 자동 생성 항목을 추적해
// 재실행해도 중복 생성하지 않고, Queue 옵션 변경 시 사분면만 이동시킴.
function syncRosQueueToTaskMatrix() {
  let changed = false;
  const queueTasks = state.ros.queueTasks || [];
  const queueIds = new Set(queueTasks.map(task => task.id));

  queueTasks.forEach(queueTask => {
    const quadrant = routeRosToQuadrant(queueTask);
    const existing = state.tasks.find(task => task.sourceRosId === queueTask.id);
    if (existing) {
      if (existing.quadrant !== quadrant) {
        existing.quadrant = quadrant;
        changed = true;
      }
      const queueDone = isClosedStatus(queueTask.status);
      if (existing.done !== queueDone) {
        existing.done = queueDone;
        changed = true;
      }
    } else {
      state.tasks.unshift({
        id: makeId("task"),
        title: queueTask.title,
        area: rosTopicToTaskArea(queueTask.topic),
        priority: "Medium",
        source: `ROS ${queueTask.id}`,
        followUp: false,
        notes: queueTask.nextAction || "",
        due: queueTask.due || "",
        quadrant,
        done: isClosedStatus(queueTask.status),
        sourceRosId: queueTask.id,
      });
      changed = true;
    }
  });

  // 출처 ROS Queue 항목이 삭제된 자동 생성 Task는 함께 제거.
  const before = state.tasks.length;
  state.tasks = state.tasks.filter(task => !task.sourceRosId || queueIds.has(task.sourceRosId));
  if (state.tasks.length !== before) changed = true;

  return changed;
}

function renderTasks() {
  const areaSelect = document.querySelector("#taskArea");
  areaSelect.innerHTML = (state.ros.settings.taskAreas || []).map(area => `<option value="${escapeHtml(area)}">${escapeHtml(area)}</option>`).join("");

  document.querySelector("#taskForm").addEventListener("submit", event => {
    event.preventDefault();
    state.tasks.unshift({
      id: makeId("task"),
      title: document.querySelector("#taskTitle").value.trim(),
      area: document.querySelector("#taskArea").value,
      priority: document.querySelector("#taskPriority").value,
      due: document.querySelector("#taskDue").value,
      quadrant: document.querySelector("#taskQuadrant").value,
      source: document.querySelector("#taskSource").value.trim(),
      followUp: document.querySelector("#taskFollowUp").checked,
      notes: document.querySelector("#taskNotes").value.trim(),
      done: false,
    });
    saveState();
    render();
  });

  const hideDoneCheckbox = document.querySelector("#taskHideDone");
  if (hideDoneCheckbox) {
    hideDoneCheckbox.checked = rosDisplayPrefs.hideDoneTasks;
    hideDoneCheckbox.addEventListener("change", () => {
      rosDisplayPrefs.hideDoneTasks = hideDoneCheckbox.checked;
      saveRosDisplayPrefs();
      render();
    });
  }

  const matrix = document.querySelector("#matrix");
  matrix.innerHTML = Object.entries(quadrants).map(([key, q]) => {
    const tasks = state.tasks.filter(task => task.quadrant === key && (!rosDisplayPrefs.hideDoneTasks || !task.done));
    return `<section class="quadrant">
      <h3>${q.title}</h3>
      <p class="q-desc">${q.desc}</p>
      <div class="list">
        ${tasks.length ? tasks.map(renderTaskCard).join("") : `<div class="empty">비어 있음</div>`}
      </div>
    </section>`;
  }).join("");

  matrix.querySelectorAll("[data-task-done]").forEach(btn => btn.addEventListener("click", () => {
    const task = state.tasks.find(t => t.id === btn.dataset.taskDone);
    if (task) {
      const next = !task.done;
      if (task.sourceRosId) applyLinkedDone(task.sourceRosId, next);
      else task.done = next;
    }
    saveState();
    render();
  }));
  matrix.querySelectorAll("[data-task-edit]").forEach(btn => btn.addEventListener("click", () => {
    const task = state.tasks.find(t => t.id === btn.dataset.taskEdit);
    if (task) openTaskEditor(task);
  }));
  matrix.querySelectorAll("[data-task-delete]").forEach(btn => btn.addEventListener("click", () => {
    const task = state.tasks.find(t => t.id === btn.dataset.taskDelete);
    if (!askDelete(task?.title || "Task")) return;
    state.tasks = state.tasks.filter(t => t.id !== btn.dataset.taskDelete);
    saveState();
    render();
  }));
  matrix.querySelectorAll("[data-task-move]").forEach(select => select.addEventListener("change", () => {
    const task = state.tasks.find(t => t.id === select.dataset.taskMove);
    if (task) task.quadrant = select.value;
    saveState();
    render();
  }));
}

function renderTaskCard(task) {
  const options = Object.entries(quadrants).map(([key, q]) => `<option value="${key}" ${task.quadrant === key ? "selected" : ""}>${q.title}</option>`).join("");
  return `<article class="card ${task.done ? "done" : ""}">
    <div class="card-title"><h4>${escapeHtml(task.title)}</h4><span class="chip">${task.done ? "done" : "open"}</span></div>
    <div class="meta">
      <span class="chip">${escapeHtml(task.area || "no area")}</span>
      <span class="chip">${escapeHtml(task.priority || "Medium")}</span>
      <span class="chip">${formatDate(task.due)}</span>
      ${task.source ? `<span class="chip">${escapeHtml(task.source)}</span>` : ""}
      ${task.followUp ? `<span class="chip strong">follow-up</span>` : ""}
    </div>
    ${task.notes ? `<p>${formatMultiline(task.notes)}</p>` : ""}
    <div class="actions">
      <select data-task-move="${task.id}">${options}</select>
      <button class="small ghost" data-task-done="${task.id}">${task.done ? "reopen" : "done"}</button>
    </div>
    ${iconActions("data-task-edit", task.id, "data-task-delete", task.id)}
  </article>`;
}

function getHabitsForDate(key) {
  return state.habits.filter(h => h.active !== false && isHabitScheduledOnDate(h, key));
}

function getHabitWeekStats(weekStart) {
  let checked = 0;
  let target = 0;
  for (let i = 0; i < 7; i++) {
    const key = toDateKey(addDays(weekStart, i));
    const dayHabits = getHabitsForDate(key);
    const dayLog = state.habitLogs[key] || {};
    checked += dayHabits.filter(h => dayLog[h.id]).length;
    target += dayHabits.length;
  }
  return { checked, target };
}

function getHabitDayStats(key) {
  const active = getHabitsForDate(key);
  const dayLog = state.habitLogs[key] || {};
  const checked = active.filter(h => dayLog[h.id]).length;
  return { checked, total: active.length };
}

function toggleHabitLog(dateKey, habitId, checked) {
  if (!state.habitLogs[dateKey]) state.habitLogs[dateKey] = {};
  state.habitLogs[dateKey][habitId] = checked;
  if (!checked) delete state.habitLogs[dateKey][habitId];
  if (!Object.keys(state.habitLogs[dateKey]).length) delete state.habitLogs[dateKey];
}

function renderHabits() {
  const weekdayPicker = document.querySelector("#habitWeekdayPicker");
  if (weekdayPicker) weekdayPicker.innerHTML = weekdayPickerHtml("newHabitWeekdays", allWeekdays);

  document.querySelector("#habitForm").addEventListener("submit", event => {
    event.preventDefault();
    const weekdays = readWeekdayInputs(document.querySelector("#habitForm"), "newHabitWeekdays");
    state.habits.push({
      id: makeId("habit"),
      name: document.querySelector("#habitName").value.trim(),
      target: weekdays.length,
      active: true,
      weekdays,
    });
    saveState();
    render();
  });

  const editBtn = document.querySelector("#habitEditBtn");
  if (editBtn) editBtn.addEventListener("click", openHabitSettingsModal);

  document.querySelector("#habitModeButtons").innerHTML = habitModes.map(mode => `
    <button class="small ${currentHabitMode === mode ? "" : "ghost"}" data-habit-mode="${mode}" type="button">${mode[0].toUpperCase() + mode.slice(1)}</button>
  `).join("");
  document.querySelectorAll("[data-habit-mode]").forEach(btn => btn.addEventListener("click", () => setHabitMode(btn.dataset.habitMode)));

  document.querySelector("#habitPrev").addEventListener("click", () => shiftHabitDate(-1));
  document.querySelector("#habitNext").addEventListener("click", () => shiftHabitDate(1));
  document.querySelector("#habitToday").addEventListener("click", () => {
    setHabitDate(todayKey());
    render();
  });

  if (currentHabitMode === "month") renderHabitMonth();
  if (currentHabitMode === "week") renderHabitWeek();
  if (currentHabitMode === "day") renderHabitDay();
  renderHabitDayPanel();
  bindHabitEvents();
}

function shiftHabitDate(direction) {
  const current = fromDateKey(currentHabitDate);
  const next = currentHabitMode === "month" ? addMonths(current, direction) : addDays(current, currentHabitMode === "week" ? direction * 7 : direction);
  setHabitDate(toDateKey(next));
  render();
}

function renderHabitMonth() {
  const current = fromDateKey(currentHabitDate);
  const year = current.getFullYear();
  const month = current.getMonth();
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const startIndex = first.getDay() === 0 ? 6 : first.getDay() - 1;
  const cells = [];
  for (let i = 0; i < startIndex; i++) cells.push(null);
  for (let day = 1; day <= last.getDate(); day++) cells.push(new Date(year, month, day));
  document.querySelector("#habitCalendarTitle").textContent = current.toLocaleDateString("ko-KR", { year: "numeric", month: "long" });
  document.querySelector("#habitCalendar").innerHTML = `
    <div class="month-grid calendar-head">${dayLabels.map(d => `<div>${d}</div>`).join("")}</div>
    <div class="month-grid">
      ${cells.map(date => {
        if (!date) return `<div class="month-cell blank"></div>`;
        const key = toDateKey(date);
        const stats = getHabitDayStats(key);
        return `<button class="month-cell ${key === currentHabitDate ? "selected" : ""}" data-date-drill="${key}" type="button">
          <span class="date-number">${date.getDate()}</span>
          <span class="habit-dotline">${stats.checked}/${stats.total}</span>
        </button>`;
      }).join("")}
    </div>`;
}

function renderHabitWeek() {
  const start = startOfWeek(fromDateKey(currentHabitDate));
  const end = addDays(start, 6);
  document.querySelector("#habitCalendarTitle").textContent = `${formatKoDate(start, { month: "short", day: "numeric" })} – ${formatKoDate(end, { month: "short", day: "numeric" })}`;
  document.querySelector("#habitCalendar").innerHTML = `<div class="week-list">
    ${Array.from({ length: 7 }, (_, i) => addDays(start, i)).map(date => {
      const key = toDateKey(date);
      const stats = getHabitDayStats(key);
      return `<button class="week-day ${key === currentHabitDate ? "selected" : ""}" data-date-drill="${key}" type="button">
        <strong>${formatKoDate(date, { weekday: "short", month: "short", day: "numeric" })}</strong>
        <span>${stats.checked}/${stats.total} checks</span>
      </button>`;
    }).join("")}
  </div>`;
}

function renderHabitDay() {
  document.querySelector("#habitCalendarTitle").textContent = formatKoDate(currentHabitDate, { year: "numeric", month: "long", day: "numeric", weekday: "long" });
  document.querySelector("#habitCalendar").innerHTML = `<div class="empty">아래 Day Checklist에서 오늘의 습관을 체크합니다.</div>`;
}

function renderHabitDayPanel() {
  const key = currentHabitDate;
  const active = getHabitsForDate(key);
  const dayLog = state.habitLogs[key] || {};
  const stats = getHabitDayStats(key);
  document.querySelector("#habitDayPanel").innerHTML = `
    <div class="panel-header inner-header">
      <div>
        <h3>Day Checklist</h3>
        <p class="section-subtitle">${formatKoDate(key, { year: "numeric", month: "short", day: "numeric", weekday: "short" })}</p>
      </div>
      <span class="chip strong">${stats.checked}/${stats.total}</span>
    </div>
    <div class="day-habit-list">
      ${active.length ? active.map(habit => `
        <label class="day-habit-row">
          <input type="checkbox" data-habit-check="${habit.id}" data-date="${key}" ${dayLog[habit.id] ? "checked" : ""}>
          <span>${escapeHtml(habit.name)}</span>
          <em>${formatHabitWeekdays(habit)}</em>
        </label>
      `).join("") : `<div class="empty">등록된 습관이 없습니다.</div>`}
    </div>`;
}

function bindHabitEvents() {
  document.querySelectorAll("[data-date-drill]").forEach(btn => btn.addEventListener("click", () => {
    setHabitDate(btn.dataset.dateDrill);
    if (currentHabitMode === "month") currentHabitMode = "week";
    else if (currentHabitMode === "week") currentHabitMode = "day";
    localStorage.setItem("productivity-os-habit-mode", currentHabitMode);
    render();
  }));
  document.querySelectorAll("[data-habit-check]").forEach(input => input.addEventListener("change", () => {
    toggleHabitLog(input.dataset.date, input.dataset.habitCheck, input.checked);
    saveState();
    render();
  }));
}

function defaultDayStarterRow() {
  return { label: "", source: "manual", refId: "", skimStart: "", skimEnd: "", planStart: "", planEnd: "", actualStart: "", actualEnd: "", done: false };
}

// Day Starter 행을 from→to 위치로 이동(드래그 재정렬). 범위 밖/동일이면 무시.
function reorderDayStarterRow(rows, from, to) {
  if (from === to || from < 0 || to < 0 || from >= rows.length || to >= rows.length) return false;
  const [moved] = rows.splice(from, 1);
  rows.splice(to, 0, moved);
  return true;
}

// Day Starter 행의 done 표시 상태. task 참조 행은 항상 task.done을 따름(양방향), 그 외는 행 자체 done.
function dayStarterRowDone(row) {
  if (row.source === "task" && row.refId) {
    const task = state.tasks.find(t => t.id === row.refId);
    if (task) return !!task.done;
  }
  return !!row.done;
}

function ensureDayStarterRows(date) {
  const existing = Array.isArray(state.dailyKickoff[date]) ? state.dailyKickoff[date] : [];
  while (existing.length < 4) existing.push(defaultDayStarterRow());
  state.dailyKickoff[date] = existing;
  return existing;
}

function setDayStarterDate(key) {
  currentDayStarterDate = key;
  localStorage.setItem("productivity-os-daystarter-date", key);
}

function setRosDailyDate(key) {
  currentRosDailyDate = key;
  localStorage.setItem("productivity-os-rosdaily-date", key);
}

function setWeeklyWeekStart(key) {
  currentWeeklyWeekStart = key;
}

// 주 시작(월요일) 날짜키로 "M/D ~ M/D"(월~일) 범위 문자열 생성.
function formatWeekRange(weekStartKey) {
  if (!weekStartKey) return "주 미지정";
  const start = fromDateKey(weekStartKey);
  const end = addDays(start, 6);
  const fmt = d => `${d.getMonth() + 1}/${d.getDate()}`;
  return `${fmt(start)} ~ ${fmt(end)}`;
}

function renderDayStarter() {
  const rows = ensureDayStarterRows(currentDayStarterDate);
  document.querySelector("#dsTitle").textContent = formatKoDate(currentDayStarterDate, { year: "numeric", month: "long", day: "numeric", weekday: "long" });
  document.querySelector("#dsDateInput").value = currentDayStarterDate;

  const dailyRosIds = new Set(getDailyWorkItems().map(item => item.taskId).filter(Boolean));
  const taskOptions = state.tasks.filter(task => !task.done).map(task => {
    const inDaily = task.sourceRosId && dailyRosIds.has(task.sourceRosId);
    return { value: `task:${task.id}`, label: `${inDaily ? "💡 " : ""}${task.title}` };
  });
  document.querySelector("#dsTable").innerHTML = `${dailyRosIds.size ? `<p class="section-subtitle ds-ros-hint">💡 = 오늘 ROS Daily Execution에 잡아둔 연구 항목</p>` : ""}<div class="table-wrap"><table class="data-table day-starter-table">
    <thead><tr><th>#</th><th>Done</th><th>Task</th><th>Skimming</th><th>계획 블럭<span class="th-sub">할당 시각</span></th><th>실제 수행<span class="th-sub">실제 시각</span></th></tr></thead>
    <tbody>
      ${rows.map((row, index) => {
        const currentValue = row.source === "manual" ? "manual" : `${row.source}:${row.refId}`;
        const rowDone = dayStarterRowDone(row);
        const label = index < 3 ? String(index + 1) : "+";
        const reorderable = index < 3;
        return `<tr class="${rowDone ? "done" : ""}${reorderable ? " ds-draggable" : ""}"${reorderable ? ` data-ds-row="${index}"` : ""}>
        <td class="day-starter-num-cell"><div class="ds-cell-wrap">
          <span class="ds-num">${label}</span>
          ${reorderable ? `<button class="icon-btn drag-handle ds-drag" type="button" draggable="true" data-ds-drag="${index}" title="드래그해서 순서 변경" aria-label="순서 변경">${dragHandleSvg()}</button>` : ""}
          ${index >= 4 ? `<button class="icon-btn ds-row-remove" type="button" data-ds-remove="${index}" title="행 삭제" aria-label="행 삭제">×</button>` : ""}
        </div></td>
        <td class="day-starter-done-cell"><input type="checkbox" data-ds-done="${index}" ${rowDone ? "checked" : ""} /></td>
        <td class="wide-cell day-starter-task-cell"><div class="ds-cell-wrap">
          <select data-ds-pick="${index}">
            <option value="manual" ${currentValue === "manual" ? "selected" : ""}>직접 입력</option>
            ${taskOptions.length ? `<optgroup label="Task Matrix">${taskOptions.map(opt => `<option value="${escapeHtml(opt.value)}" ${currentValue === opt.value ? "selected" : ""}>${escapeHtml(opt.label)}</option>`).join("")}</optgroup>` : ""}
          </select>
          <input data-ds-label="${index}" placeholder="작업 설명" value="${escapeHtml(row.label)}" />
        </div></td>
        <td class="day-starter-time-cell"><div class="ds-cell-wrap">
          <input data-ds-skimstart="${index}" type="time" value="${escapeHtml(row.skimStart)}" />
          <span>–</span>
          <input data-ds-skimend="${index}" type="time" value="${escapeHtml(row.skimEnd)}" />
        </div></td>
        <td class="day-starter-time-cell"><div class="ds-cell-wrap">
          <input data-ds-planstart="${index}" type="time" value="${escapeHtml(row.planStart || "")}" />
          <span>–</span>
          <input data-ds-planend="${index}" type="time" value="${escapeHtml(row.planEnd || "")}" />
        </div></td>
        <td class="day-starter-time-cell"><div class="ds-cell-wrap">
          <input data-ds-actualstart="${index}" type="time" value="${escapeHtml(row.actualStart || "")}" />
          <span>–</span>
          <input data-ds-actualend="${index}" type="time" value="${escapeHtml(row.actualEnd || "")}" />
        </div></td>
      </tr>`;
      }).join("")}
    </tbody>
  </table></div>
  <div class="ds-add-row-wrap"><button class="small ghost" type="button" id="dsAddRow">+ 잡무 행 추가</button></div>`;

  bindDayStarterEvents(rows);
}

function bindDayStarterEvents(rows) {
  document.querySelector("#dsPrev").addEventListener("click", () => {
    setDayStarterDate(toDateKey(addDays(fromDateKey(currentDayStarterDate), -1)));
    render();
  });
  document.querySelector("#dsNext").addEventListener("click", () => {
    setDayStarterDate(toDateKey(addDays(fromDateKey(currentDayStarterDate), 1)));
    render();
  });
  document.querySelector("#dsToday").addEventListener("click", () => {
    setDayStarterDate(todayKey());
    render();
  });
  const dsDateInput = document.querySelector("#dsDateInput");
  document.querySelector("#dsPickDate").addEventListener("click", () => {
    if (typeof dsDateInput.showPicker === "function") dsDateInput.showPicker();
    else dsDateInput.click();
  });
  dsDateInput.addEventListener("change", () => {
    if (dsDateInput.value) {
      setDayStarterDate(dsDateInput.value);
      render();
    }
  });

  document.querySelectorAll("[data-ds-pick]").forEach(select => select.addEventListener("change", () => {
    const row = rows[Number(select.dataset.dsPick)];
    const value = select.value;
    if (value === "manual") {
      row.source = "manual";
      row.refId = "";
    } else {
      const [source, refId] = value.split(":");
      row.source = source;
      row.refId = refId;
      const pool = source === "task" ? state.tasks : state.ros.queueTasks;
      const picked = pool.find(item => item.id === refId);
      if (picked) row.label = picked.title;
    }
    saveState();
    renderDayStarter();
  }));

  document.querySelectorAll("[data-ds-label]").forEach(input => input.addEventListener("change", () => {
    rows[Number(input.dataset.dsLabel)].label = input.value.trim();
    saveState();
  }));
  document.querySelectorAll("[data-ds-skimstart]").forEach(input => input.addEventListener("change", () => {
    rows[Number(input.dataset.dsSkimstart)].skimStart = input.value;
    saveState();
  }));
  document.querySelectorAll("[data-ds-skimend]").forEach(input => input.addEventListener("change", () => {
    rows[Number(input.dataset.dsSkimend)].skimEnd = input.value;
    saveState();
  }));
  document.querySelectorAll("[data-ds-planstart]").forEach(input => input.addEventListener("change", () => {
    rows[Number(input.dataset.dsPlanstart)].planStart = input.value;
    saveState();
  }));
  document.querySelectorAll("[data-ds-planend]").forEach(input => input.addEventListener("change", () => {
    rows[Number(input.dataset.dsPlanend)].planEnd = input.value;
    saveState();
  }));
  document.querySelectorAll("[data-ds-actualstart]").forEach(input => input.addEventListener("change", () => {
    rows[Number(input.dataset.dsActualstart)].actualStart = input.value;
    saveState();
  }));
  document.querySelectorAll("[data-ds-actualend]").forEach(input => input.addEventListener("change", () => {
    rows[Number(input.dataset.dsActualend)].actualEnd = input.value;
    saveState();
  }));
  document.querySelectorAll("[data-ds-done]").forEach(input => input.addEventListener("change", () => {
    const row = rows[Number(input.dataset.dsDone)];
    const checked = input.checked;
    row.done = checked;
    if (row.source === "task" && row.refId) {
      const task = state.tasks.find(t => t.id === row.refId);
      if (task) {
        if (task.sourceRosId) applyLinkedDone(task.sourceRosId, checked);
        else task.done = checked;
      }
    }
    saveState();
    render();
  }));
  const dsAddRow = document.querySelector("#dsAddRow");
  if (dsAddRow) dsAddRow.addEventListener("click", () => {
    rows.push(defaultDayStarterRow());
    saveState();
    renderDayStarter();
  });
  document.querySelectorAll("[data-ds-remove]").forEach(btn => btn.addEventListener("click", () => {
    rows.splice(Number(btn.dataset.dsRemove), 1);
    saveState();
    renderDayStarter();
  }));
  let dsDragFrom = null;
  document.querySelectorAll("[data-ds-drag]").forEach(handle => {
    handle.addEventListener("dragstart", event => {
      dsDragFrom = Number(handle.dataset.dsDrag);
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(dsDragFrom));
      handle.closest("tr")?.classList.add("dragging");
    });
    handle.addEventListener("dragend", () => {
      dsDragFrom = null;
      document.querySelectorAll(".day-starter-table tr.dragging, .day-starter-table tr.drag-over")
        .forEach(tr => tr.classList.remove("dragging", "drag-over"));
    });
  });
  document.querySelectorAll("tr[data-ds-row]").forEach(tr => {
    tr.addEventListener("dragover", event => {
      if (dsDragFrom === null) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      if (Number(tr.dataset.dsRow) !== dsDragFrom) tr.classList.add("drag-over");
    });
    tr.addEventListener("dragleave", () => tr.classList.remove("drag-over"));
    tr.addEventListener("drop", event => {
      event.preventDefault();
      const to = Number(tr.dataset.dsRow);
      if (dsDragFrom !== null && reorderDayStarterRow(rows, dsDragFrom, to)) {
        saveState();
        renderDayStarter();
      }
    });
  });
}

function renderResearch() {
  if (!rosTabs.some(tab => tab.id === currentRosTab)) {
    currentRosTab = "overview";
    localStorage.setItem("productivity-os-ros-tab", currentRosTab);
  }
  const summary = document.querySelector("#rosSummary");
  summary.innerHTML = [
    { label: "Daily incomplete", value: getRosDailyIncompleteCount(), sub: "Daily Execution", tab: "daily" },
    { label: "Queue open", value: getQueueOpenCount(), sub: "Queue Tasks", tab: "queue" },
    { label: "Intake active", value: getIntakeOpenCount(), sub: "Intake Log", tab: "intake" },
    { label: "Now questions", value: getNowQuestionCount(), sub: "Questions", tab: "questions" },
  ].map(item => `
    <div class="stat compact-stat clickable" data-ros-tab-link="${item.tab}" role="button" tabindex="0">
      <div class="label">${item.label}</div>
      <div class="value">${item.value}</div>
      <div class="stat-hint">${item.sub}로 이동</div>
    </div>
  `).join("");

  summary.querySelectorAll("[data-ros-tab-link]").forEach(card => {
    bindKeyboardClick(card, () => setRosTab(card.dataset.rosTabLink));
  });

  const tabs = document.querySelector("#rosTabs");
  tabs.innerHTML = rosTabs.map(tab => `
    <button class="ros-tab ${tab.id === currentRosTab ? "active" : ""}" data-ros-tab="${tab.id}">${tab.title}</button>
  `).join("");
  tabs.querySelectorAll("[data-ros-tab]").forEach(btn => btn.addEventListener("click", () => setRosTab(btn.dataset.rosTab)));

  const body = document.querySelector("#rosBody");
  const renderers = {
    overview: renderRosOverview,
    intake: renderRosIntake,
    queue: renderRosQueue,
    daily: renderRosDaily,
    weekly: renderRosWeekly,
    meetings: renderRosMeetings,
    questions: renderRosQuestions,
    settings: renderRosSettings,
  };
  body.innerHTML = renderers[currentRosTab]?.() || renderRosOverview();
  bindRosEvents();
}

function renderRosOverview() {
  const statusCounts = countBy(state.ros.queueTasks || [], "status");
  const typeCounts = countBy(state.ros.queueTasks || [], "type");
  return `<section class="grid two-col">
    <div class="panel">
      <div class="panel-header">
        <h3>Flow Overview</h3>
        <span class="muted">ROS operating loop</span>
      </div>
      <p class="sheet-note">${escapeHtml(state.ros.flow.goal)}</p>
      <div class="flow compact-flow">
        ${["Intake Log", "Queue Tasks", "Daily Execution", "Weekly Review", "Questions", "Settings"].map((step, index) => `<div><strong>${index + 1}. ${escapeHtml(step)}</strong></div>`).join("")}
      </div>
    </div>
    <div class="panel">
      <div class="panel-header">
        <h3>Intended Use</h3>
        <span class="muted">종이 다이어리와 분리</span>
      </div>
      <ol class="plain-list">
        <li>인입 항목은 Intake Log에 먼저 저장.</li>
        <li>실행 가치가 있는 항목만 Queue로 변환.</li>
        <li>매일 Daily Execution에서 Queue 항목을 골라 오늘의 구성만 만듦.</li>
        <li>시간표와 time blocking은 종이 다이어리에서 처리.</li>
      </ol>
    </div>
    <div class="panel">
      <div class="panel-header"><h3>Queue Status</h3><span class="muted">Queue Tasks</span></div>
      ${renderMiniTable(statusCounts)}
    </div>
    <div class="panel">
      <div class="panel-header"><h3>Work Type</h3><span class="muted">Queue Tasks</span></div>
      ${renderMiniTable(typeCounts)}
    </div>
  </section>`;
}

function renderMiniTable(counts) {
  const rows = Object.entries(counts);
  return rows.length ? `<div class="table-wrap compact-table"><table class="data-table">
    <thead><tr><th>Category</th><th>Count</th></tr></thead>
    <tbody>${rows.map(([key, value]) => `<tr><td>${escapeHtml(key)}</td><td>${value}</td></tr>`).join("")}</tbody>
  </table></div>` : `<div class="empty">데이터 없음</div>`;
}

function optionList(values, selected = "") {
  return (values || []).map(value => `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(value)}</option>`).join("");
}


function renderModalField(field) {
  const inputId = `modal-field-${field.name}`;
  const full = field.full || field.type === "textarea" || field.type === "checkbox" ? " full" : "";
  const value = field.value ?? "";
  if (field.type === "checkbox") {
    return `<label class="modal-field checkbox-field${full}" for="${inputId}">
      <input id="${inputId}" data-modal-field="${escapeHtml(field.name)}" type="checkbox" ${value ? "checked" : ""} />
      <span>${escapeHtml(field.label)}</span>
    </label>`;
  }
  if (field.type === "select") {
    const options = [...(field.options || [])];
    const hasCurrent = options.some(option => {
      const optionValue = typeof option === "object" ? option.value : option;
      return String(optionValue) === String(value);
    });
    if (value !== "" && value !== undefined && !hasCurrent) options.unshift(value);
    return `<label class="modal-field${full}" for="${inputId}">
      <span>${escapeHtml(field.label)}</span>
      <select id="${inputId}" data-modal-field="${escapeHtml(field.name)}">
        ${options.map(option => {
          const optionValue = typeof option === "object" ? option.value : option;
          const optionLabel = typeof option === "object" ? option.label : option;
          return `<option value="${escapeHtml(optionValue)}" ${String(optionValue) === String(value) ? "selected" : ""}>${escapeHtml(optionLabel)}</option>`;
        }).join("")}
      </select>
    </label>`;
  }
  if (field.type === "textarea") {
    return `<label class="modal-field${full}" for="${inputId}">
      <span>${escapeHtml(field.label)}</span>
      <textarea id="${inputId}" data-modal-field="${escapeHtml(field.name)}" rows="${field.rows || 4}">${escapeHtml(value)}</textarea>
    </label>`;
  }
  return `<label class="modal-field${full}" for="${inputId}">
    <span>${escapeHtml(field.label)}</span>
    <input id="${inputId}" data-modal-field="${escapeHtml(field.name)}" type="${escapeHtml(field.type || "text")}" value="${escapeHtml(value)}" ${field.step ? `step="${escapeHtml(field.step)}"` : ""} ${field.min !== undefined ? `min="${escapeHtml(field.min)}"` : ""} />
  </label>`;
}

function openEditorModal({ title, fields, onSubmit, submitText = "저장" }) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
    <div class="modal-header">
      <h3>${escapeHtml(title)}</h3>
      <button type="button" class="icon-btn modal-close" aria-label="닫기">×</button>
    </div>
    <form class="modal-form">
      <div class="modal-grid">${fields.map(renderModalField).join("")}</div>
      <div class="modal-footer">
        <button type="button" class="secondary ghost-top modal-cancel">취소</button>
        <button type="submit">${escapeHtml(submitText)}</button>
      </div>
    </form>
  </div>`;
  document.body.append(backdrop);
  const close = () => backdrop.remove();
  backdrop.querySelector(".modal-close").addEventListener("click", close);
  backdrop.querySelector(".modal-cancel").addEventListener("click", close);
  backdrop.addEventListener("click", event => {
    if (event.target === backdrop) close();
  });
  const onKey = event => {
    if (event.key === "Escape") {
      close();
      document.removeEventListener("keydown", onKey);
    }
  };
  document.addEventListener("keydown", onKey);
  backdrop.querySelector("form").addEventListener("submit", event => {
    event.preventDefault();
    const values = {};
    fields.forEach(field => {
      const el = backdrop.querySelector(`[data-modal-field="${CSS.escape(field.name)}"]`);
      if (!el) return;
      if (field.type === "checkbox") values[field.name] = el.checked;
      else if (field.type === "number") values[field.name] = el.value === "" ? "" : Number(el.value);
      else values[field.name] = el.value;
    });
    close();
    document.removeEventListener("keydown", onKey);
    onSubmit(values);
  });
  const first = backdrop.querySelector("input, textarea, select, button");
  if (first) first.focus();
}

// 읽기 전용 정보 팝업(폼 아님). 기존 모달 마크업/CSS 재사용.
function openInfoModal({ title, bodyHtml }) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
    <div class="modal-header">
      <h3>${escapeHtml(title)}</h3>
      <button type="button" class="icon-btn modal-close" aria-label="닫기">×</button>
    </div>
    <div class="modal-body">${bodyHtml}</div>
    <div class="modal-footer"><button type="button" class="secondary ghost-top modal-cancel">닫기</button></div>
  </div>`;
  document.body.append(backdrop);
  const close = () => { backdrop.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = event => { if (event.key === "Escape") close(); };
  backdrop.querySelector(".modal-close").addEventListener("click", close);
  backdrop.querySelector(".modal-cancel").addEventListener("click", close);
  backdrop.addEventListener("click", event => { if (event.target === backdrop) close(); });
  document.addEventListener("keydown", onKey);
}

// 선택한 주(월~일)의 ROS Daily / Task Matrix / Queue 요약 스냅샷.
function openWeeklySnapshotModal(weekStartKey) {
  const start = fromDateKey(weekStartKey);
  const weekdayNames = ["월", "화", "수", "목", "금", "토", "일"];
  const days = [];
  for (let i = 0; i < 7; i++) {
    const k = toDateKey(addDays(start, i));
    const items = getDailyWorkItems(k);
    days.push({ k, name: weekdayNames[i], total: items.length, done: items.filter(it => isClosedStatus(it.status)).length });
  }
  const weekTotal = days.reduce((a, d) => a + d.total, 0);
  const weekDone = days.reduce((a, d) => a + d.done, 0);
  const tasksOpen = state.tasks.filter(t => !t.done).length;
  const tasksDone = state.tasks.filter(t => t.done).length;
  const queueOpen = getOpenQueueTasks().length;
  const objectives = (state.ros.weeklyReviews || []).filter(r => r.weekStart === weekStartKey);
  const body = `
    <p class="section-subtitle">${escapeHtml(formatWeekRange(weekStartKey))} 주간 요약 (읽기 전용)</p>
    <div class="snapshot-stats">
      <div class="snapshot-stat"><span class="snapshot-num">${weekDone}/${weekTotal}</span><span class="muted">ROS Daily 완료/전체</span></div>
      <div class="snapshot-stat"><span class="snapshot-num">${tasksDone}/${tasksOpen + tasksDone}</span><span class="muted">Task Matrix done/전체</span></div>
      <div class="snapshot-stat"><span class="snapshot-num">${queueOpen}</span><span class="muted">ROS Queue open</span></div>
    </div>
    <div class="table-wrap compact-table"><table class="data-table">
      <thead><tr><th>요일</th><th>날짜</th><th>ROS Daily 완료/전체</th></tr></thead>
      <tbody>${days.map(d => `<tr><td>${d.name}</td><td>${escapeHtml(d.k)}</td><td>${d.done}/${d.total}</td></tr>`).join("")}</tbody>
    </table></div>
    ${objectives.length ? `<p><strong>이 주 ROS Weekly Objective</strong></p><ul class="plain-list">${objectives.map(o => `<li>${escapeHtml(o.objective || "(제목 없음)")}</li>`).join("")}</ul>` : `<p class="muted">이 주에 작성된 ROS Weekly Objective 없음.</p>`}
  `;
  openInfoModal({ title: "주간 스냅샷", bodyHtml: body });
}

function trashIconSvg() {
  return `<svg class="trash-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M9 6V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1" />
    <path d="M4 7h16" />
    <path d="M7 7l1 13a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2l1-13" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
  </svg>`;
}

function dragHandleSvg() {
  return `<svg class="drag-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M5 7h14" />
    <path d="M5 12h14" />
    <path d="M5 17h14" />
  </svg>`;
}

function iconActions(editAttr, editValue, deleteAttr, deleteValue) {
  return `<div class="card-bottom-actions">
    <button class="icon-btn edit-icon" type="button" title="수정" aria-label="수정" ${editAttr}="${escapeHtml(editValue)}">✎</button>
    <button class="icon-btn trash-icon" type="button" title="삭제" aria-label="삭제" ${deleteAttr}="${escapeHtml(deleteValue)}">${trashIconSvg()}</button>
  </div>`;
}

function askDelete(label) {
  return confirm(`${label || "이 항목"}을 삭제할까요?`);
}

function openBrainEditor(item) {
  openEditorModal({
    title: "Brain Dump 수정",
    fields: [
      { name: "title", label: "제목 (선택)", type: "text", value: item.title || "", full: true },
      { name: "text", label: "내용", type: "textarea", value: item.text, full: true },
      { name: "type", label: "Type", type: "select", value: item.type, options: ["bookmark", "idea", "question", "worry", "note"] },
      { name: "tag", label: "Tag", type: "text", value: item.tag || "" },
      { name: "processed", label: "처리 완료", type: "checkbox", value: !!item.processed, full: true },
    ],
    onSubmit: values => {
      item.title = values.title.trim();
      item.text = values.text.trim() || item.text;
      item.type = values.type;
      item.tag = values.tag.trim();
      item.processed = values.processed;
      saveState();
      render();
    },
  });
}

function openTaskEditor(task) {
  openEditorModal({
    title: "Task 수정",
    fields: [
      { name: "title", label: "작업명", type: "text", value: task.title, full: true },
      { name: "area", label: "Area", type: "select", value: task.area || "", options: state.ros.settings.taskAreas || [] },
      { name: "priority", label: "Priority", type: "select", value: task.priority || "Medium", options: ["High", "Medium", "Low"] },
      { name: "due", label: "Due", type: "date", value: task.due || "" },
      { name: "quadrant", label: "Quadrant", type: "select", value: task.quadrant, options: Object.entries(quadrants).map(([value, q]) => ({ value, label: q.title })) },
      { name: "source", label: "Context / Meeting", type: "text", value: task.source || "" },
      { name: "notes", label: "Notes / Next Action", type: "textarea", value: task.notes || "", full: true },
      { name: "followUp", label: "Follow-up", type: "checkbox", value: !!task.followUp },
      { name: "done", label: "Done", type: "checkbox", value: !!task.done },
    ],
    onSubmit: values => {
      Object.assign(task, {
        title: values.title.trim() || task.title,
        area: values.area,
        priority: values.priority,
        due: values.due,
        quadrant: values.quadrant,
        source: values.source.trim(),
        notes: values.notes.trim(),
        followUp: values.followUp,
        done: values.done,
      });
      saveState();
      render();
    },
  });
}

function openStudyEditor(item) {
  openEditorModal({
    title: "Study 항목 수정",
    fields: [
      { name: "topic", label: "Topic", type: "text", value: item.topic, full: true },
      { name: "bucket", label: "Bucket", type: "select", value: item.bucket, options: ["Research-core", "Research-support", "Exploration"] },
      { name: "track", label: "Track", type: "select", value: item.track, options: ["Both", "US", "KR", "Personal"] },
      { name: "target", label: "주간 목표 h", type: "number", value: Number(item.target || 0), step: "0.5", min: "0" },
      { name: "logged", label: "이번 주 기록 h", type: "number", value: Number(item.logged || 0), step: "0.5", min: "0" },
      { name: "notes", label: "메모 / 링크", type: "textarea", value: item.notes || "", full: true },
    ],
    onSubmit: values => {
      item.topic = values.topic.trim() || item.topic;
      item.bucket = values.bucket;
      item.track = values.track;
      item.target = Number(values.target || 0);
      item.logged = Number(values.logged || 0);
      item.notes = values.notes.trim();
      saveState();
      render();
    },
  });
}

function openIntakeEditor(item) {
  const settings = state.ros.settings;
  openEditorModal({
    title: "ROS Intake 수정",
    fields: [
      { name: "title", label: "Title", type: "text", value: item.title, full: true },
      { name: "kind", label: "Kind", type: "select", value: item.kind || "Inbox", options: ["Inbox", "Meeting", "Idea", "Request"] },
      { name: "date", label: "Date", type: "date", value: item.date || "" },
      { name: "source", label: "Source", type: "select", value: item.source || "", options: settings.sources || [] },
      { name: "topic", label: "Topic", type: "select", value: item.topic || "", options: settings.topics || [] },
      { name: "type", label: "Work Type", type: "select", value: item.type || "", options: settings.types || [] },
      { name: "status", label: "Status", type: "select", value: item.status || "", options: settings.statuses || [] },
      { name: "due", label: "Due", type: "date", value: item.due || "" },
      { name: "details", label: "메모", type: "textarea", value: item.details || "", full: true },
      { name: "decisions", label: "Decisions", type: "textarea", value: item.decisions || "", full: true },
      { name: "actions", label: "Actions", type: "textarea", value: item.actions || "", full: true },
      { name: "openQuestions", label: "Open Questions", type: "textarea", value: item.openQuestions || "", full: true },
      { name: "risks", label: "Risks", type: "textarea", value: item.risks || "", full: true },
      { name: "queued", label: "Queue로 보냄", type: "checkbox", value: !!item.queued },
    ],
    onSubmit: values => {
      Object.assign(item, values, { title: values.title.trim() || item.title });
      saveState();
      renderResearch();
    },
  });
}

function openQueueEditor(task) {
  const settings = state.ros.settings;
  openEditorModal({
    title: "ROS Queue 수정",
    fields: [
      { name: "title", label: "Title", type: "text", value: task.title, full: true },
      { name: "topic", label: "Topic", type: "select", value: task.topic || "", options: settings.topics || [] },
      { name: "track", label: "Track", type: "select", value: task.track || "", options: settings.tracks || [] },
      { name: "type", label: "Work Type", type: "select", value: task.type || "", options: settings.types || [] },
      { name: "status", label: "Status", type: "select", value: task.status || "", options: settings.statuses || [] },
      { name: "urgency", label: "긴급도", type: "select", value: task.urgency || "", options: settings.urgencyLevels || [] },
      { name: "effortHrs", label: "Effort h", type: "number", value: task.effortHrs || "", step: "0.5", min: "0" },
      { name: "due", label: "Due", type: "date", value: task.due || "" },
      { name: "nextAction", label: "메모", type: "textarea", value: task.nextAction || "", full: true },
      { name: "notes", label: "메모 (추가)", type: "textarea", value: task.notes || "", full: true },
    ],
    onSubmit: values => {
      Object.assign(task, values, { title: values.title.trim() || task.title });
      saveState();
      renderResearch();
    },
  });
}

function openDailyEditor(id) {
  const { section, item } = findDailyEntry(id);
  if (!item) return;
  const currentDate = currentRosDailyDate;
  const statusOptions = state.ros.settings.statuses || ["Todo", "Doing", "Waiting", "Done", "Dropped"];
  openEditorModal({
    title: "Daily Execution 수정",
    fields: [
      { name: "title", label: "Title", type: "text", value: item.title || item.item || item.action || "", full: true },
      { name: "execDate", label: "실행 날짜", type: "date", value: currentDate },
      { name: "section", label: "Section", type: "select", value: section, options: [{ value: "deepWork", label: "Deep Work" }, { value: "processing", label: "Processing" }] },
      { name: "status", label: "Status", type: "select", value: item.status || "", options: statusOptions },
      { name: "taskId", label: "Task ID", type: "text", value: item.taskId || "" },
      { name: "timeboxHrs", label: "Timebox h", type: "number", value: item.timeboxHrs || "", step: "0.5", min: "0" },
      { name: "memo", label: "메모", type: "textarea", value: item.oneThing || item.action || "", full: true },
    ],
    onSubmit: values => {
      const memo = values.memo.trim();
      const targetSection = values.section;
      Object.assign(item, {
        title: values.title.trim() || item.title,
        status: values.status,
        taskId: values.taskId.trim(),
        timeboxHrs: values.timeboxHrs === "" ? "" : Number(values.timeboxHrs || 0),
        oneThing: targetSection === "processing" ? "" : memo,
        action: targetSection === "processing" ? memo : "",
      });
      const targetDate = values.execDate || currentDate;
      if (targetDate !== currentDate || targetSection !== section) {
        const fromBucket = ensureRosDailyBucket(currentDate);
        fromBucket[section] = fromBucket[section].filter(entry => entry.id !== item.id);
        const toBucket = ensureRosDailyBucket(targetDate);
        toBucket[targetSection].push(item);
      }
      if (item.taskId) applyLinkedDone(item.taskId, isClosedStatus(item.status));
      saveState();
      renderResearch();
    },
  });
}

// Daily 항목을 선택한 다른 날짜 버킷으로 복제(새 id, 상태 포함 그대로 복제, 원본 유지).
function openDailyDuplicateModal(id) {
  const { section, item } = findDailyEntry(id);
  if (!item) return;
  const defaultTarget = toDateKey(addDays(fromDateKey(currentRosDailyDate), 1));
  openEditorModal({
    title: "다른 날짜로 복제",
    submitText: "복제",
    fields: [
      { name: "execDate", label: "복제할 실행 날짜", type: "date", value: defaultTarget, full: true },
    ],
    onSubmit: values => {
      const targetDate = values.execDate || defaultTarget;
      const clone = { ...item, id: makeId("daily") };
      ensureRosDailyBucket(targetDate)[section].push(clone);
      saveState();
      renderResearch();
    },
  });
}

function openWeeklyEditor(id) {
  const row = state.ros.weeklyReviews.find(entry => entry.id === id);
  if (!row) return;
  openEditorModal({
    title: "ROS Weekly Review 수정",
    fields: [
      { name: "weekStart", label: "Week Start", type: "date", value: row.weekStart || "" },
      { name: "nextReview", label: "Next Review", type: "date", value: row.nextReview || "" },
      { name: "objective", label: "Objective", type: "textarea", value: row.objective || "", full: true },
      { name: "topOutcomes", label: "Top Outcomes", type: "textarea", value: row.topOutcomes || "", full: true },
      { name: "risks", label: "Risks / Blockers", type: "textarea", value: row.risks || "", full: true },
    ],
    onSubmit: values => {
      Object.assign(row, values);
      saveState();
      renderResearch();
    },
  });
}

function openQuestionEditor(id) {
  const q = state.ros.questions.find(entry => entry.id === id);
  if (!q) return;
  const settings = state.ros.settings;
  openEditorModal({
    title: "Question 수정",
    fields: [
      { name: "question", label: "Question", type: "text", value: q.question || "", full: true },
      { name: "created", label: "Created", type: "date", value: q.created || "" },
      { name: "nowLater", label: "Now/Later", type: "select", value: q.nowLater || "", options: settings.nowLater || [] },
      { name: "topic", label: "Topic", type: "select", value: q.topic || "", options: settings.topics || [] },
      { name: "status", label: "Status", type: "select", value: q.status || "Open", options: settings.statuses || ["Open", "Done"] },
      { name: "relatedTaskId", label: "Related Task ID", type: "text", value: q.relatedTaskId || "" },
      { name: "timeboxMin", label: "Timebox min", type: "number", value: q.timeboxMin || "", step: "5", min: "0" },
      { name: "why", label: "Why", type: "textarea", value: q.why || "", full: true },
      { name: "notesOutcome", label: "Outcome", type: "textarea", value: q.notesOutcome || "", full: true },
    ],
    onSubmit: values => {
      Object.assign(q, values);
      saveState();
      renderResearch();
    },
  });
}

function openMeetingNoteEditor(item) {
  const settings = state.ros.settings;
  openEditorModal({
    title: "Meeting Note 수정",
    fields: [
      { name: "date", label: "Date", type: "date", value: item.date || "" },
      { name: "track", label: "Meeting Type", type: "select", value: item.track || "", options: settings.topics || [] },
      { name: "note", label: "Note", type: "textarea", value: item.note || "", full: true },
      { name: "done", label: "복기 완료", type: "checkbox", value: !!item.done },
    ],
    onSubmit: values => {
      Object.assign(item, values);
      saveState();
      renderResearch();
    },
  });
}

function openHabitSettingsModal() {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true" aria-label="습관 편집">
    <div class="modal-header">
      <div>
        <h3>습관 편집</h3>
        <p class="section-subtitle">체크리스트에서는 삭제하지 않고, 여기서 습관 목록을 관리.</p>
      </div>
      <button type="button" class="icon-btn modal-close" aria-label="닫기">×</button>
    </div>
    <form class="modal-form" id="habitEditorForm">
      <div class="habit-editor-list">
        ${state.habits.map(habit => `<div class="habit-editor-row" data-habit-row="${escapeHtml(habit.id)}" draggable="true">
          <input data-habit-edit-name="${escapeHtml(habit.id)}" value="${escapeHtml(habit.name)}" aria-label="습관명" />
          <div class="weekday-toggle-group compact-weekdays">${weekdayPickerHtml(`habitWeekdays-${escapeHtml(habit.id)}`, habit.weekdays)}</div>
          <label class="checkbox-inline"><input data-habit-edit-active="${escapeHtml(habit.id)}" type="checkbox" ${habit.active !== false ? "checked" : ""} /> active</label>
          <button class="icon-btn trash-icon" type="button" data-habit-editor-delete="${escapeHtml(habit.id)}" title="삭제" aria-label="삭제">${trashIconSvg()}</button>
          <button class="icon-btn drag-handle" type="button" title="드래그해서 순서 변경" aria-label="순서 변경">${dragHandleSvg()}</button>
        </div>`).join("")}
      </div>
      <div class="modal-footer">
        <button type="button" class="secondary ghost-top modal-cancel">취소</button>
        <button type="submit">저장</button>
      </div>
    </form>
  </div>`;
  document.body.append(backdrop);
  const close = () => backdrop.remove();
  backdrop.querySelector(".modal-close").addEventListener("click", close);
  backdrop.querySelector(".modal-cancel").addEventListener("click", close);
  backdrop.addEventListener("click", event => { if (event.target === backdrop) close(); });
  backdrop.querySelectorAll("[data-habit-editor-delete]").forEach(btn => btn.addEventListener("click", () => {
    const row = backdrop.querySelector(`[data-habit-row="${CSS.escape(btn.dataset.habitEditorDelete)}"]`);
    if (row) row.remove();
  }));

  const editorList = backdrop.querySelector(".habit-editor-list");
  let draggedRow = null;
  editorList.querySelectorAll(".habit-editor-row").forEach(row => {
    row.addEventListener("dragstart", event => {
      draggedRow = row;
      row.classList.add("dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", row.dataset.habitRow);
    });
    row.addEventListener("dragend", () => {
      row.classList.remove("dragging");
      draggedRow = null;
    });
    row.addEventListener("dragover", event => {
      event.preventDefault();
      if (!draggedRow || draggedRow === row) return;
      const rect = row.getBoundingClientRect();
      const placeBefore = event.clientY < rect.top + rect.height / 2;
      editorList.insertBefore(draggedRow, placeBefore ? row : row.nextSibling);
    });
  });

  backdrop.querySelectorAll(".weekday-pill input").forEach(input => {
    const pill = input.closest(".weekday-pill");
    if (pill) pill.classList.toggle("selected", input.checked);
    input.addEventListener("change", () => {
      const parent = input.closest(".weekday-pill");
      if (parent) parent.classList.toggle("selected", input.checked);
    });
  });
  backdrop.querySelector("#habitEditorForm").addEventListener("submit", event => {
    event.preventDefault();
    const nextHabits = [];
    backdrop.querySelectorAll("[data-habit-row]").forEach(row => {
      const id = row.dataset.habitRow;
      const name = row.querySelector(`[data-habit-edit-name="${CSS.escape(id)}"]`).value.trim();
      if (!name) return;
      const active = row.querySelector(`[data-habit-edit-active="${CSS.escape(id)}"]`).checked;
      const weekdays = readWeekdayInputs(row, `habitWeekdays-${id}`);
      nextHabits.push({ id, name, target: weekdays.length, active, weekdays });
    });
    const remainingIds = new Set(nextHabits.map(h => h.id));
    Object.keys(state.habitLogs).forEach(date => {
      Object.keys(state.habitLogs[date]).forEach(id => {
        if (!remainingIds.has(id)) delete state.habitLogs[date][id];
      });
      if (!Object.keys(state.habitLogs[date]).length) delete state.habitLogs[date];
    });
    state.habits = nextHabits;
    close();
    saveState();
    render();
  });
}

function renderRosIntake() {
  const settings = state.ros.settings;
  const allRows = state.ros.intake || [];
  const rows = rosDisplayPrefs.hideQueuedIntake
    ? allRows.filter(item => !item.queued && !isClosedStatus(item.status))
    : allRows;
  return `<section class="panel">
    <div class="panel-header">
      <div>
        <h3>Intake Log</h3>
        <p class="section-subtitle">Inbox + Meeting + research brain dump. 판단 전에 먼저 받고, 필요한 것만 Queue로 보냄.</p>
      </div>
      <span class="muted">${getIntakeOpenCount()} active / ${allRows.length} total</span>
    </div>
    <form id="rosIntakeForm" class="form-grid ros-intake-form">
      <select id="rosIntakeKind"><option value="Inbox">Inbox</option><option value="Meeting">Meeting</option><option value="Idea">Idea</option><option value="Request">Request</option></select>
      <input id="rosIntakeDate" type="date" />
      <select id="rosIntakeSource">${optionList(settings.sources)}</select>
      <select id="rosIntakeTopic">${optionList(settings.topics)}</select>
      <select id="rosIntakeType">${optionList(settings.types)}</select>
      <select id="rosIntakeStatus">${optionList(settings.statuses, settings.statuses[0])}</select>
      <input id="rosIntakeDue" type="date" />
      <input id="rosIntakeTitle" placeholder="인입 항목 제목" required />
      <textarea id="rosIntakeDetails" placeholder="메모 / 결정 / 액션 / 질문 / 리스크를 러프하게 기록"></textarea>
      <button class="icon-btn add-icon form-add-btn" type="submit" aria-label="Intake 추가" title="Intake 추가">+</button>
    </form>
    <div class="view-toolbar">
      <div class="segmented compact-segmented">
        <button class="small ghost ${rosDisplayPrefs.intakeView === "list" ? "active" : ""}" type="button" data-ros-view="intake:list">List</button>
        <button class="small ghost ${rosDisplayPrefs.intakeView === "table" ? "active" : ""}" type="button" data-ros-view="intake:table">Table</button>
      </div>
      <label class="checkbox-inline filter-check"><input type="checkbox" data-ros-filter="hideQueuedIntake" ${rosDisplayPrefs.hideQueuedIntake ? "checked" : ""} /> Queue로 보냈거나 완료/중단된 항목 숨기기</label>
    </div>
    ${rosDisplayPrefs.intakeView === "table" ? renderIntakeTable(rows) : `<div class="intake-list list">
      ${rows.length ? rows.map(item => renderIntakeCard(item)).join("") : `<div class="empty">표시할 Intake 항목이 없습니다.</div>`}
    </div>`}
  </section>`;
}

function renderIntakeTable(rows) {
  if (!rows.length) return `<div class="empty">표시할 Intake 항목이 없습니다.</div>`;
  return `<div class="table-wrap ros-table-wrap"><table class="data-table interactive-table">
    <thead><tr>
      <th>Date</th><th>Kind</th><th>Title</th><th>Source</th><th>Topic</th><th>Type</th><th>Status</th><th>Due</th><th>메모</th><th>Actions</th>
    </tr></thead>
    <tbody>
      ${rows.map(item => `<tr class="${item.queued || isClosedStatus(item.status) ? "muted-row" : ""}">
        <td>${escapeHtml(item.date || "")}</td>
        <td>${escapeHtml(item.kind || "Inbox")}</td>
        <td class="wide-cell"><strong>${escapeHtml(item.title || "Untitled")}</strong></td>
        <td>${escapeHtml(item.source || "")}</td>
        <td>${escapeHtml(item.topic || "")}</td>
        <td>${escapeHtml(item.type || "")}</td>
        <td>${escapeHtml(item.status || "")}</td>
        <td>${escapeHtml(item.due || "")}</td>
        <td class="wide-cell">${formatMultiline(item.details || item.actions || item.openQuestions || "")}</td>
        <td class="table-actions">
          <button class="small" data-intake-to-queue="${escapeHtml(item.id)}">Queue</button>
          <button class="small ghost" data-intake-toggle="${escapeHtml(item.id)}">${isClosedStatus(item.status) ? "Reopen" : "Close"}</button>
          ${iconActions("data-intake-edit", item.id, "data-intake-delete", item.id)}
        </td>
      </tr>`).join("")}
    </tbody>
  </table></div>`;
}

function renderIntakeCard(item) {
  return `<article class="card ${item.queued || isClosedStatus(item.status) ? "done" : ""}">
    <div class="card-title">
      <h4>${escapeHtml(item.title)}</h4>
      <span class="chip strong">${escapeHtml(item.kind || "Inbox")}</span>
    </div>
    <div class="meta">
      <span class="chip">${escapeHtml(item.date || "No date")}</span>
      <span class="chip">${escapeHtml(item.source || "Self")}</span>
      <span class="chip">${escapeHtml(item.topic || "No topic")}</span>
      <span class="chip">${escapeHtml(item.type || "No type")}</span>
      <span class="chip">${escapeHtml(item.status || "No status")}</span>
      ${item.due ? `<span class="chip">Due ${escapeHtml(item.due)}</span>` : ""}
    </div>
    ${item.details ? `<p>${formatMultiline(item.details)}</p>` : ""}
    ${item.decisions ? `<p><strong>Decisions</strong><br>${formatMultiline(item.decisions)}</p>` : ""}
    ${item.actions ? `<p><strong>Actions</strong><br>${formatMultiline(item.actions)}</p>` : ""}
    ${item.openQuestions ? `<p><strong>Open Questions</strong><br>${formatMultiline(item.openQuestions)}</p>` : ""}
    ${item.risks ? `<p><strong>Risks</strong><br>${formatMultiline(item.risks)}</p>` : ""}
    <div class="card-footer">
      <div class="actions">
        <button class="small" data-intake-to-queue="${item.id}">${item.queued ? "Queue에 다시 추가" : "Queue로 보내기"}</button>
        <button class="small ghost" data-intake-toggle="${item.id}">${isClosedStatus(item.status) ? "Reopen" : "Close"}</button>
      </div>
      ${iconActions("data-intake-edit", item.id, "data-intake-delete", item.id)}
    </div>
  </article>`;
}

function renderRosQueue() {
  const settings = state.ros.settings;
  const allRows = state.ros.queueTasks || [];
  const rows = rosDisplayPrefs.hideDoneQueue
    ? allRows.filter(task => !isClosedStatus(task.status))
    : allRows;
  return `<section class="panel">
    <div class="panel-header">
      <div>
        <h3>Queue Tasks</h3>
        <p class="section-subtitle">마스터 작업 DB. 여기서 상태를 관리하고 Daily Execution으로 보냄.</p>
      </div>
      <span class="muted">${getQueueOpenCount()} open / ${allRows.length} total</span>
    </div>
    <form id="rosQueueForm" class="form-grid ros-queue-form">
      <input id="rosQueueTitle" placeholder="작업명" required />
      <select id="rosQueueTopic">${optionList(settings.topics)}</select>
      <select id="rosQueueTrack">${optionList(settings.tracks)}</select>
      <select id="rosQueueType">${optionList(settings.types)}</select>
      <select id="rosQueueStatus">${optionList(settings.statuses, settings.statuses[0])}</select>
      <select id="rosQueueUrgency" title="긴급도">${optionList(settings.urgencyLevels, settings.urgencyLevels[1])}</select>
      <input id="rosQueueEffort" type="number" min="0" step="0.5" placeholder="h" />
      <input id="rosQueueDue" type="date" />
      <input id="rosQueueNext" placeholder="Next action" />
      <button class="icon-btn add-icon form-add-btn" type="submit" aria-label="Queue 추가" title="Queue 추가">+</button>
    </form>
    <div class="view-toolbar">
      <div class="segmented compact-segmented">
        <button class="small ghost ${rosDisplayPrefs.queueView === "list" ? "active" : ""}" type="button" data-ros-view="queue:list">List</button>
        <button class="small ghost ${rosDisplayPrefs.queueView === "table" ? "active" : ""}" type="button" data-ros-view="queue:table">Table</button>
      </div>
      <label class="checkbox-inline filter-check"><input type="checkbox" data-ros-filter="hideDoneQueue" ${rosDisplayPrefs.hideDoneQueue ? "checked" : ""} /> Done/Closed 항목 숨기기</label>
    </div>
    ${rosDisplayPrefs.queueView === "table" ? renderQueueTable(rows) : `<div class="queue-list list">
      ${rows.length ? rows.map(renderQueueCard).join("") : `<div class="empty">표시할 Queue 항목이 없습니다.</div>`}
    </div>`}
  </section>`;
}

function renderQueueTable(rows) {
  if (!rows.length) return `<div class="empty">표시할 Queue 항목이 없습니다.</div>`;
  const settings = state.ros.settings;
  return `<div class="table-wrap ros-table-wrap"><table class="data-table interactive-table">
    <thead><tr>
      <th>ID</th><th>Title</th><th>Topic</th><th>Track</th><th>Type</th><th>Status</th><th>긴급도</th><th>Effort</th><th>Due</th><th>메모</th><th>Actions</th>
    </tr></thead>
    <tbody>
      ${rows.map(task => `<tr class="${isClosedStatus(task.status) ? "muted-row" : ""}">
        <td>${escapeHtml(task.id || "")}</td>
        <td class="wide-cell"><strong>${escapeHtml(task.title || "Untitled")}</strong></td>
        <td>${escapeHtml(task.topic || "")}</td>
        <td>${escapeHtml(task.track || "")}</td>
        <td>${escapeHtml(task.type || "")}</td>
        <td><select class="table-select" data-ros-queue-status="${escapeHtml(task.id)}">${optionList(settings.statuses, task.status)}</select></td>
        <td>${escapeHtml(task.urgency || "")}</td>
        <td>${task.effortHrs ? `${escapeHtml(task.effortHrs)}h` : ""}</td>
        <td>${escapeHtml(task.due || "")}</td>
        <td class="wide-cell">${formatMultiline(task.nextAction || "")}</td>
        <td class="table-actions">
          <button class="small" data-queue-to-daily="${escapeHtml(task.id)}" data-daily-section="deepWork">Deep</button>
          <button class="small ghost" data-queue-to-daily="${escapeHtml(task.id)}" data-daily-section="processing">Processing</button>
          ${iconActions("data-queue-edit", task.id, "data-queue-delete", task.id)}
        </td>
      </tr>`).join("")}
    </tbody>
  </table></div>`;
}

function renderQueueCard(task) {
  const settings = state.ros.settings;
  return `<article class="card ${isClosedStatus(task.status) ? "done" : ""}">
    <div class="card-title"><h4>${escapeHtml(task.title)}</h4><span class="chip strong">${escapeHtml(task.id)}</span></div>
    <div class="meta">
      <span class="chip">${escapeHtml(task.topic || "No topic")}</span>
      <span class="chip">${escapeHtml(task.track || "No track")}</span>
      <span class="chip">${escapeHtml(task.type || "No type")}</span>
      <span class="chip">긴급도 ${escapeHtml(task.urgency || "보통")}</span>
      ${task.effortHrs ? `<span class="chip">${escapeHtml(task.effortHrs)}h</span>` : ""}
      ${task.due ? `<span class="chip">Due ${escapeHtml(task.due)}</span>` : ""}
    </div>
    ${task.nextAction ? `<p><strong>메모</strong><br>${formatMultiline(task.nextAction)}</p>` : ""}
    <div class="actions">
      <select data-ros-queue-status="${escapeHtml(task.id)}">${optionList(settings.statuses, task.status)}</select>
      <button class="small" data-queue-to-daily="${escapeHtml(task.id)}" data-daily-section="deepWork">오늘 Deep Work로</button>
      <button class="small ghost" data-queue-to-daily="${escapeHtml(task.id)}" data-daily-section="processing">오늘 Processing으로</button>
    </div>
    ${iconActions("data-queue-edit", task.id, "data-queue-delete", task.id)}
  </article>`;
}

function renderRosDaily() {
  const daily = readRosDailyBucket();
  const deepRows = daily.deepWork || [];
  const processingRows = daily.processing || [];
  const openTasks = getOpenQueueTasks();
  const incomplete = getDailyWorkItems(currentRosDailyDate).filter(item => !isClosedStatus(item.status)).length;
  return `<section class="grid two-col">
    <div class="panel full-width-panel">
      <div class="panel-header">
        <div>
          <h3>Daily Execution Builder</h3>
          <p class="section-subtitle">Queue에서 그날 다룰 항목만 가져와 하루 일과의 재료로 구성. 날짜별로 따로 관리됨.</p>
        </div>
        <div class="calendar-nav">
          <span class="muted">${incomplete} incomplete</span>
          <button class="small ghost" id="rdPrev" type="button">‹</button>
          <button class="small ghost" id="rdToday" type="button">Today</button>
          <button class="small ghost" id="rdNext" type="button">›</button>
          <button class="icon-btn calendar-icon" id="rdPickDate" type="button" title="날짜 선택" aria-label="날짜 선택">
            <svg viewBox="0 0 24 24" aria-hidden="true" class="nav-svg">
              <rect x="4" y="5.5" width="16" height="14" rx="2"></rect>
              <path d="M4 9.7h16"></path>
              <path d="M8 3.5v3.4M16 3.5v3.4"></path>
            </svg>
          </button>
          <input id="rdDateInput" type="date" class="ds-date-input" aria-hidden="true" tabindex="-1" value="${escapeHtml(currentRosDailyDate)}" />
        </div>
      </div>
      <div class="calendar-title" id="rdTitle">${escapeHtml(formatKoDate(currentRosDailyDate, { year: "numeric", month: "long", day: "numeric", weekday: "long" }))}</div>
      <form id="rosDailyForm" class="form-grid daily-form">
        <select id="rosDailyTaskSelect">
          <option value="manual">직접 입력</option>
          ${openTasks.map(task => `<option value="${escapeHtml(task.id)}">${escapeHtml(task.title)}</option>`).join("")}
        </select>
        <select id="rosDailySection"><option value="deepWork">Deep Work</option><option value="processing">Processing</option></select>
        <input id="rosDailyTitle" placeholder="직접 입력 시 제목" />
        <input id="rosDailyOneThing" placeholder="메모" />
        <input id="rosDailyTimebox" type="number" min="0" step="0.5" placeholder="h" />
        <button class="icon-btn add-icon form-add-btn" type="submit" aria-label="오늘 목록에 추가" title="오늘 목록에 추가">+</button>
      </form>
    </div>

    <div class="panel">
      <div class="panel-header">
        <div>
          <h3>Deep Work</h3>
          <p class="section-subtitle">핵심 산출물을 전진시키는 오늘의 고집중 항목.</p>
        </div>
      </div>
      <div class="list">
        ${deepRows.length ? deepRows.map(item => renderDailyCard(item, "deepWork")).join("") : `<div class="empty">Deep Work 항목 없음</div>`}
      </div>
    </div>

    <div class="panel">
      <div class="panel-header">
        <h3>Processing / Execution</h3>
        <span class="muted">처리형 작업</span>
      </div>
      <div class="list">
        ${processingRows.length ? processingRows.map(item => renderDailyCard(item, "processing")).join("") : `<div class="empty">Processing 항목 없음</div>`}
      </div>
    </div>
  </section>`;
}

function renderDailyCard(item, section) {
  const title = item.title || item.item || item.action || "Untitled";
  const statusOptions = state.ros.settings.statuses || ["Todo", "Doing", "Waiting", "Done", "Dropped"];
  const key = item.id;
  return `<article class="card ${isClosedStatus(item.status) ? "done" : ""}">
    <div class="card-title">
      <h4>${escapeHtml(title)}</h4>
      <span class="chip strong">${escapeHtml(section === "deepWork" ? "Deep Work" : "Processing")}</span>
    </div>
    <div class="meta">
      ${item.taskId ? `<span class="chip">${escapeHtml(item.taskId)}</span>` : ""}
      ${item.timeboxHrs ? `<span class="chip">${escapeHtml(item.timeboxHrs)}h</span>` : ""}
      <span class="chip">${escapeHtml(item.status || "No status")}</span>
    </div>
    ${item.oneThing ? `<p><strong>메모</strong><br>${escapeHtml(item.oneThing)}</p>` : ""}
    ${item.action ? `<p><strong>메모</strong><br>${escapeHtml(item.action)}</p>` : ""}
    <div class="actions">
      <select data-ros-daily-status="${key}">
        ${statusOptions.map(status => `<option value="${escapeHtml(status)}" ${item.status === status ? "selected" : ""}>${escapeHtml(status)}</option>`).join("")}
      </select>
      <button class="small ghost" data-ros-daily-duplicate="${key}">다른 날짜로 복제</button>
    </div>
    ${iconActions("data-ros-daily-edit", key, "data-ros-daily-delete", key)}
  </article>`;
}

function renderRosWeekly() {
  const rows = state.ros.weeklyReviews || [];
  return `<section class="panel">
    <div class="panel-header">
      <div>
        <h3>Weekly Review</h3>
        <p class="section-subtitle">ROS Queue 우선순위 재편성용 (연구 한정). 생활 전반 회고는 상단 Weekly Review 탭에서.</p>
      </div>
      <span class="muted">${rows.length} review</span>
    </div>
    <form id="rosWeeklyForm" class="form-grid ros-weekly-form">
      <div class="week-stepper" id="rosWeeklyWeek">
        <span class="week-stepper-label">대상 주</span>
        <button class="small ghost" id="wkPrev" type="button" aria-label="이전 주">‹</button>
        <button class="small ghost" id="wkThis" type="button">이번 주</button>
        <button class="small ghost" id="wkNext" type="button" aria-label="다음 주">›</button>
        <span class="week-range">${escapeHtml(formatWeekRange(currentWeeklyWeekStart))}</span>
      </div>
      <input id="rosWeeklyObjective" placeholder="This week objective" required />
      <textarea id="rosWeeklyOutcomes" placeholder="Top outcomes"></textarea>
      <textarea id="rosWeeklyRisks" placeholder="Risks / blockers"></textarea>
      <input id="rosWeeklyNext" type="date" />
      <button class="icon-btn add-icon form-add-btn" type="submit" aria-label="Review 추가" title="Review 추가">+</button>
    </form>
    <div class="list">
      ${rows.length ? rows.map(row => `<article class="card">
        <div class="card-title"><h4>${escapeHtml(formatWeekRange(row.weekStart))}</h4><span class="chip strong">Weekly</span></div>
        <p><strong>Objective</strong><br>${formatMultiline(row.objective)}</p>
        <p><strong>Top Outcomes</strong><br>${formatMultiline(row.topOutcomes)}</p>
        <p><strong>Risks</strong><br>${formatMultiline(row.risks)}</p>
        ${iconActions("data-ros-weekly-edit", row.id, "data-ros-weekly-delete", row.id)}
      </article>`).join("") : `<div class="empty">ROS weekly review가 없습니다.</div>`}
    </div>
  </section>`;
}

function renderRosMeetings() {
  const settings = state.ros.settings;
  const rows = [...(state.ros.meetingNotes || [])].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  return `<section class="panel">
    <div class="panel-header">
      <div>
        <h3>Meeting Notes</h3>
        <p class="section-subtitle">미팅 직후 복기 메모. 날짜/미팅 종류와 자유 서술로 기록.</p>
      </div>
      <span class="muted">${rows.length} note</span>
    </div>
    <form id="rosMeetingForm" class="form-grid ros-meeting-form">
      <input id="rosMeetingDate" type="date" value="${escapeHtml(todayKey())}" required />
      <select id="rosMeetingTrack">${optionList(settings.topics)}</select>
      <textarea id="rosMeetingNote" placeholder="미팅 복기 내용"></textarea>
      <button class="icon-btn add-icon form-add-btn" type="submit" aria-label="미팅 복기 추가" title="미팅 복기 추가">+</button>
    </form>
    <div class="list">
      ${rows.length ? rows.map(item => `<article class="card ${item.done ? "done" : ""}">
        <div class="card-title"><h4>${escapeHtml(formatDate(item.date))}</h4><span class="chip strong">${escapeHtml(item.track || "")}</span></div>
        <p>${formatMultiline(item.note)}</p>
        <div class="card-footer">
          <div class="actions">
            <label class="checkbox-inline"><input type="checkbox" data-meeting-done="${escapeHtml(item.id)}" ${item.done ? "checked" : ""} /> 복기 완료</label>
          </div>
          ${iconActions("data-meeting-edit", item.id, "data-meeting-delete", item.id)}
        </div>
      </article>`).join("") : `<div class="empty">아직 미팅 복기 메모가 없습니다.</div>`}
    </div>
  </section>`;
}

function renderRosQuestions() {
  const settings = state.ros.settings;
  const rows = state.ros.questions || [];
  return `<section class="panel">
    <div class="panel-header">
      <div>
        <h3>Questions</h3>
        <p class="section-subtitle">탐색 중 생기는 질문을 Now/Later로 나눠 분기 폭발을 제어.</p>
      </div>
      <span class="muted">Now count: ${getNowQuestionCount()}</span>
    </div>
    <form id="rosQuestionForm" class="form-grid ros-question-form">
      <input id="rosQuestionText" placeholder="질문" required />
      <select id="rosQuestionNowLater">${optionList(settings.nowLater, settings.nowLater[0])}</select>
      <select id="rosQuestionTopic">${optionList(settings.topics)}</select>
      <input id="rosQuestionTask" placeholder="Related task ID, optional" />
      <input id="rosQuestionTimebox" type="number" min="0" step="5" placeholder="min" />
      <textarea id="rosQuestionWhy" placeholder="왜 중요한지 / decision에 미치는 영향"></textarea>
      <button class="icon-btn add-icon form-add-btn" type="submit" aria-label="Question 추가" title="Question 추가">+</button>
    </form>
    <div class="list">
      ${rows.length ? rows.map(q => `<article class="card ${isClosedStatus(q.status) ? "done" : ""}">
        <div class="card-title"><h4>${escapeHtml(q.question)}</h4><span class="chip strong">${escapeHtml(q.nowLater || "Later")}</span></div>
        <div class="meta"><span class="chip">${escapeHtml(q.created || "No date")}</span><span class="chip">${escapeHtml(q.relatedTaskId || "No task")}</span><span class="chip">${escapeHtml(q.timeboxMin || "No timebox")}</span></div>
        <p><strong>Why</strong><br>${formatMultiline(q.why)}</p>
        <p><strong>Outcome</strong><br>${formatMultiline(q.notesOutcome)}</p>
        ${iconActions("data-ros-question-edit", q.id, "data-ros-question-delete", q.id)}
      </article>`).join("") : `<div class="empty">현재 입력된 질문 백로그가 없습니다.</div>`}
    </div>
  </section>`;
}

function renderRosSettings() {
  const settings = state.ros.settings;
  return `<section class="grid two-col">
    <div class="panel full-width-panel">
      <div class="panel-header">
        <div>
          <h3>Settings · Tag / Option Manager</h3>
          <p class="section-subtitle">여기서 바꾼 옵션이 Intake, Queue, Daily, Task Matrix 입력폼에 반영됨.</p>
        </div>
      </div>
      <div class="settings-grid editable-settings">
        ${rosSettingLists.map(list => renderSettingsBox(list, settings[list.key] || [])).join("")}
      </div>
    </div>
    <div class="panel">
      <div class="panel-header"><h3>Type Definitions</h3><span class="muted">분류 기준</span></div>
      <div class="list">
        ${(settings.typeDefinitions || []).map(item => `<article class="card"><div class="card-title"><h4>${escapeHtml(item.type)}</h4></div><p>${escapeHtml(item.definition)}</p></article>`).join("")}
      </div>
    </div>
    <div class="panel">
      <div class="panel-header"><h3>Classification Rule</h3><span class="muted">현재 기준</span></div>
      <p class="sheet-note">${escapeHtml(settings.classificationRule)}</p>
    </div>
  </section>`;
}

function renderSettingsBox(list, values) {
  return `<div class="settings-box editable-box">
    <h4>${escapeHtml(list.title)}</h4>
    <p>${escapeHtml(list.hint)}</p>
    <div class="meta editable-chip-list">
      ${values.map(value => `<span class="chip editable-chip">${escapeHtml(value)} <button type="button" data-setting-delete="${list.key}" data-setting-value="${escapeHtml(value)}">×</button></span>`).join("")}
    </div>
    <form class="inline-add-form" data-setting-add-form="${list.key}">
      <input placeholder="새 옵션" />
      <button class="icon-btn add-icon settings-add-btn" type="submit" aria-label="옵션 추가" title="옵션 추가">+</button>
    </form>
  </div>`;
}

function renderDataTable(columns, rows) {
  if (!rows || !rows.length) return `<div class="empty">데이터 없음</div>`;
  return `<div class="table-wrap"><table class="data-table">
    <thead><tr>${columns.map(([, label]) => `<th>${escapeHtml(label)}</th>`).join("")}</tr></thead>
    <tbody>
      ${rows.map(row => `<tr>${columns.map(([key]) => `<td class="${String(row[key] || "").length > 36 ? "wide-cell" : ""}">${formatMultiline(row[key])}</td>`).join("")}</tr>`).join("")}
    </tbody>
  </table></div>`;
}

function makeQueueTaskFromIntake(item) {
  const num = String((state.ros.queueTasks || []).length + 1).padStart(3, "0");
  return {
    id: `ROS-${num}`,
    title: item.title,
    topic: item.topic || state.ros.settings.topics[0],
    track: state.ros.settings.tracks[0],
    type: item.type || state.ros.settings.types[0],
    status: state.ros.settings.statuses[0],
    urgency: state.ros.settings.urgencyLevels[1] || "보통",
    effortHrs: "",
    due: item.due || "",
    nextAction: item.actions || item.details || "",
    stopRule: "",
    notes: item.openQuestions || item.risks || "",
    sourceIntakeId: item.id,
  };
}

function addQueueTaskToDaily(taskId, section, date = currentRosDailyDate) {
  const task = state.ros.queueTasks.find(item => item.id === taskId);
  if (!task) return;
  const bucket = ensureRosDailyBucket(date);
  const dailyItem = {
    id: makeId("daily"),
    slot: (bucket[section] || []).length + 1,
    taskId: task.id,
    title: task.title,
    oneThing: section === "deepWork" ? task.nextAction || "" : "",
    action: section === "processing" ? task.nextAction || "" : "",
    timeboxHrs: Number(task.effortHrs || 0),
    status: state.ros.settings.statuses[0] || "Todo",
  };
  bucket[section].push(dailyItem);
}

function bindRosEvents() {
  const intakeForm = document.querySelector("#rosIntakeForm");
  if (intakeForm) {
    intakeForm.addEventListener("submit", event => {
      event.preventDefault();
      state.ros.intake.unshift({
        id: makeId("intake"),
        kind: document.querySelector("#rosIntakeKind").value,
        date: document.querySelector("#rosIntakeDate").value || todayKey(),
        title: document.querySelector("#rosIntakeTitle").value.trim(),
        source: document.querySelector("#rosIntakeSource").value,
        topic: document.querySelector("#rosIntakeTopic").value,
        type: document.querySelector("#rosIntakeType").value,
        status: document.querySelector("#rosIntakeStatus").value,
        due: document.querySelector("#rosIntakeDue").value,
        details: document.querySelector("#rosIntakeDetails").value.trim(),
        decisions: "",
        actions: "",
        openQuestions: "",
        risks: "",
        queued: false,
      });
      saveState();
      renderResearch();
    });
  }

  document.querySelectorAll("[data-ros-view]").forEach(btn => btn.addEventListener("click", () => {
    const [scope, view] = btn.dataset.rosView.split(":");
    if (scope === "intake") rosDisplayPrefs.intakeView = view;
    if (scope === "queue") rosDisplayPrefs.queueView = view;
    saveRosDisplayPrefs();
    renderResearch();
  }));

  document.querySelectorAll("[data-ros-filter]").forEach(input => input.addEventListener("change", () => {
    rosDisplayPrefs[input.dataset.rosFilter] = input.checked;
    saveRosDisplayPrefs();
    renderResearch();
  }));

  document.querySelectorAll("[data-intake-to-queue]").forEach(btn => btn.addEventListener("click", () => {
    const item = state.ros.intake.find(entry => entry.id === btn.dataset.intakeToQueue);
    if (!item) return;
    state.ros.queueTasks.unshift(makeQueueTaskFromIntake(item));
    item.queued = true;
    item.status = "Queued";
    saveState();
    currentRosTab = "queue";
    localStorage.setItem("productivity-os-ros-tab", currentRosTab);
    renderResearch();
  }));
  document.querySelectorAll("[data-intake-toggle]").forEach(btn => btn.addEventListener("click", () => {
    const item = state.ros.intake.find(entry => entry.id === btn.dataset.intakeToggle);
    if (!item) return;
    item.status = isClosedStatus(item.status) ? (state.ros.settings.statuses[0] || "Todo") : "Done";
    saveState();
    renderResearch();
  }));
  document.querySelectorAll("[data-intake-edit]").forEach(btn => btn.addEventListener("click", () => {
    const item = state.ros.intake.find(entry => entry.id === btn.dataset.intakeEdit);
    if (item) openIntakeEditor(item);
  }));
  document.querySelectorAll("[data-intake-delete]").forEach(btn => btn.addEventListener("click", () => {
    const item = state.ros.intake.find(entry => entry.id === btn.dataset.intakeDelete);
    if (!askDelete(item?.title || "Intake 항목")) return;
    state.ros.intake = state.ros.intake.filter(entry => entry.id !== btn.dataset.intakeDelete);
    saveState();
    renderResearch();
  }));

  const queueForm = document.querySelector("#rosQueueForm");
  if (queueForm) {
    queueForm.addEventListener("submit", event => {
      event.preventDefault();
      const num = String((state.ros.queueTasks || []).length + 1).padStart(3, "0");
      state.ros.queueTasks.unshift({
        id: `ROS-${num}`,
        title: document.querySelector("#rosQueueTitle").value.trim(),
        topic: document.querySelector("#rosQueueTopic").value,
        track: document.querySelector("#rosQueueTrack").value,
        type: document.querySelector("#rosQueueType").value,
        status: document.querySelector("#rosQueueStatus").value,
        urgency: document.querySelector("#rosQueueUrgency").value,
        effortHrs: document.querySelector("#rosQueueEffort").value,
        due: document.querySelector("#rosQueueDue").value,
        nextAction: document.querySelector("#rosQueueNext").value.trim(),
        stopRule: "",
        notes: "",
      });
      saveState();
      renderResearch();
    });
  }

  document.querySelectorAll("[data-ros-queue-status]").forEach(select => {
    select.addEventListener("change", () => {
      const task = state.ros.queueTasks.find(item => item.id === select.dataset.rosQueueStatus);
      if (task) {
        task.status = select.value;
        applyLinkedDone(task.id, isClosedStatus(task.status));
      }
      saveState();
      renderResearch();
    });
  });
  document.querySelectorAll("[data-queue-to-daily]").forEach(btn => btn.addEventListener("click", () => {
    addQueueTaskToDaily(btn.dataset.queueToDaily, btn.dataset.dailySection, todayKey());
    setRosDailyDate(todayKey());
    saveState();
    currentRosTab = "daily";
    localStorage.setItem("productivity-os-ros-tab", currentRosTab);
    renderResearch();
  }));
  document.querySelectorAll("[data-queue-edit]").forEach(btn => btn.addEventListener("click", () => {
    const task = state.ros.queueTasks.find(item => item.id === btn.dataset.queueEdit);
    if (task) openQueueEditor(task);
  }));
  document.querySelectorAll("[data-queue-delete]").forEach(btn => btn.addEventListener("click", () => {
    const task = state.ros.queueTasks.find(item => item.id === btn.dataset.queueDelete);
    if (!askDelete(task?.title || "Queue 항목")) return;
    state.ros.queueTasks = state.ros.queueTasks.filter(item => item.id !== btn.dataset.queueDelete);
    saveState();
    renderResearch();
  }));

  document.querySelectorAll("[data-ros-daily-status]").forEach(select => {
    select.addEventListener("change", () => {
      const { item } = findDailyEntry(select.dataset.rosDailyStatus);
      if (item) {
        item.status = select.value;
        if (item.taskId) applyLinkedDone(item.taskId, isClosedStatus(item.status));
      }
      saveState();
      renderResearch();
    });
  });

  document.querySelectorAll("[data-ros-daily-edit]").forEach(btn => {
    btn.addEventListener("click", () => {
      openDailyEditor(btn.dataset.rosDailyEdit);
    });
  });

  document.querySelectorAll("[data-ros-daily-duplicate]").forEach(btn => {
    btn.addEventListener("click", () => {
      openDailyDuplicateModal(btn.dataset.rosDailyDuplicate);
    });
  });

  document.querySelectorAll("[data-ros-daily-delete]").forEach(btn => {
    btn.addEventListener("click", () => {
      const { section, item } = findDailyEntry(btn.dataset.rosDailyDelete);
      if (!section) return;
      if (!askDelete(item?.title || "Daily 항목")) return;
      const bucket = ensureRosDailyBucket();
      bucket[section] = bucket[section].filter(entry => entry.id !== item.id);
      saveState();
      renderResearch();
    });
  });

  const rdPrev = document.querySelector("#rdPrev");
  if (rdPrev) {
    rdPrev.addEventListener("click", () => {
      setRosDailyDate(toDateKey(addDays(fromDateKey(currentRosDailyDate), -1)));
      renderResearch();
    });
    document.querySelector("#rdNext").addEventListener("click", () => {
      setRosDailyDate(toDateKey(addDays(fromDateKey(currentRosDailyDate), 1)));
      renderResearch();
    });
    document.querySelector("#rdToday").addEventListener("click", () => {
      setRosDailyDate(todayKey());
      renderResearch();
    });
    const rdDateInput = document.querySelector("#rdDateInput");
    document.querySelector("#rdPickDate").addEventListener("click", () => {
      if (typeof rdDateInput.showPicker === "function") rdDateInput.showPicker();
      else rdDateInput.click();
    });
    rdDateInput.addEventListener("change", () => {
      if (rdDateInput.value) {
        setRosDailyDate(rdDateInput.value);
        renderResearch();
      }
    });
  }

  const dailyForm = document.querySelector("#rosDailyForm");
  if (dailyForm) {
    dailyForm.addEventListener("submit", event => {
      event.preventDefault();
      const selected = document.querySelector("#rosDailyTaskSelect").value;
      const section = document.querySelector("#rosDailySection").value;
      const manualTitle = document.querySelector("#rosDailyTitle").value.trim();
      const bucket = ensureRosDailyBucket();
      if (selected !== "manual") {
        addQueueTaskToDaily(selected, section);
        const added = bucket[section][bucket[section].length - 1];
        added.oneThing = document.querySelector("#rosDailyOneThing").value.trim() || added.oneThing;
        added.timeboxHrs = Number(document.querySelector("#rosDailyTimebox").value || added.timeboxHrs || 0);
      } else if (manualTitle) {
        bucket[section].push({
          id: makeId("daily"),
          slot: bucket[section].length + 1,
          taskId: "",
          title: manualTitle,
          oneThing: document.querySelector("#rosDailyOneThing").value.trim(),
          action: section === "processing" ? document.querySelector("#rosDailyOneThing").value.trim() : "",
          timeboxHrs: Number(document.querySelector("#rosDailyTimebox").value || 0),
          status: state.ros.settings.statuses[0] || "Todo",
        });
      }
      saveState();
      renderResearch();
    });
  }

  const wkPrev = document.querySelector("#wkPrev");
  if (wkPrev) {
    wkPrev.addEventListener("click", () => {
      setWeeklyWeekStart(toDateKey(addDays(fromDateKey(currentWeeklyWeekStart), -7)));
      renderResearch();
    });
    document.querySelector("#wkNext").addEventListener("click", () => {
      setWeeklyWeekStart(toDateKey(addDays(fromDateKey(currentWeeklyWeekStart), 7)));
      renderResearch();
    });
    document.querySelector("#wkThis").addEventListener("click", () => {
      setWeeklyWeekStart(toDateKey(startOfWeek(new Date())));
      renderResearch();
    });
  }

  const weeklyForm = document.querySelector("#rosWeeklyForm");
  if (weeklyForm) {
    weeklyForm.addEventListener("submit", event => {
      event.preventDefault();
      state.ros.weeklyReviews.unshift({
        id: makeId("weekly"),
        weekStart: currentWeeklyWeekStart,
        objective: document.querySelector("#rosWeeklyObjective").value.trim(),
        topOutcomes: document.querySelector("#rosWeeklyOutcomes").value.trim(),
        keyTasks: "",
        externalCommitments: "",
        risks: document.querySelector("#rosWeeklyRisks").value.trim(),
        notes: "",
        nextReview: document.querySelector("#rosWeeklyNext").value,
      });
      saveState();
      renderResearch();
    });
  }
  document.querySelectorAll("[data-ros-weekly-edit]").forEach(btn => btn.addEventListener("click", () => {
    openWeeklyEditor(btn.dataset.rosWeeklyEdit);
  }));
  document.querySelectorAll("[data-ros-weekly-delete]").forEach(btn => btn.addEventListener("click", () => {
    const id = btn.dataset.rosWeeklyDelete;
    const row = state.ros.weeklyReviews.find(entry => entry.id === id);
    if (!askDelete(row?.objective || "Weekly review")) return;
    state.ros.weeklyReviews = state.ros.weeklyReviews.filter(entry => entry.id !== id);
    saveState();
    renderResearch();
  }));

  const meetingForm = document.querySelector("#rosMeetingForm");
  if (meetingForm) {
    meetingForm.addEventListener("submit", event => {
      event.preventDefault();
      state.ros.meetingNotes.unshift({
        id: makeId("meeting"),
        date: document.querySelector("#rosMeetingDate").value || todayKey(),
        track: document.querySelector("#rosMeetingTrack").value,
        note: document.querySelector("#rosMeetingNote").value.trim(),
        done: false,
      });
      saveState();
      renderResearch();
    });
  }
  document.querySelectorAll("[data-meeting-done]").forEach(input => input.addEventListener("change", () => {
    const item = state.ros.meetingNotes.find(entry => entry.id === input.dataset.meetingDone);
    if (item) item.done = input.checked;
    saveState();
    renderResearch();
  }));
  document.querySelectorAll("[data-meeting-edit]").forEach(btn => btn.addEventListener("click", () => {
    const item = state.ros.meetingNotes.find(entry => entry.id === btn.dataset.meetingEdit);
    if (item) openMeetingNoteEditor(item);
  }));
  document.querySelectorAll("[data-meeting-delete]").forEach(btn => btn.addEventListener("click", () => {
    const item = state.ros.meetingNotes.find(entry => entry.id === btn.dataset.meetingDelete);
    if (!askDelete(formatDate(item?.date) || "Meeting note")) return;
    state.ros.meetingNotes = state.ros.meetingNotes.filter(entry => entry.id !== btn.dataset.meetingDelete);
    saveState();
    renderResearch();
  }));

  const questionForm = document.querySelector("#rosQuestionForm");
  if (questionForm) {
    questionForm.addEventListener("submit", event => {
      event.preventDefault();
      state.ros.questions.unshift({
        id: makeId("question"),
        created: todayKey(),
        question: document.querySelector("#rosQuestionText").value.trim(),
        nowLater: document.querySelector("#rosQuestionNowLater").value,
        relatedTaskId: document.querySelector("#rosQuestionTask").value.trim(),
        topic: document.querySelector("#rosQuestionTopic").value,
        why: document.querySelector("#rosQuestionWhy").value.trim(),
        timeboxMin: document.querySelector("#rosQuestionTimebox").value,
        stopRuleMet: "",
        notesOutcome: "",
        status: "Open",
      });
      saveState();
      renderResearch();
    });
  }
  document.querySelectorAll("[data-ros-question-edit]").forEach(btn => btn.addEventListener("click", () => {
    openQuestionEditor(btn.dataset.rosQuestionEdit);
  }));
  document.querySelectorAll("[data-ros-question-delete]").forEach(btn => btn.addEventListener("click", () => {
    const id = btn.dataset.rosQuestionDelete;
    const q = state.ros.questions.find(entry => entry.id === id);
    if (!askDelete(q?.question || "Question")) return;
    state.ros.questions = state.ros.questions.filter(entry => entry.id !== id);
    saveState();
    renderResearch();
  }));

  document.querySelectorAll("[data-setting-add-form]").forEach(form => {
    form.addEventListener("submit", event => {
      event.preventDefault();
      const key = form.dataset.settingAddForm;
      const input = form.querySelector("input");
      const value = input.value.trim();
      if (!value) return;
      if (!state.ros.settings[key]) state.ros.settings[key] = [];
      if (!state.ros.settings[key].includes(value)) state.ros.settings[key].push(value);
      saveState();
      renderResearch();
    });
  });
  document.querySelectorAll("[data-setting-delete]").forEach(btn => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.settingDelete;
      const value = btn.dataset.settingValue;
      state.ros.settings[key] = (state.ros.settings[key] || []).filter(item => item !== value);
      ensureRosSettings(state.ros.settings);
      saveState();
      renderResearch();
    });
  });
}


function findAlgorithmNode(node, id) {
  if (!node) return null;
  if (node.id === id) return node;
  for (const child of node.children || []) {
    const found = findAlgorithmNode(child, id);
    if (found) return found;
  }
  return null;
}

function removeAlgorithmNode(parent, id) {
  if (!parent?.children) return false;
  const before = parent.children.length;
  parent.children = parent.children.filter(child => child.id !== id);
  if (parent.children.length !== before) return true;
  return parent.children.some(child => removeAlgorithmNode(child, id));
}

function renderAlgorithmNode(node, depth = 0, root = false) {
  const color = node.color || "neutral";
  const children = node.children || [];
  return `<div class="mind-node ${root ? "root-node" : ""}" data-depth="${depth}">
    <div class="mind-card ${root ? "root" : color}">
      <input class="mind-input" data-algo-label="${escapeHtml(node.id)}" value="${escapeHtml(node.label)}" aria-label="Mind map node label" />
      <div class="mind-actions">
        <button class="small ghost" type="button" data-algo-add="${escapeHtml(node.id)}">+ child</button>
        ${root ? "" : `<button class="small danger" type="button" data-algo-delete="${escapeHtml(node.id)}">삭제</button>`}
      </div>
    </div>
    ${children.length ? `<div class="mind-children">${children.map(child => renderAlgorithmNode(child, depth + 1, false)).join("")}</div>` : ""}
  </div>`;
}

function renderReview() {
  const rvRange = document.querySelector("#rvRange");
  if (rvRange) rvRange.textContent = formatWeekRange(currentReviewWeekStart);
  document.querySelector("#rvPrev")?.addEventListener("click", () => {
    currentReviewWeekStart = toDateKey(addDays(fromDateKey(currentReviewWeekStart), -7));
    render();
  });
  document.querySelector("#rvNext")?.addEventListener("click", () => {
    currentReviewWeekStart = toDateKey(addDays(fromDateKey(currentReviewWeekStart), 7));
    render();
  });
  document.querySelector("#rvThis")?.addEventListener("click", () => {
    currentReviewWeekStart = toDateKey(startOfWeek(new Date()));
    render();
  });
  document.querySelector("#rvSnapshot")?.addEventListener("click", () => {
    openWeeklySnapshotModal(currentReviewWeekStart);
  });

  document.querySelector("#reviewForm").addEventListener("submit", event => {
    event.preventDefault();
    state.reviews.unshift({
      id: makeId("review"),
      createdAt: new Date().toISOString(),
      weekStart: currentReviewWeekStart,
      done: document.querySelector("#reviewDone").value.trim(),
      blocked: document.querySelector("#reviewBlocked").value.trim(),
      next: document.querySelector("#reviewNext").value.trim(),
      system: document.querySelector("#reviewSystem").value.trim(),
    });
    saveState();
    render();
  });

  document.querySelector("#reviewList").innerHTML = state.reviews.length ? state.reviews.map(review => `
    <article class="card">
      <div class="card-title"><h4>${escapeHtml(review.weekStart ? formatWeekRange(review.weekStart) : new Date(review.createdAt).toLocaleDateString("ko-KR"))}</h4><span class="chip">review</span></div>
      <p><strong>완료/진전</strong><br>${escapeHtml(review.done || "-")}</p>
      <p><strong>막힘/회피</strong><br>${escapeHtml(review.blocked || "-")}</p>
      <p><strong>다음 주 핵심 3개</strong><br>${escapeHtml(review.next || "-")}</p>
      <p><strong>시스템 수정점</strong><br>${escapeHtml(review.system || "-")}</p>
      <div class="actions"><button class="small danger" data-review-delete="${review.id}">삭제</button></div>
    </article>
  `).join("") : `<div class="empty">아직 저장된 리뷰가 없습니다.</div>`;

  document.querySelectorAll("[data-review-delete]").forEach(btn => btn.addEventListener("click", () => {
    state.reviews = state.reviews.filter(r => r.id !== btn.dataset.reviewDelete);
    saveState();
    render();
  }));
}

function setupImportExport() {
  document.querySelector("#themeToggle").addEventListener("click", toggleTheme);
  const sidebarToggle = document.querySelector("#sidebarToggle");
  if (sidebarToggle) sidebarToggle.addEventListener("click", toggleSidebar);
  const authOpenBtn = document.querySelector("#authOpenBtn");
  if (authOpenBtn) authOpenBtn.addEventListener("click", openAuthModal);
  const signOutBtn = document.querySelector("#signOutBtn");
  if (signOutBtn) signOutBtn.addEventListener("click", async () => {
    if (!supabaseClient) return;
    await pushStateToRemote();
    await supabaseClient.auth.signOut();
    currentUser = null;
    updateAuthUI();
  });
  const syncNowBtn = document.querySelector("#syncNowBtn");
  if (syncNowBtn) syncNowBtn.addEventListener("click", async () => {
    await pushStateToRemote();
    await loadStateFromRemote();
  });

  document.querySelector("#exportBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `productivity-os-export-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  });

  document.querySelector("#importFile").addEventListener("change", event => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        state = normalizeState(JSON.parse(reader.result));
        saveState();
        render();
      } catch (error) {
        alert("JSON을 읽지 못했습니다.");
      }
    };
    reader.readAsText(file);
  });
}

setupImportExport();
applyUrlRoute();
window.addEventListener("hashchange", () => {
  const id = (location.hash || "").replace(/^#\/?/, "").trim();
  if (pages.some(p => p.id === id) && id !== currentPage) setPage(id);
});
render();
initSupabaseAuth();
