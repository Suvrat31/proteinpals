import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.115.0/+esm';

export function createSupabaseApi(url, key) {
  const sb = createClient(url, key);

  const must = ({ data, error }) => {
    if (error) throw new Error(error.message);
    return data;
  };

  return {
    async getSession() {
      const { data } = await sb.auth.getSession();
      const user = data.session?.user;
      return user ? { userId: user.id, email: user.email } : null;
    },

    async signUp({ email, password, displayName, dailyGoal }) {
      const data = must(await sb.auth.signUp({
        email,
        password,
        options: { data: { display_name: displayName, daily_goal: dailyGoal } },
      }));
      // No session means "Confirm email" is still enabled in Supabase Auth settings.
      return { needsConfirmation: !data.session };
    },

    async signIn({ email, password }) {
      must(await sb.auth.signInWithPassword({ email, password }));
    },

    async signOut() {
      await sb.auth.signOut();
    },

    async getMyProfile(userId) {
      return must(await sb.from('profiles').select('*').eq('id', userId).single());
    },

    async updateProfile(userId, patch) {
      must(await sb.from('profiles').update(patch).eq('id', userId));
    },

    async getGroup(groupId) {
      return must(await sb.from('groups').select('*').eq('id', groupId).single());
    },

    async createGroup(name) {
      return must(await sb.rpc('create_group', { group_name: name }));
    },

    async joinGroup(code, inviterId) {
      return must(await sb.rpc('join_group', { code, inviter: inviterId || null }));
    },

    async leaveGroup() {
      must(await sb.rpc('leave_group'));
    },

    async removeMember(memberId) {
      must(await sb.rpc('remove_member', { member: memberId }));
    },

    async regenerateInviteCode() {
      return must(await sb.rpc('regenerate_invite_code'));
    },

    async getMembers(groupId) {
      return must(await sb.from('profiles')
        .select('id, display_name, daily_goal, invited_by, role, joined_at, created_at')
        .eq('group_id', groupId));
    },

    // Logs between two dates (inclusive). RLS limits results to you + your group.
    async getLogs({ from, to, userId }) {
      let q = sb.from('food_logs').select('*').gte('log_date', from).lte('log_date', to).order('created_at');
      if (userId) q = q.eq('user_id', userId);
      return must(await q);
    },

    async addLog(entry) {
      return must(await sb.from('food_logs').insert(entry).select().single());
    },

    async deleteLog(id) {
      must(await sb.from('food_logs').delete().eq('id', id));
    },

    // My most recent named entries, newest first, for autofill suggestions.
    async getFoodHistory(userId) {
      return must(await sb.from('food_logs')
        .select('food, protein, carbs, fat, calories, created_at')
        .eq('user_id', userId)
        .not('food', 'is', null)
        .order('created_at', { ascending: false })
        .limit(300));
    },

    // Water is private: RLS only ever returns my own rows.
    async getWater({ from, to }) {
      return must(await sb.from('water_days').select('log_date, ml').gte('log_date', from).lte('log_date', to));
    },

    async addWater(date, deltaMl) {
      return must(await sb.rpc('add_water', { day: date, delta_ml: deltaMl }));
    },
  };
}
