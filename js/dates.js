// All dates are local calendar days as 'YYYY-MM-DD' strings. Weeks run Monday → Sunday.

const pad = (n) => String(n).padStart(2, '0');

export const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const fromISO = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export const todayISO = () => toISO(new Date());

export const addDays = (iso, n) => {
  const d = fromISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
};

export const weekStart = (iso) => {
  const d = fromISO(iso);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return toISO(d);
};

export const weekDays = (start) => Array.from({ length: 7 }, (_, i) => addDays(start, i));

export const fmtDay = (iso, opts = { weekday: 'short', month: 'short', day: 'numeric' }) =>
  fromISO(iso).toLocaleDateString(undefined, opts);

export const fmtRange = (start) => {
  const o = { month: 'short', day: 'numeric' };
  return `${fmtDay(start, o)} – ${fmtDay(addDays(start, 6), o)}`;
};
