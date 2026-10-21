// Normalized scoring: each day is worth up to 100 points = % of that day's goal,
// capped at 100 so overeating one day can't make up for skipping another.
// A week is worth up to 700. Ties are broken by number of days the goal was hit.

export const DAY_MAX = 100;
export const WEEK_MAX = DAY_MAX * 7;

export const dayPercent = (protein, goal) => (goal > 0 ? (protein / goal) * 100 : 0);

export const dayPoints = (protein, goal) => Math.round(Math.min(dayPercent(protein, goal), DAY_MAX));

// logs → Map(date → { protein, carbs, fat, goal, entries }).
// A day's goal is the highest goal snapshot among that day's entries.
export function summarizeDays(logs) {
  const days = new Map();
  for (const log of logs) {
    let day = days.get(log.log_date);
    if (!day) days.set(log.log_date, (day = { protein: 0, carbs: 0, fat: 0, goal: 0, entries: [] }));
    day.protein += Number(log.protein) || 0;
    day.carbs += Number(log.carbs) || 0;
    day.fat += Number(log.fat) || 0;
    day.goal = Math.max(day.goal, Number(log.goal_snapshot) || 0);
    day.entries.push(log);
  }
  return days;
}

export function buildLeaderboard(members, logs, days, today) {
  const logsByUser = new Map();
  for (const log of logs) {
    if (!logsByUser.has(log.user_id)) logsByUser.set(log.user_id, []);
    logsByUser.get(log.user_id).push(log);
  }

  const rows = members.map((member) => {
    const summary = summarizeDays(logsByUser.get(member.id) || []);
    const daily = days.map((date) => {
      const s = summary.get(date);
      const goal = s?.goal || member.daily_goal;
      const protein = s?.protein || 0;
      return {
        date,
        protein,
        goal,
        future: date > today,
        percent: dayPercent(protein, goal),
        points: dayPoints(protein, goal),
        hit: protein >= goal,
      };
    });
    return {
      member,
      daily,
      points: daily.reduce((sum, d) => sum + d.points, 0),
      daysHit: daily.filter((d) => d.hit).length,
    };
  });

  rows.sort((a, b) =>
    b.points - a.points ||
    b.daysHit - a.daysHit ||
    a.member.display_name.localeCompare(b.member.display_name));

  rows.forEach((row, i) => {
    const prev = rows[i - 1];
    row.rank = prev && prev.points === row.points && prev.daysHit === row.daysHit ? prev.rank : i + 1;
  });
  return rows;
}
