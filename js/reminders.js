// Gentle, time-of-day reminders. Rules that keep them from being annoying:
// - at most one per slot (2 PM, 8 PM) per day, per device
// - nothing at all once today's goal is hit
// - if the app is opened late, only the most recent missed slot shows (never a pile-up)
// - shown in-app by default; a browser notification only if the user opted in and
//   the tab is in the background
// Browsers can't fire these with the app fully closed (that needs a push server),
// so a reminder that came due while closed shows the next time the app is opened.
import { todayISO } from './dates.js';

const PREFS_KEY = 'proteinpals-reminders';
const SHOWN_KEY = 'proteinpals-reminders-shown';

export const SLOTS = [
  { id: 'afternoon', hour: 14, label: '2 PM' },
  { id: 'evening', hour: 20, label: '8 PM' },
];

function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}

function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

export const getPrefs = () => ({ enabled: true, browser: false, ...load(PREFS_KEY, {}) });
export const setPrefs = (patch) => save(PREFS_KEY, { ...getPrefs(), ...patch });

export const notificationPermission = () => ('Notification' in window ? Notification.permission : 'unsupported');

// Must be called straight from a click handler (browsers require a user gesture).
export async function requestBrowserNotifications() {
  if (!('Notification' in window)) return 'unsupported';
  const result = await Notification.requestPermission();
  setPrefs({ browser: result === 'granted', enabled: true });
  return result;
}

export function reminderMessage(slot, { protein, goal, entries }) {
  if (protein >= goal) return null;
  const left = Math.ceil(goal - protein);
  const pct = Math.round((protein / goal) * 100);
  if (!entries) {
    return slot.id === 'afternoon'
      ? { title: 'Nothing logged yet today', body: `Add what you've eaten so far. Today's goal is ${goal}g.` }
      : { title: 'Log today before it ends', body: `Nothing logged yet. Today's goal is ${goal}g of protein.` };
  }
  return slot.id === 'afternoon'
    ? { title: `${left}g of protein to go`, body: `You're at ${pct}% of today's goal. Plenty of day left.` }
    : { title: `${left}g left to hit today's goal`, body: `You're at ${pct}%. A protein-rich dinner or snack would close the gap.` };
}

let started = false;
let timer;

// getStatus(): resolves to today's { protein, goal, entries } or null when signed out.
// showInApp(message): displays the in-app nudge.
export function startReminders({ getStatus, showInApp }) {
  if (started) return;
  started = true;

  async function check() {
    scheduleNext();
    const prefs = getPrefs();
    if (!prefs.enabled) return;

    const now = new Date();
    const today = todayISO();
    const shown = load(SHOWN_KEY, {});
    if (shown.date !== today) Object.assign(shown, { date: today, slots: [] });

    const due = SLOTS.filter((s) => now.getHours() >= s.hour && !shown.slots.includes(s.id));
    if (!due.length) return;

    const viaBrowser = document.hidden && prefs.browser && notificationPermission() === 'granted';
    if (document.hidden && !viaBrowser) return; // wait until they come back to the tab

    const status = await getStatus();
    if (!status) return;
    shown.slots.push(...due.map((s) => s.id));
    save(SHOWN_KEY, shown);

    const message = reminderMessage(due[due.length - 1], status);
    if (!message) return;
    if (viaBrowser) {
      const n = new Notification(message.title, { body: message.body, tag: 'proteinpals-reminder' });
      n.onclick = () => { window.focus(); n.close(); };
    } else {
      showInApp(message);
    }
  }

  function scheduleNext() {
    clearTimeout(timer);
    const now = new Date();
    const at = (hour, dayOffset = 0) => {
      const d = new Date(now);
      d.setDate(d.getDate() + dayOffset);
      d.setHours(hour, 0, 5, 0);
      return d;
    };
    const next = SLOTS.map((s) => at(s.hour)).find((d) => d > now) || at(SLOTS[0].hour, 1);
    timer = setTimeout(check, next - now);
  }

  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  check();
}
