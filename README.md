# ProteinPals

A weekly protein challenge for you and your friends. Set a daily protein goal, log what you eat, and compete on a leaderboard that resets every Monday.

- **Static site.** Plain HTML, CSS and JavaScript with no build step. Host it free on Netlify, Vercel, GitHub Pages or Cloudflare Pages.
- **Supabase (free tier)** handles login and stores the shared data, so friends see each other's scores.
- **Demo mode.** With no Supabase keys in `js/config.js`, the app saves to your browser and adds a few pretend friends, so you can try it right away.

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
js/scoring.js         normalized points + leaderboard ranking
js/dates.js           local-date + Monday-week helpers
js/api.js             picks Supabase or demo backend
js/supabase-api.js    Supabase backend
js/local-api.js       localStorage demo backend (same interface)
supabase/schema.sql   tables, triggers, group RPCs, RLS policies
```

## Security (kept deliberately simple)

- Login is plain email and password through Supabase Auth.
- Users can read only their own group's profiles and logs, and can only add or delete their own logs.
- Your user ID and goal are stamped onto each entry by the server, not taken from the browser. Group membership changes only through `create_group` / `join_group` / `leave_group`.
- Nothing stops someone from logging protein they didn't eat. It's an honor system among friends.
