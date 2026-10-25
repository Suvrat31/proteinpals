import { api, isDemo } from './api.js';
import { todayISO, addDays, weekStart, weekDays, fmtDay, fmtRange } from './dates.js';
import { summarizeDays, dayPercent, dayPoints, buildLeaderboard, WEEK_MAX } from './scoring.js';
import { buildFoodIndex, attachAutofill } from './autofill.js';
import {
  SLOTS, startReminders, getPrefs as reminderPrefs, setPrefs as setReminderPrefs,
  notificationPermission, requestBrowserNotifications,
} from './reminders.js';
import { shouldShowTour, openTour } from './tour.js';

const INVITE_KEY = 'proteinpals-invite';
const root = document.getElementById('app');

const state = {
  session: null,
  profile: null,
  group: null,
  members: [],
  tab: 'today',
  authMode: 'signin',
  authNotice: null,
  date: todayISO(),            // day shown on the Today tab
  week: weekStart(todayISO()), // week shown on the Leaderboard tab
  myWeekLogs: [],              // my logs for the week containing `date`
  myWeekWater: new Map(),      // date → ml for the week containing `date`
  boardLogs: [],               // everyone's logs for `week`
  foodHistory: [],             // my named entries, newest first (for autofill)
  foodIndex: [],
  showMacros: false,
};

// ─── Helpers ────────────────────────────────────────────────────────────────

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const grams = (n) => `${Math.round(n * 10) / 10}g`;
const kcal = (n) => `${Math.round(n).toLocaleString()} kcal`;
const litres = (ml) => `${(ml / 1000).toFixed(ml % 1000 === 0 ? 0 : ml % 100 === 0 ? 1 : 2)} L`;
const ounces = (ml) => `${Math.round(ml / 29.574)} oz`;

const isAdmin = () => state.profile?.role === 'admin';

const LOGO = `<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="12" fill="none" stroke="var(--track)" stroke-width="5"/><circle cx="16" cy="16" r="12" fill="none" stroke="var(--accent)" stroke-width="5" stroke-linecap="round" stroke-dasharray="56 100" transform="rotate(-90 16 16)"/></svg>`;

const AVATAR_COLORS = ['#16a34a', '#2563eb', '#9333ea', '#db2777', '#ea580c', '#0891b2', '#65a30d', '#c026d3'];
const avatarColor = (id) => AVATAR_COLORS[[...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % AVATAR_COLORS.length];

let toastTimer;
function toast(message, kind = 'info') {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ''), 2800);
}

// The reminder "nudge": a small card at the bottom that hides itself after a while.
let nudgeTimer;
function showNudge({ title, body }) {
  const el = document.getElementById('nudge');
  el.innerHTML = `
    <div><strong></strong><p></p></div>
    <div class="row">
      <button class="btn primary" data-nudge="log">Log food</button>
      <button class="icon-btn" data-nudge="close" aria-label="Dismiss">×</button>
    </div>`;
  el.querySelector('strong').textContent = title;
  el.querySelector('p').textContent = body;
  el.hidden = false;
  clearTimeout(nudgeTimer);
  nudgeTimer = setTimeout(hideNudge, 15000);
}

function hideNudge() {
  document.getElementById('nudge').hidden = true;
}

document.getElementById('nudge').addEventListener('click', (e) => {
  const action = e.target.closest('[data-nudge]')?.dataset.nudge;
  if (!action) return;
  hideNudge();
  if (action === 'log') {
    state.tab = 'today';
    setDate(todayISO()).then(() => document.getElementById('food')?.focus());
  }
});

function captureInvite() {
  const params = new URLSearchParams(location.search);
  const code = params.get('invite');
  if (!code) return;
  localStorage.setItem(INVITE_KEY, JSON.stringify({ code: code.toUpperCase(), from: params.get('from') }));
  history.replaceState(null, '', location.pathname);
  state.authMode = 'signup';
}

function pendingInvite() {
  try { return JSON.parse(localStorage.getItem(INVITE_KEY)); } catch { return null; }
}

const inviteLink = () =>
  `${location.origin}${location.pathname}?invite=${state.group.invite_code}&from=${state.session.userId}`;

// ─── Data loading ───────────────────────────────────────────────────────────

async function loadUser() {
  state.session = await api.getSession();
  if (!state.session) {
    state.profile = state.group = null;
    return render();
  }
  state.profile = await api.getMyProfile(state.session.userId);
  await acceptPendingInvite();
  if (state.profile.group_id) await loadGroup();
  render();
  if (state.group) afterGroupLoaded();
}

async function acceptPendingInvite() {
  const invite = pendingInvite();
  if (!invite) return;
  localStorage.removeItem(INVITE_KEY);
  if (state.profile.group_id) {
    const current = await api.getGroup(state.profile.group_id);
    if (current?.invite_code === invite.code) return;
    if (!confirm(`You opened an invite to a different group. Leave "${current?.name}" and join the new one?`)) return;
  }
  try {
    const group = await api.joinGroup(invite.code, invite.from);
    state.profile = await api.getMyProfile(state.session.userId);
    toast(`You joined ${group.name}!`);
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function loadGroup() {
  const [group, members] = await Promise.all([
    api.getGroup(state.profile.group_id),
    api.getMembers(state.profile.group_id),
  ]);
  state.group = group;
  state.members = members;
  await Promise.all([loadMyLogs(), loadBoard(), loadFoodHistory()]);
}

async function loadMyLogs() {
  const from = weekStart(state.date);
  const to = addDays(from, 6);
  const [logs, water] = await Promise.all([
    api.getLogs({ from, to, userId: state.session.userId }),
    state.profile.water_enabled ? api.getWater({ from, to }) : [],
  ]);
  state.myWeekLogs = logs;
  state.myWeekWater = new Map(water.map((w) => [w.log_date, w.ml]));
}

async function loadBoard() {
  state.boardLogs = await api.getLogs({ from: state.week, to: addDays(state.week, 6) });
}

async function loadFoodHistory() {
  state.foodHistory = await api.getFoodHistory(state.session.userId);
  state.foodIndex = buildFoodIndex(state.foodHistory);
}

async function refreshMembers() {
  state.profile = await api.getMyProfile(state.session.userId);
  if (!state.profile.group_id) return loadUser(); // we were removed from the group
  state.members = await api.getMembers(state.group.id);
  await loadBoard();
}

function showTour(onClose) {
  openTour({
    userId: state.session.userId,
    isAdmin: isAdmin(),
    waterEnabled: state.profile.water_enabled,
    handlers: {
      enableWater: () => run(() => setWaterEnabled(true)),
      chooseReminders: (choice) => run(() => chooseReminders(choice)),
    },
    onClose,
  });
}

// Runs once the main app is on screen: the v2 tour, then time-of-day reminders
// (held back until the tour is closed so the two never appear together).
function afterGroupLoaded() {
  if (shouldShowTour(state.session.userId)) showTour(beginReminders);
  else beginReminders();
}

function beginReminders() {
  startReminders({
    showInApp: showNudge,
    async getStatus() {
      if (!state.session || !state.profile?.group_id) return null;
      const today = todayISO();
      const logs = await api.getLogs({ from: today, to: today, userId: state.session.userId });
      const day = summarizeDays(logs).get(today);
      return { protein: day?.protein || 0, goal: day?.goal || state.profile.daily_goal, entries: logs.length };
    },
  });
}

async function setWaterEnabled(enabled) {
  await api.updateProfile(state.session.userId, { water_enabled: enabled });
  state.profile = await api.getMyProfile(state.session.userId);
  await loadMyLogs();
  render();
  toast(enabled ? 'Water tracking is on. Find it on your Today page.' : 'Water tracking is off');
}

async function chooseReminders(choice) {
  if (choice === 'off') {
    setReminderPrefs({ enabled: false });
    toast('Reminders are off. You can turn them on in the Group tab.');
  } else if (choice === 'browser') {
    const result = await requestBrowserNotifications();
    toast(result === 'granted' ? 'Browser notifications are on' : 'No problem, reminders will show in the app');
  } else {
    setReminderPrefs({ enabled: true, browser: false });
  }
  render();
}

// ─── Views ──────────────────────────────────────────────────────────────────

function render() {
  if (!state.session) {
    root.innerHTML = authView();
  } else if (!state.profile.group_id) {
    root.innerHTML = shell(onboardingView(), false);
  } else {
    const view = { today: todayView, board: boardView, group: groupView }[state.tab];
    root.innerHTML = shell(view(), true);
    enhance();
  }
}

// Re-render without losing anything half-typed into the log form, e.g. when the
// app refreshes after you switch back to it, or when you tap a water button.
function renderKeepingDraft() {
  const form = document.querySelector('form[data-form="add-log"]');
  const draft = form ? Object.fromEntries(new FormData(form)) : null;
  const focused = form?.contains(document.activeElement) ? document.activeElement.name : null;
  render();
  const next = document.querySelector('form[data-form="add-log"]');
  if (!draft || !next) return;
  for (const [name, value] of Object.entries(draft)) {
    if (next.elements[name]) next.elements[name].value = value;
  }
  if (focused) next.elements[focused]?.focus();
}

// Wires up behaviour that plain HTML can't express (re-done after every render).
function enhance() {
  const food = document.getElementById('food');
  if (!food) return;
  attachAutofill(food, {
    getIndex: () => state.foodIndex,
    onPick(item) {
      const form = food.form;
      for (const field of ['protein', 'calories', 'carbs', 'fat']) {
        form.elements[field].value = item[field] ?? '';
      }
      if (item.carbs != null || item.fat != null) form.querySelector('details').open = state.showMacros = true;
      const hint = document.getElementById('fill-hint');
      hint.textContent = `Filled from your last “${item.name}”. Adjust if your portion was different.`;
      hint.hidden = false;
      form.elements.protein.focus();
      form.elements.protein.select();
    },
  });
}

function shell(content, withTabs) {
  const tab = (id, label) =>
    `<button data-action="tab" data-tab="${id}" ${state.tab === id ? 'aria-current="page"' : ''}>${label}</button>`;
  return `
    <header class="top">
      <div class="wrap">
        <div class="bar">
          <div class="brand">${LOGO} ProteinPals</div>
          <div class="row">
            ${isDemo ? '<span class="badge demo" title="Data is stored in this browser only">Demo</span>' : ''}
            ${state.group ? `<span class="badge">${esc(state.group.name)}</span>` : ''}
          </div>
        </div>
        ${withTabs ? `<nav class="tabs">${tab('today', 'Today')}${tab('board', 'Leaderboard')}${tab('group', 'Group')}</nav>` : ''}
      </div>
    </header>
    <div class="wrap"><main>${content}</main></div>`;
}

function authView() {
  const signup = state.authMode === 'signup';
  const invite = pendingInvite();
  return `
    <div class="auth">
      <div class="brand">${LOGO} ProteinPals</div>
      <p class="tagline">A weekly protein challenge with your friends.</p>
      ${invite ? `<div class="notice">You've been invited to a group! ${signup ? 'Create an account' : 'Sign in'} to join.</div>` : ''}
      ${isDemo ? '<div class="notice warn">Demo mode: data is saved in this browser only.</div>' : ''}
      ${state.authNotice ? `<div class="notice">${esc(state.authNotice)}</div>` : ''}
      <div class="card">
        <div class="seg" style="margin-bottom:14px">
          <button data-action="auth-mode" data-mode="signin" aria-pressed="${!signup}">Sign in</button>
          <button data-action="auth-mode" data-mode="signup" aria-pressed="${signup}">Create account</button>
        </div>
        <form class="stack" data-form="${signup ? 'signup' : 'signin'}">
          ${signup ? `
            <label>Your name<input type="text" name="displayName" required maxlength="40" autocomplete="nickname" placeholder="e.g. Alex"></label>
            <label>Daily protein goal (g)<input type="number" name="dailyGoal" required min="20" max="500" step="1" value="120" inputmode="numeric"></label>` : ''}
          <label>Email<input type="email" name="email" required autocomplete="email"></label>
          <label>Password<input type="password" name="password" required minlength="6" autocomplete="${signup ? 'new-password' : 'current-password'}"></label>
          <button class="btn primary block" type="submit">${signup ? 'Create account' : 'Sign in'}</button>
        </form>
      </div>
    </div>`;
}

function onboardingView() {
  const name = esc(state.profile.display_name);
  return `
    <section class="card">
      <h2>Welcome, ${name}!</h2>
      <p class="muted" style="margin:0">Start a group and invite your friends, or join one with an invite code.</p>
    </section>
    <section class="card">
      <h2>Start a group</h2>
      <form class="row" data-form="create-group">
        <input type="text" name="name" required maxlength="60" placeholder="e.g. Gym Bros">
        <button class="btn primary" type="submit">Create</button>
      </form>
      ${isDemo ? '<p class="muted small" style="margin:10px 0 0">In demo mode a few pretend friends are added so you can see the leaderboard.</p>' : ''}
    </section>
    <section class="card">
      <h2>Join with a code</h2>
      <form class="row" data-form="join-group">
        <input type="text" name="code" required maxlength="6" placeholder="ABC123" class="code" style="text-transform:uppercase">
        <button class="btn" type="submit">Join</button>
      </form>
    </section>
    <button class="btn block" data-action="sign-out">Sign out</button>`;
}

function ring(pct) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.min(pct, 100) / 100);
  return `<svg class="ring" viewBox="0 0 120 120" aria-hidden="true">
    <circle class="track" cx="60" cy="60" r="${r}"/>
    <circle class="fill ${pct >= 100 ? 'done' : ''}" cx="60" cy="60" r="${r}"
      stroke-dasharray="${c}" stroke-dashoffset="${offset}" transform="rotate(-90 60 60)"/>
  </svg>`;
}

function waterCard() {
  const ml = state.myWeekWater.get(state.date) || 0;
  const goal = state.profile.water_goal_ml;
  const pct = Math.min((ml / goal) * 100, 100);
  return `
    <section class="card water">
      <div class="spread">
        <h2>Water <small>· only you see this</small></h2>
        <span class="water-total"><strong>${litres(ml)}</strong> <span class="muted">/ ${litres(goal)}</span></span>
      </div>
      <div class="water-bar ${ml >= goal ? 'done' : ''}" role="progressbar" aria-label="Water today"
        aria-valuemin="0" aria-valuemax="${goal}" aria-valuenow="${ml}"><i style="width:${pct}%"></i></div>
      <div class="water-btns">
        <button class="btn" data-action="water" data-ml="250">+ Glass <small>250 ml</small></button>
        <button class="btn" data-action="water" data-ml="500">+ Bottle <small>500 ml</small></button>
        <button class="btn" data-action="water" data-ml="-250" ${ml ? '' : 'disabled'} aria-label="Remove 250 ml" title="Remove 250 ml">−</button>
      </div>
      <p class="muted small" style="margin:8px 0 0">${ounces(ml)} of ${ounces(goal)}</p>
    </section>`;
}

function todayView() {
  const today = todayISO();
  const days = summarizeDays(state.myWeekLogs);
  const day = days.get(state.date);
  const goal = day?.goal || state.profile.daily_goal;
  const protein = day?.protein || 0;
  const pct = dayPercent(protein, goal);
  const remaining = Math.max(goal - protein, 0);
  const isToday = state.date === today;

  const strip = weekDays(weekStart(state.date)).map((date) => {
    const d = days.get(date);
    const p = d ? dayPercent(d.protein, d.goal) : 0;
    return `<button data-action="pick-day" data-date="${date}" ${date === state.date ? 'aria-current="date"' : ''} ${date > today ? 'disabled' : ''}>
      <span>${fmtDay(date, { weekday: 'narrow' })}</span>
      <span class="bar-col ${p >= 100 ? 'hit' : ''}"><i style="height:${Math.min(p, 100)}%"></i></span>
      <span class="pct">${date > today ? '' : `${Math.round(p)}%`}</span>
    </button>`;
  }).join('');

  const entries = (day?.entries || []).slice().reverse().map((e) => `
    <li>
      <span class="grams">${grams(Number(e.protein))}</span>
      <div class="what">
        <div>${esc(e.food) || '<span class="muted">Quick add</span>'}</div>
        <div class="muted small">${[
          e.calories != null ? kcal(Number(e.calories)) : '',
          e.carbs != null ? `${grams(Number(e.carbs))} carbs` : '',
          e.fat != null ? `${grams(Number(e.fat))} fat` : '',
          new Date(e.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
        ].filter(Boolean).join(' · ')}</div>
      </div>
      <button class="icon-btn" data-action="delete-log" data-id="${e.id}" aria-label="Delete entry" title="Delete">×</button>
    </li>`).join('');

  return `
    <section class="card">
      <div class="day-nav">
        <button class="icon-btn" data-action="day" data-step="-1" aria-label="Previous day">‹</button>
        <div class="title">
          <strong>${isToday ? 'Today' : state.date === addDays(today, -1) ? 'Yesterday' : fmtDay(state.date, { weekday: 'long' })}</strong>
          <span>${fmtDay(state.date, { month: 'long', day: 'numeric' })}${isToday ? '' : ' · <a href="#" data-action="go-today">back to today</a>'}</span>
        </div>
        <button class="icon-btn" data-action="day" data-step="1" aria-label="Next day" ${isToday ? 'disabled' : ''}>›</button>
      </div>
      <div class="progress">
        <div class="ring-wrap">
          ${ring(pct)}
          <div class="ring-label"><strong>${Math.round(pct)}%</strong><span>${grams(protein)} / ${goal}g</span></div>
        </div>
        <div class="stats">
          <div class="stat"><div class="k">${pct >= 100 ? 'Goal hit' : 'To go'}</div><div class="v">${pct >= 100 ? '✓ Nice work' : grams(remaining)}</div></div>
          <div class="stat"><div class="k">Points</div><div class="v">${dayPoints(protein, goal)} <small>/ 100</small></div></div>
          <div class="macros">
            <span><b>${Math.round(day?.calories || 0).toLocaleString()}</b> kcal</span>
            <span>Carbs <b>${grams(day?.carbs || 0)}</b></span>
            <span>Fat <b>${grams(day?.fat || 0)}</b></span>
          </div>
        </div>
      </div>
    </section>

    <section class="card add-form">
      <h2>Log food</h2>
      <form class="stack" data-form="add-log">
        <label class="combo">Food<input type="text" name="food" id="food" maxlength="80" placeholder="Start typing, e.g. Greek yogurt"></label>
        <div class="grid-2">
          <label>Protein (g)<input type="number" name="protein" required min="0" max="500" step="0.1" inputmode="decimal"></label>
          <label>Calories<input type="number" name="calories" min="0" max="10000" step="1" inputmode="numeric" placeholder="optional"></label>
        </div>
        <details ${state.showMacros ? 'open' : ''} data-action="toggle-macros">
          <summary>Carbs &amp; fat (optional)</summary>
          <div class="grid-2">
            <label>Carbs (g)<input type="number" name="carbs" min="0" max="2000" step="0.1" inputmode="decimal"></label>
            <label>Fat (g)<input type="number" name="fat" min="0" max="1000" step="0.1" inputmode="decimal"></label>
          </div>
        </details>
        <p id="fill-hint" class="fill-hint" hidden></p>
        <button class="btn primary" type="submit">Add${isToday ? '' : ` to ${fmtDay(state.date, { weekday: 'short' })}`}</button>
      </form>
    </section>

    ${state.profile.water_enabled ? waterCard() : ''}

    <section class="card">
      <h2>This week</h2>
      <div class="week-strip">${strip}</div>
    </section>

    <section class="card">
      <h2>Entries <small>· ${day?.entries.length || 0}</small></h2>
      ${entries ? `<ul class="entries">${entries}</ul>` : '<p class="empty">Nothing logged yet.</p>'}
    </section>`;
}

function boardView() {
  const today = todayISO();
  const days = weekDays(state.week);
  const rows = buildLeaderboard(state.members, state.boardLogs, days, today);
  const isCurrent = state.week === weekStart(today);
  const isFuture = state.week > weekStart(today);
  const daysLeft = 7 - days.indexOf(today);
  const me = state.session.userId;

  const dotClass = (d) => d.future ? 'future' : d.hit ? 'hit' : d.percent >= 60 ? 'mid' : d.protein > 0 ? 'low' : '';
  const winner = !isCurrent && !isFuture && rows[0]?.points > 0 ? rows[0] : null;

  const list = rows.map((r) => `
    <li class="${r.member.id === me ? 'me' : ''}">
      <span class="rank ${r.rank <= 3 && r.points > 0 ? `r${r.rank}` : ''}">${r.rank}</span>
      <div class="who">
        <strong>${esc(r.member.display_name)}${r.member.id === me ? ' (you)' : ''}</strong>
        <span>Goal ${r.member.daily_goal}g · ${r.daysHit}/7 days hit</span>
      </div>
      <div class="score"><strong>${r.points}</strong><span>/ ${WEEK_MAX} pts</span></div>
      <div class="dots">${r.daily.map((d) => `
        <span class="dot ${dotClass(d)}" title="${fmtDay(d.date)}: ${grams(d.protein)} of ${d.goal}g (${Math.round(d.percent)}%)">${d.future ? '' : Math.round(d.percent)}</span>`).join('')}
      </div>
    </li>`).join('');

  return `
    <section class="card">
      <div class="week-nav">
        <button class="icon-btn" data-action="week" data-step="-7" aria-label="Previous week">‹</button>
        <div class="title">
          <strong>${isCurrent ? 'This week' : fmtRange(state.week)}</strong>
          <span>${isCurrent ? `${fmtRange(state.week)} · ${daysLeft} day${daysLeft === 1 ? '' : 's'} left` : isFuture ? 'Not started' : 'Final results'}</span>
        </div>
        <button class="icon-btn" data-action="week" data-step="7" aria-label="Next week" ${isCurrent ? 'disabled' : ''}>›</button>
      </div>
      ${!isCurrent ? '<p class="small" style="text-align:center;margin:0 0 8px"><a href="#" data-action="this-week">Jump to this week</a></p>' : ''}
      ${winner ? `<div class="winner"><span class="trophy">🏆</span><div><strong>${esc(winner.member.display_name)}</strong> won with ${winner.points} pts</div></div>` : ''}
      <div class="day-heads"><span></span><div>${days.map((d) => `<span>${fmtDay(d, { weekday: 'narrow' })}</span>`).join('')}</div></div>
      <ol class="board">${list}</ol>
      <div class="spread" style="margin-top:12px">
        <span class="muted small">Numbers are % of each person's goal.</span>
        <button class="btn" data-action="refresh">Refresh</button>
      </div>
    </section>
    <section class="card rules">
      <strong>How scoring works</strong>
      <ul>
        <li>Each day you earn up to <b>100 points</b>: the % of your own goal you hit. 130g of a 130g goal = 80g of an 80g goal = 100.</li>
        <li>Going over 100% doesn't earn extra, so consistency beats one huge day.</li>
        <li>A week is worth up to ${WEEK_MAX}. Ties go to whoever hit their goal on more days.</li>
        <li>The leaderboard resets every Monday. Past weeks stay here as history.</li>
      </ul>
    </section>`;
}

function remindersSettings() {
  const prefs = reminderPrefs();
  const permission = notificationPermission();
  const browserRow = {
    unsupported: '<p class="muted small">This browser doesn’t support notifications, so reminders show inside the app.</p>',
    denied: '<p class="muted small">Browser notifications are blocked for this site. Reminders will show inside the app.</p>',
    default: `<button class="btn" data-action="allow-notifications" ${prefs.enabled ? '' : 'disabled'}>Also allow browser notifications</button>`,
    granted: `<label class="check"><input type="checkbox" data-change="browser-notifications" ${prefs.browser ? 'checked' : ''} ${prefs.enabled ? '' : 'disabled'}>
      <span>Use browser notifications when ProteinPals is in a background tab</span></label>`,
  }[permission];
  return `
    <label class="check"><input type="checkbox" data-change="reminders" ${prefs.enabled ? 'checked' : ''}>
      <span>Remind me at ${SLOTS.map((s) => s.label).join(' and ')} if I’m behind on protein</span></label>
    ${browserRow}
    <p class="muted small" style="margin:0">Reminders show while ProteinPals is open (or the next time you open it), at most once each time, and never after you’ve hit your goal. This setting is saved on this device.</p>`;
}

function groupView() {
  const me = state.session.userId;
  const admin = isAdmin();
  const byId = new Map(state.members.map((m) => [m.id, m]));
  const joined = (m) => m.joined_at || m.created_at;
  const members = state.members.slice().sort((a, b) => joined(a).localeCompare(joined(b))).map((m) => {
    const inviter = byId.get(m.invited_by);
    const how = m.id === state.group.created_by ? 'Started the group'
      : inviter ? `Invited by ${inviter.id === me ? 'you' : esc(inviter.display_name)}` : 'Joined with a code';
    return `<li>
      <div class="row" style="min-width:0">
        <span class="avatar" style="background:${avatarColor(m.id)}">${esc(m.display_name.slice(0, 1).toUpperCase())}</span>
        <div style="min-width:0">
          <div><strong>${esc(m.display_name)}</strong>${m.id === me ? ' <span class="muted">(you)</span>' : ''}${m.role === 'admin' ? ' <span class="role-pill">Admin</span>' : ''}</div>
          <div class="muted small">${how} · ${m.daily_goal}g/day</div>
        </div>
      </div>
      ${admin && m.id !== me ? `<button class="btn small-btn danger" data-action="remove-member" data-id="${m.id}">Remove</button>` : ''}
    </li>`;
  }).join('');
  const invitedByMe = state.members.filter((m) => m.invited_by === me).length;
  const admins = state.members.filter((m) => m.role === 'admin').map((m) => (m.id === me ? 'you' : esc(m.display_name)));

  return `
    <section class="card">
      <h2>Invite friends</h2>
      <p class="muted small" style="margin:0 0 10px">Send this link. Friends who sign up with it join <b>${esc(state.group.name)}</b> automatically.</p>
      <div class="invite-box">
        <input type="text" readonly value="${esc(inviteLink())}" aria-label="Invite link" onfocus="this.select()">
        <button class="btn primary" data-action="copy-invite">Copy</button>
      </div>
      <div class="spread" style="margin-top:10px">
        <p class="muted small" style="margin:0">Or share the code <span class="code">${esc(state.group.invite_code)}</span> · You've invited ${invitedByMe} friend${invitedByMe === 1 ? '' : 's'}</p>
        ${admin ? '<button class="btn small-btn" data-action="new-code">New code</button>' : ''}
      </div>
      ${isDemo ? '<p class="notice warn small" style="margin:10px 0 0">Demo mode: invite links only work in this browser. Connect Supabase to play with real friends.</p>' : ''}
    </section>
    <section class="card">
      <h2>Members <small>· ${state.members.length}</small></h2>
      <ul class="members">${members}</ul>
      <p class="muted small" style="margin:10px 0 0">${admin
        ? 'You’re the admin: you can remove members. Removed members drop off the leaderboard; their own food log is kept.'
        : `Admin: ${admins.join(', ') || 'none'}. The admin can remove members and change the invite code.`}</p>
    </section>
    <section class="card">
      <h2>Your settings</h2>
      <form class="stack" data-form="profile">
        <div class="grid-2">
          <label>Name<input type="text" name="display_name" required maxlength="40" value="${esc(state.profile.display_name)}"></label>
          <label>Daily goal (g)<input type="number" name="daily_goal" required min="20" max="500" step="1" value="${state.profile.daily_goal}"></label>
        </div>
        <p class="muted small" style="margin:0">A new goal applies to food you log from now on. Earlier days keep the goal they had.</p>
        <button class="btn primary" type="submit">Save</button>
      </form>
    </section>
    <section class="card stack">
      <h2 style="margin:0">Water tracking</h2>
      <label class="check"><input type="checkbox" data-change="water" ${state.profile.water_enabled ? 'checked' : ''}>
        <span>Show a private water tracker on my Today page</span></label>
      ${state.profile.water_enabled ? `
        <form class="row" data-form="water-goal">
          <label style="flex:1">Daily water goal (ml)<input type="number" name="water_goal_ml" required min="250" max="10000" step="50" value="${state.profile.water_goal_ml}"></label>
          <button class="btn" type="submit" style="align-self:flex-end">Save</button>
        </form>` : ''}
    </section>
    <section class="card stack">
      <h2 style="margin:0">Reminders</h2>
      ${remindersSettings()}
    </section>
    <div class="grid-2">
      <button class="btn danger" data-action="leave-group">Leave group</button>
      <button class="btn" data-action="sign-out">Sign out</button>
    </div>
    <p class="small" style="text-align:center;margin:0"><a href="#" data-action="whats-new">What’s new in v2</a></p>`;
}

// ─── Actions ────────────────────────────────────────────────────────────────

const actions = {
  'auth-mode': (el) => { state.authMode = el.dataset.mode; state.authNotice = null; render(); },

  tab: async (el) => {
    state.tab = el.dataset.tab;
    render();
    if (state.tab === 'board') { await loadBoard(); render(); }
    if (state.tab === 'group') { await refreshMembers(); render(); }
  },

  day: async (el) => setDate(addDays(state.date, Number(el.dataset.step))),
  'pick-day': async (el) => setDate(el.dataset.date),
  'go-today': async () => setDate(todayISO()),

  week: async (el) => { state.week = addDays(state.week, Number(el.dataset.step)); await loadBoard(); render(); },
  'this-week': async () => { state.week = weekStart(todayISO()); await loadBoard(); render(); },
  refresh: async () => {
    await refreshMembers();
    render();
    toast('Leaderboard updated');
  },

  'delete-log': async (el) => {
    await api.deleteLog(el.dataset.id);
    await Promise.all([loadMyLogs(), loadBoard(), loadFoodHistory()]);
    render();
  },

  'toggle-macros': (el) => { state.showMacros = !el.open; },

  water: async (el) => {
    const total = await api.addWater(state.date, Number(el.dataset.ml));
    state.myWeekWater.set(state.date, total);
    renderKeepingDraft();
    if (total >= state.profile.water_goal_ml && total - Number(el.dataset.ml) < state.profile.water_goal_ml) {
      toast('Water goal reached 💧');
    }
  },

  'copy-invite': async () => {
    try {
      await navigator.clipboard.writeText(inviteLink());
      toast('Invite link copied');
    } catch {
      toast('Copy the link from the box above');
    }
  },

  'new-code': async () => {
    if (!confirm('Make a new invite code? The old link and code will stop working. Current members stay in the group.')) return;
    state.group.invite_code = await api.regenerateInviteCode();
    render();
    toast('New invite code ready');
  },

  'remove-member': async (el) => {
    const member = state.members.find((m) => m.id === el.dataset.id);
    if (!member) return;
    if (!confirm(`Remove ${member.display_name} from ${state.group.name}?\n\nThey'll drop off the leaderboard. Their own food log is kept, and they can rejoin only with an invite.`)) return;
    await api.removeMember(member.id);
    await refreshMembers();
    render();
    toast(`Removed ${member.display_name}. Tip: make a new invite code so the old link stops working.`);
  },

  'allow-notifications': async () => chooseReminders('browser'),

  'whats-new': () => showTour(),

  'leave-group': async () => {
    const others = state.members.filter((m) => m.id !== state.session.userId);
    const successor = isAdmin() && !others.some((m) => m.role === 'admin')
      ? others.slice().sort((a, b) => (a.joined_at || a.created_at).localeCompare(b.joined_at || b.created_at))[0]
      : null;
    const note = successor ? ` ${successor.display_name} will become the admin.` : '';
    if (!confirm(`Leave ${state.group.name}? Your logs are kept, and you can rejoin with the code.${note}`)) return;
    await api.leaveGroup();
    state.group = null;
    state.tab = 'today';
    await loadUser();
  },

  'sign-out': async () => {
    await api.signOut();
    hideNudge();
    Object.assign(state, { tab: 'today', authMode: 'signin', authNotice: null, date: todayISO(), week: weekStart(todayISO()) });
    await loadUser();
  },
};

// Checkbox toggles in settings.
const changes = {
  water: (el) => setWaterEnabled(el.checked),
  reminders: (el) => {
    setReminderPrefs({ enabled: el.checked });
    render();
    toast(el.checked ? 'Reminders are on' : 'Reminders are off');
  },
  'browser-notifications': (el) => {
    setReminderPrefs({ browser: el.checked });
    toast(el.checked ? 'Browser notifications are on' : 'Reminders will show inside the app');
  },
};

async function setDate(date) {
  const reload = weekStart(date) !== weekStart(state.date);
  state.date = date > todayISO() ? todayISO() : date;
  if (reload) await loadMyLogs();
  render();
}

const num = (v) => (v === '' || v == null ? null : Number(v));

const forms = {
  async signin(data) {
    await api.signIn(data);
    await loadUser();
  },

  async signup(data) {
    const { needsConfirmation } = await api.signUp({ ...data, dailyGoal: Number(data.dailyGoal) });
    if (needsConfirmation) {
      state.authMode = 'signin';
      state.authNotice = 'Check your email to confirm your account, then sign in.';
      return render();
    }
    await loadUser();
  },

  async 'create-group'(data) {
    const group = await api.createGroup(data.name);
    state.profile = await api.getMyProfile(state.session.userId);
    await loadGroup();
    state.tab = 'group';
    render();
    afterGroupLoaded();
    toast(`${group.name} created. Invite your friends!`);
  },

  async 'join-group'(data) {
    const group = await api.joinGroup(data.code);
    state.profile = await api.getMyProfile(state.session.userId);
    await loadGroup();
    state.tab = 'board';
    render();
    afterGroupLoaded();
    toast(`You joined ${group.name}!`);
  },

  async 'add-log'(data) {
    const before = summarizeDays(state.myWeekLogs).get(state.date);
    const log = await api.addLog({
      log_date: state.date,
      food: data.food.trim() || null,
      protein: Number(data.protein),
      carbs: num(data.carbs),
      fat: num(data.fat),
      calories: num(data.calories),
    });
    if (log.food) {
      state.foodHistory.unshift(log);
      state.foodIndex = buildFoodIndex(state.foodHistory);
    }
    await Promise.all([loadMyLogs(), loadBoard()]);
    render();
    document.getElementById('food')?.focus();

    // How much is left, so you don't have to look for it.
    const after = summarizeDays(state.myWeekLogs).get(state.date);
    const wasHit = before && before.protein >= before.goal;
    if (after.protein >= after.goal) {
      toast(wasHit ? `Logged ${grams(log.protein)}` : 'Goal hit! 100% for the day 🎉');
    } else {
      toast(`Logged ${grams(log.protein)} · ${grams(after.goal - after.protein)} to go`);
    }
  },

  async profile(data) {
    await api.updateProfile(state.session.userId, {
      display_name: data.display_name.trim(),
      daily_goal: Number(data.daily_goal),
    });
    await refreshMembers();
    render();
    toast('Saved');
  },

  async 'water-goal'(data) {
    await api.updateProfile(state.session.userId, { water_goal_ml: Number(data.water_goal_ml) });
    state.profile = await api.getMyProfile(state.session.userId);
    render();
    toast('Water goal saved');
  },
};

async function run(fn) {
  try {
    await fn();
  } catch (err) {
    console.error(err);
    toast(err.message, 'error');
  }
}

root.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const action = actions[el.dataset.action];
  if (!action) return;
  if (el.tagName === 'A') e.preventDefault();
  if (el.tagName === 'DETAILS') return action(el); // let the toggle happen
  await run(() => action(el));
});

root.addEventListener('change', (e) => {
  const handler = changes[e.target.dataset.change];
  if (handler) run(() => handler(e.target));
});

root.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const handler = forms[form.dataset.form];
  if (!handler) return;
  const buttons = form.querySelectorAll('button');
  buttons.forEach((b) => (b.disabled = true));
  try {
    await handler(Object.fromEntries(new FormData(form)));
  } catch (err) {
    console.error(err);
    toast(err.message, 'error');
    buttons.forEach((b) => (b.disabled = false));
  }
});

// Roll over to the new day/week if the tab is left open past midnight.
let lastSeenDay = todayISO();
document.addEventListener('visibilitychange', async () => {
  if (document.hidden || !state.group) return;
  const today = todayISO();
  if (today !== lastSeenDay) {
    if (state.date === lastSeenDay) state.date = today;
    if (state.week === weekStart(lastSeenDay)) state.week = weekStart(today);
    lastSeenDay = today;
  }
  await run(async () => {
    await Promise.all([loadMyLogs(), loadBoard()]);
    renderKeepingDraft();
  });
});

captureInvite();
loadUser().catch((err) => {
  console.error(err);
  root.innerHTML = `<div class="auth"><div class="card"><h2>Couldn't load ProteinPals</h2><p class="muted">${esc(err.message)}</p></div></div>`;
});
