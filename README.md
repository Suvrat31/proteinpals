# ProteinPals

A weekly protein challenge for you and your friends. Set a daily protein goal, log what you eat, and compete on a leaderboard that resets every Monday.

- **Static site.** Plain HTML, CSS and JavaScript with no build step. Host it free on Netlify, Vercel, GitHub Pages or Cloudflare Pages.
- **Supabase (free tier)** handles login and stores the shared data, so friends see each other's scores.
- **Demo mode.** With no Supabase keys in `js/config.js`, the app saves to your browser and adds a few pretend friends, so you can try it right away.

## Features

- **Weekly leaderboard** with fair, goal-normalized scoring (below).
- **Logging** of protein, calories, carbs and fat. **Smart logging** suggests foods you've logged before as you type; picking one fills in the numbers from the last time, and you can edit them before adding.
- **Water tracking (optional, private).** Turn it on in the Group tab or the welcome tour. It never shows on the leaderboard.
- **Gentle reminders** at 2 PM and 8 PM, only if you're behind on protein, at most once each per day. They show in the app, or as browser notifications if you allow them. Browsers can't send these with the app fully closed, so a missed reminder shows the next time you open it.
- **Group admin.** Whoever creates a group is its admin and can remove members and make a new invite code. If the admin leaves, the longest-standing member takes over.
- **What's new tour.** Shown once per user per browser (stored in `localStorage`). You can replay it from the Group tab.

## How scoring works

| | |
|---|---|
| Daily points | % of *your own* goal, capped at 100. 130g of a 130g goal = 80g of an 80g goal = 100 pts |
| Weekly score | Sum of the 7 days, max 700 |
| Tie-break | More days at 100% wins |
| Reset | Weeks run Monday–Sunday. Past weeks stay viewable, with the winner shown |
| Goal changes | Each entry records your goal when you logged it. A day uses its highest recorded goal, so lowering your goal at 11pm can't inflate that day |

## Try it locally

```bash
python3 -m http.server 5173
```

Open http://localhost:5173. You need a local server because ES modules don't load from `file://`.

Add `?demo` to the URL (http://localhost:5173/?demo) to use demo mode even when Supabase is configured. It's handy for trying changes without touching real data.

## Upgrading the database

`supabase/schema.sql` is safe to re-run: it adds new tables, columns and functions in place and keeps existing data. After pulling changes that touch it, paste it into **Supabase → SQL Editor** and run it **before** deploying the new site. Supabase will warn about "destructive operations"; that's the `drop … if exists` lines that let the script re-run, not a data deletion.

## Set up for real (about 10 minutes, $0)

### 1. Create the database

1. Sign up at [supabase.com](https://supabase.com) and create a new project (free plan).
2. Open **SQL Editor → New query**, paste all of [`supabase/schema.sql`](supabase/schema.sql), and click **Run**.
3. Go to **Authentication → Sign In / Providers → Email** and turn **off** "Confirm email". Friends can then sign up and start right away. If you leave it on, the app still works; people just confirm by email first.

### 2. Connect the app

In **Project Settings → API**, copy the **Project URL** and the **anon / publishable key** into [`js/config.js`](js/config.js):

```js
export const SUPABASE_URL = 'https://abcd1234.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOi...';   // or sb_publishable_...
```

The anon key is designed to be public, so it's fine to commit. Row Level Security in the schema controls what each user can read and write.

### 3. Deploy (pick one)

- **Netlify Drop:** go to [app.netlify.com/drop](https://app.netlify.com/drop) and drag this folder in. Done.
- **Vercel / Netlify / Cloudflare Pages:** push to GitHub, import the repo, leave the build command empty, and set the output directory to `/`.
- **GitHub Pages:** push to GitHub, then go to **Settings → Pages → Deploy from branch → main / root**.

If you left "Confirm email" on, also add your site URL under **Supabase → Authentication → URL Configuration → Site URL** so confirmation links go back to your app.

### 4. Invite friends

Create a group, open the **Group** tab, and send the invite link. Anyone who signs up through it joins your group automatically, and the app records who invited whom. Friends can also type the 6-letter code.

## Free-tier notes

- Supabase pauses free projects after **7 days with no activity**. Daily logging keeps it awake, but if everyone stops for a week, click "Restore" in the dashboard.
- The free tier's limits (500 MB database, 50k monthly active users) are far beyond what a friend group needs.

## Project layout

```
index.html            app shell
css/styles.css        styles (light + dark)
js/app.js             UI: views, actions, forms
js/autofill.js        food-name suggestions from your history
js/reminders.js       2 PM / 8 PM reminder rules + browser notifications
js/tour.js            one-time "what's new" walkthrough
js/scoring.js         normalized points + leaderboard ranking
js/dates.js           local-date + Monday-week helpers
js/api.js             picks Supabase or demo backend
js/supabase-api.js    Supabase backend
js/local-api.js       localStorage demo backend (same interface)
supabase/schema.sql   tables, triggers, group/admin/water RPCs, RLS policies
```

## Security (kept deliberately simple)

- Login is plain email and password through Supabase Auth.
- Users can read only their own group's profiles and logs, and can only add or delete their own logs.
- Your user ID and goal are stamped onto each entry by the server, not taken from the browser. Group membership and roles change only through the `create_group` / `join_group` / `leave_group` / `remove_member` functions, and only an admin can remove people or change the invite code.
- Water logs are visible only to their owner.
- Nothing stops someone from logging protein they didn't eat. It's an honor system among friends.
