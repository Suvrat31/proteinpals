// Demo backend: same interface as supabase-api.js, stored in localStorage.
// Data never leaves this browser, so friends can't see each other — it's for trying the app.
import { todayISO, addDays, weekStart } from './dates.js';

const DB_KEY = 'proteinpals-demo-db';
const SESSION_KEY = 'proteinpals-demo-session';

const newId = () =>
  crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const newCode = () => Math.random().toString(36).slice(2, 8).toUpperCase().padEnd(6, 'X');
const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
const now = () => new Date().toISOString();

const PROFILE_DEFAULTS = { role: 'member', joined_at: null, water_enabled: false, water_goal_ml: 2000 };

function read() {
  let db;
  try {
    db = JSON.parse(localStorage.getItem(DB_KEY));
  } catch { /* fall through to a fresh db */ }
  db ||= { users: [], profiles: [], groups: [], logs: [] };
  // Bring demo data saved by v1 up to date (same as the schema.sql backfill).
  db.water ||= {};
  db.profiles = db.profiles.map((p) => ({ ...PROFILE_DEFAULTS, ...p }));
  for (const g of db.groups) {
    const members = db.profiles.filter((p) => p.group_id === g.id);
    if (members.length && !members.some((p) => p.role === 'admin')) {
      (members.find((p) => p.id === g.created_by) || members[0]).role = 'admin';
    }
  }
  return db;
}

const write = (db) => localStorage.setItem(DB_KEY, JSON.stringify(db));

function currentUserId() {
  const session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
  if (!session) throw new Error('Not signed in');
  return session.userId;
}

const profileOf = (db, id) => db.profiles.find((p) => p.id === id);

function startSession(user) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ userId: user.id, email: user.email }));
}

// When an admin leaves, the longest-standing remaining member takes over.
function handOffAdmin(db, leavingId) {
  const leaving = profileOf(db, leavingId);
  if (!leaving?.group_id || leaving.role !== 'admin') return;
  const next = db.profiles
    .filter((p) => p.group_id === leaving.group_id && p.id !== leavingId)
    .sort((a, b) => (a.joined_at || a.created_at).localeCompare(b.joined_at || b.created_at))[0];
  if (next) next.role = 'admin';
}

const leaveGroupFields = { group_id: null, invited_by: null, role: 'member', joined_at: null };

// Adds a few pretend friends with last week's and this week's logs so the leaderboard has something to show.
function seedFriends(db, group, ownerId) {
  let seed = 42;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const today = todayISO();
  const friends = [['Maya', 110], ['Jordan', 160], ['Sam', 90]];

  for (const [name, goal] of friends) {
    const id = newId();
    db.profiles.push({
      ...PROFILE_DEFAULTS, id, display_name: name, daily_goal: goal, group_id: group.id,
      invited_by: ownerId, joined_at: now(), created_at: now(),
    });
    for (let date = addDays(weekStart(today), -7); date <= today; date = addDays(date, 1)) {
      if (rand() < 0.12) continue; // skipped a day
      const total = Math.round(goal * (0.55 + rand() * 0.6));
      const first = Math.round(total * (0.35 + rand() * 0.3));
      for (const [food, protein] of [['Breakfast', first], ['Dinner', total - first]]) {
        db.logs.push({
          id: newId(), user_id: id, log_date: date, food, protein, carbs: null, fat: null,
          calories: Math.round(protein * 12), goal_snapshot: goal, created_at: now(),
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
      ...PROFILE_DEFAULTS, id: user.id, display_name: displayName, daily_goal: dailyGoal,
      group_id: null, invited_by: null, created_at: now(),
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
    return clone(profileOf(read(), userId));
  },

  async updateProfile(userId, patch) {
    const db = read();
    const allowed = ['display_name', 'daily_goal', 'water_enabled', 'water_goal_ml'];
    const profile = profileOf(db, userId);
    for (const key of allowed) if (key in patch) profile[key] = patch[key];
    write(db);
  },

  async getGroup(groupId) {
    return clone(read().groups.find((g) => g.id === groupId));
  },

  async createGroup(name) {
    const db = read();
    const me = currentUserId();
    handOffAdmin(db, me);
    const group = { id: newId(), name: name.trim(), invite_code: newCode(), created_by: me, created_at: now() };
    db.groups.push(group);
    Object.assign(profileOf(db, me), { group_id: group.id, invited_by: null, role: 'admin', joined_at: now() });
    seedFriends(db, group, me);
    write(db);
    return clone(group);
  },

  async joinGroup(code, inviterId) {
    const db = read();
    const me = currentUserId();
    const group = db.groups.find((g) => g.invite_code === code.trim().toUpperCase());
    if (!group) throw new Error("That invite code doesn't exist");
    if (profileOf(db, me).group_id === group.id) return clone(group);
    handOffAdmin(db, me);
    const inviterOk = inviterId && inviterId !== me && db.profiles.some((p) => p.id === inviterId && p.group_id === group.id);
    Object.assign(profileOf(db, me), {
      group_id: group.id,
      role: 'member',
      joined_at: now(),
      invited_by: inviterOk ? inviterId : group.created_by,
    });
    write(db);
    return clone(group);
  },

  async leaveGroup() {
    const db = read();
    const me = currentUserId();
    handOffAdmin(db, me);
    Object.assign(profileOf(db, me), leaveGroupFields);
    write(db);
  },

  async removeMember(memberId) {
    const db = read();
    const me = profileOf(db, currentUserId());
    if (!me.group_id || me.role !== 'admin') throw new Error('Only the group admin can remove members');
    if (memberId === me.id) throw new Error('Use "Leave group" to remove yourself');
    const member = profileOf(db, memberId);
    if (member?.group_id !== me.group_id) throw new Error("That person isn't in your group");
    Object.assign(member, leaveGroupFields);
    write(db);
  },

  async regenerateInviteCode() {
    const db = read();
    const me = profileOf(db, currentUserId());
    if (!me.group_id || me.role !== 'admin') throw new Error('Only the group admin can change the invite code');
    const group = db.groups.find((g) => g.id === me.group_id);
    group.invite_code = newCode();
    write(db);
    return group.invite_code;
  },

  async getMembers(groupId) {
    return clone(read().profiles.filter((p) => p.group_id === groupId));
  },

  async getLogs({ from, to, userId }) {
    const db = read();
    const me = currentUserId();
    const myGroup = profileOf(db, me)?.group_id;
    const visible = new Set(db.profiles.filter((p) => p.id === me || (myGroup && p.group_id === myGroup)).map((p) => p.id));
    return clone(db.logs.filter((l) =>
      visible.has(l.user_id) && l.log_date >= from && l.log_date <= to && (!userId || l.user_id === userId)));
  },

  async addLog(entry) {
    const db = read();
    const me = currentUserId();
    const log = {
      id: newId(), ...entry, user_id: me,
      goal_snapshot: profileOf(db, me).daily_goal,
      created_at: now(),
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

  async getFoodHistory(userId) {
    return clone(read().logs
      .filter((l) => l.user_id === userId && l.food)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 300));
  },

  async getWater({ from, to }) {
    const me = currentUserId();
    return Object.entries(read().water)
      .map(([key, ml]) => { const [user, log_date] = key.split('|'); return { user, log_date, ml }; })
      .filter((w) => w.user === me && w.log_date >= from && w.log_date <= to)
      .map(({ log_date, ml }) => ({ log_date, ml }));
  },

  async addWater(date, deltaMl) {
    const db = read();
    const key = `${currentUserId()}|${date}`;
    db.water[key] = Math.min(Math.max((db.water[key] || 0) + deltaMl, 0), 20000);
    write(db);
    return db.water[key];
  },
};
