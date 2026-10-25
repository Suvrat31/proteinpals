// Food-name autocomplete built from the user's own past entries.
// Picking a suggestion fills in the macros from the most recent time that food
// was logged; the numbers stay editable before the entry is added.

// history: entries newest first → one item per food name (case-insensitive).
export function buildFoodIndex(history) {
  const byName = new Map();
  for (const entry of history) {
    const name = entry.food?.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const known = byName.get(key);
    if (known) {
      known.count++;
      continue;
    }
    byName.set(key, {
      name,
      protein: numOrNull(entry.protein),
      carbs: numOrNull(entry.carbs),
      fat: numOrNull(entry.fat),
      calories: numOrNull(entry.calories),
      count: 1,
      last: entry.created_at,
    });
  }
  return [...byName.values()];
}

const numOrNull = (v) => (v == null || v === '' ? null : Number(v));

// Ranks matches: name starts with the query, then a word starts with it, then
// it appears anywhere. Ties go to foods logged more often, then more recently.
export function suggest(index, query, limit = 6) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const ranked = [];
  for (const item of index) {
    const name = item.name.toLowerCase();
    const rank = name.startsWith(q) ? 0 : name.split(/[\s,()-]+/).some((w) => w.startsWith(q)) ? 1 : name.includes(q) ? 2 : -1;
    if (rank >= 0) ranked.push({ item, rank });
  }
  ranked.sort((a, b) => a.rank - b.rank || b.item.count - a.item.count || b.item.last.localeCompare(a.item.last));
  return ranked.slice(0, limit).map((r) => r.item);
}

const fmt = (n) => `${Math.round(n * 10) / 10}`;

export const describe = (item) => [
  item.protein != null && `${fmt(item.protein)}g protein`,
  item.calories != null && `${fmt(item.calories)} kcal`,
  item.carbs != null && `${fmt(item.carbs)}g carbs`,
  item.fat != null && `${fmt(item.fat)}g fat`,
].filter(Boolean).join(' · ');

// Turns a text input into an accessible combobox. getIndex() is called on every
// keystroke so suggestions always reflect the latest history.
export function attachAutofill(input, { getIndex, onPick }) {
  const list = document.createElement('ul');
  list.id = `${input.id}-suggestions`;
  list.className = 'suggestions';
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  input.after(list);
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', list.id);
  input.setAttribute('aria-expanded', 'false');
  input.autocomplete = 'off';

  let items = [];
  let active = -1;

  const close = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  };

  const highlight = (i) => {
    active = i;
    [...list.children].forEach((li, j) => li.setAttribute('aria-selected', String(j === i)));
    if (i >= 0) input.setAttribute('aria-activedescendant', `${list.id}-${i}`);
    else input.removeAttribute('aria-activedescendant');
  };

  const pick = (i) => {
    const item = items[i];
    if (!item) return;
    input.value = item.name;
    close();
    onPick(item);
  };

  const update = () => {
    items = suggest(getIndex(), input.value);
    if (!items.length) return close();
    list.innerHTML = items.map((item, i) => `
      <li id="${list.id}-${i}" role="option" aria-selected="false" data-index="${i}">
        <span class="s-name"></span>
        <span class="s-meta"></span>
      </li>`).join('');
    [...list.children].forEach((li, i) => {
      li.querySelector('.s-name').textContent = items[i].name;
      li.querySelector('.s-meta').textContent = describe(items[i]);
    });
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    highlight(-1);
  };

  input.addEventListener('input', update);
  input.addEventListener('focus', () => input.value && update());
  input.addEventListener('blur', () => setTimeout(close, 120));
  input.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      highlight((active + 1) % items.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      highlight(active <= 0 ? items.length - 1 : active - 1);
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault(); // pick instead of submitting the form
      pick(active);
    } else if (e.key === 'Escape') {
      close();
    }
  });
  // mousedown (not click) so it fires before the input's blur closes the list.
  list.addEventListener('mousedown', (e) => {
    const li = e.target.closest('li[data-index]');
    if (!li) return;
    e.preventDefault();
    pick(Number(li.dataset.index));
  });
}
