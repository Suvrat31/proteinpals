// Demo backend: same interface as supabase-api.js, stored in localStorage.
// Data never leaves this browser, so friends can't see each other — it's for trying the app.
import { todayISO, addDays, weekStart } from './dates.js';

const DB_KEY = 'proteinpals-demo-db';
const SESSION_KEY = 'proteinpals-demo-session';

const newId = () =>
  crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const newCode = () => Math.random().toString(36).slice(2, 8).toUpperCase().padEnd(6, 'X');
const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));

function read() {
  try {
    return JSON.parse(localStorage.getItem(DB_KEY)) || { users: [], profiles: [], groups: [], logs: [] };
  } catch {
    return { users: [], profiles: [], groups: [], logs: [] };
  }
}

const write = (db) => localStorage.setItem(DB_KEY, JSON.stringify(db));

function currentUserId() {
  const session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
  if (!session) throw new Error('Not signed in');
  return session.userId;
}

function startSession(user) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ userId: user.id, email: user.email }));
}

// Adds a few pretend friends with last week's and this week's logs so the leaderboard has something to show.
function seedFriends(db, group, ownerId) {
  let seed = 42;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const today = todayISO();
  const friends = [['Maya', 110], ['Jordan', 160], ['Sam', 90]];

  for (const [name, goal] of friends) {
    const id = newId();
    db.profiles.push({
      id, display_name: name, daily_goal: goal, group_id: group.id,
      invited_by: ownerId, created_at: new Date().toISOString(),
    });
    for (let date = addDays(weekStart(today), -7); date <= today; date = addDays(date, 1)) {
      if (rand() < 0.12) continue; // skipped a day
      const total = Math.round(goal * (0.55 + rand() * 0.6));
      const first = Math.round(total * (0.35 + rand() * 0.3));
      for (const [food, protein] of [['Breakfast', first], ['Dinner', total - first]]) {
        db.logs.push({
          id: newId(), user_id: id, log_date: date, food, protein, carbs: null, fat: null,
          goal_snapshot: goal, created_at: new Date().toISOString(),
        });
      }
    }
  }
}

export const localApi = {
  async getSession() {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
  },

  async signUp({ email, password, displayName, dailyGoal }) {
    const db = read();
    email = email.trim().toLowerCase();
    if (db.users.some((u) => u.email === email)) throw new Error('An account with that email already exists');
    const user = { id: newId(), email, password };
    db.users.push(user);
    db.profiles.push({
      id: user.id, display_name: displayName, daily_goal: dailyGoal,
      group_id: null, invited_by: null, created_at: new Date().toISOString(),
    });
    write(db);
    startSession(user);
    return { needsConfirmation: false };
  },

  async signIn({ email, password }) {
    const user = read().users.find((u) => u.email === email.trim().toLowerCase() && u.password === password);
    if (!user) throw new Error('Invalid login credentials');
    startSession(user);
  },

  async signOut() {
    localStorage.removeItem(SESSION_KEY);
  },

  async getMyProfile(userId) {
    return clone(read().profiles.find((p) => p.id === userId));
  },

  async updateProfile(userId, { display_name, daily_goal }) {
    const db = read();
    Object.assign(db.profiles.find((p) => p.id === userId), { display_name, daily_goal });
    write(db);
  },

  async getGroup(groupId) {
    return clone(read().groups.find((g) => g.id === groupId));
  },

  async createGroup(name) {
    const db = read();
    const me = currentUserId();
    const group = { id: newId(), name: name.trim(), invite_code: newCode(), created_by: me, created_at: new Date().toISOString() };
    db.groups.push(group);
    Object.assign(db.profiles.find((p) => p.id === me), { group_id: group.id, invited_by: null });
    seedFriends(db, group, me);
    write(db);
    return clone(group);
  },

  async joinGroup(code, inviterId) {
    const db = read();
    const me = currentUserId();
    const group = db.groups.find((g) => g.invite_code === code.trim().toUpperCase());
    if (!group) throw new Error("That invite code doesn't exist");
    const inviterOk = inviterId && inviterId !== me && db.profiles.some((p) => p.id === inviterId && p.group_id === group.id);
    Object.assign(db.profiles.find((p) => p.id === me), {
      group_id: group.id,
      invited_by: inviterOk ? inviterId : group.created_by,
    });
    write(db);
    return clone(group);
  },

  async leaveGroup() {
    const db = read();
    Object.assign(db.profiles.find((p) => p.id === currentUserId()), { group_id: null, invited_by: null });
    write(db);
  },

  async getMembers(groupId) {
    return clone(read().profiles.filter((p) => p.group_id === groupId));
  },

  async getLogs({ from, to, userId }) {
    const db = read();
    const me = currentUserId();
    const myGroup = db.profiles.find((p) => p.id === me)?.group_id;
    const visible = new Set(db.profiles.filter((p) => p.id === me || (myGroup && p.group_id === myGroup)).map((p) => p.id));
    return clone(db.logs.filter((l) =>
      visible.has(l.user_id) && l.log_date >= from && l.log_date <= to && (!userId || l.user_id === userId)));
  },

  async addLog(entry) {
    const db = read();
    const me = currentUserId();
    const log = {
      id: newId(), ...entry, user_id: me,
      goal_snapshot: db.profiles.find((p) => p.id === me).daily_goal,
      created_at: new Date().toISOString(),
    };
    db.logs.push(log);
    write(db);
    return clone(log);
  },

  async deleteLog(id) {
    const db = read();
    const me = currentUserId();
    db.logs = db.logs.filter((l) => !(l.id === id && l.user_id === me));
    write(db);
  },
};
