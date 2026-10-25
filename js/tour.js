// One-time "What's new in v2" walkthrough. Remembered per user in localStorage,
// and marked as seen the moment it opens so it never shows twice.
import { notificationPermission } from './reminders.js';

const seenKey = (userId) => `proteinpals-tour-v2:${userId}`;

export function shouldShowTour(userId) {
  try { return !localStorage.getItem(seenKey(userId)); } catch { return false; }
}

function markSeen(userId) {
  try { localStorage.setItem(seenKey(userId), new Date().toISOString()); } catch { /* storage unavailable */ }
}

// handlers: { enableWater(), chooseReminders('in-app' | 'browser' | 'off') }
// onClose: called once the dialog closes, however it was closed.
export function openTour({ userId, isAdmin, waterEnabled, handlers, onClose }) {
  markSeen(userId);
  const dialog = document.getElementById('tour');
  const canAskBrowser = !['unsupported', 'denied'].includes(notificationPermission());

  const features = [
    ['🔥', 'Calories', 'Log calories alongside protein, carbs and fat.'],
    ['⚡', 'Smart logging', 'Start typing a food you’ve logged before and pick it to fill in the numbers. You can still edit them before adding.'],
    ['💧', 'Water tracking', 'An optional, private water log. It never shows on the leaderboard.'],
    ['🔔', 'Gentle reminders', 'A quick nudge at 2 PM and 8 PM, only if you’re behind on protein.'],
    ...(isAdmin ? [['🛡️', 'Admin tools', 'You run this group: you can remove members and make a new invite code from the Group tab.']] : []),
  ];

  const steps = [
    {
      title: 'What’s new in ProteinPals',
      body: `<ul class="tour-list">${features.map(([icon, name, text]) =>
        `<li><span class="tour-icon" aria-hidden="true">${icon}</span><div><strong>${name}</strong><p>${text}</p></div></li>`).join('')}</ul>`,
      actions: '<button class="btn primary block" data-tour="next">Next</button>',
    },
    !waterEnabled && {
      title: 'Track water too?',
      body: `<p>Adds a small water tracker to your Today page with one-tap glass and bottle buttons.
        Only you can see it, and it doesn’t affect your score. You can change this any time in the Group tab.</p>`,
      actions: `<button class="btn primary block" data-tour="water-yes">Yes, track water</button>
        <button class="btn block" data-tour="next">No thanks</button>`,
    },
    {
      title: 'Gentle reminders',
      body: `<p>At <b>2 PM</b> and <b>8 PM</b>, if you haven’t hit your goal yet, you’ll see a short nudge with how much protein is left.
        Once you hit your goal, you won’t hear from us that day.</p>
        ${canAskBrowser ? '<p class="muted small">Browser notifications can also reach you while ProteinPals is open in a background tab.</p>' : ''}`,
      actions: `<button class="btn primary block" data-tour="reminders-in-app">Sounds good</button>
        ${canAskBrowser ? '<button class="btn block" data-tour="reminders-browser">Also send browser notifications</button>' : ''}
        <button class="btn block quiet" data-tour="reminders-off">Turn reminders off</button>`,
    },
  ].filter(Boolean);

  let index = 0;

  const render = () => {
    const step = steps[index];
    dialog.innerHTML = `
      <div class="tour">
        <div class="spread">
          <span class="badge">New in v2</span>
          <button class="icon-btn" data-tour="close" aria-label="Close">×</button>
        </div>
        <h2 id="tour-title">${step.title}</h2>
        ${step.body}
        <div class="tour-actions">${step.actions}</div>
        <div class="tour-dots" aria-hidden="true">${steps.map((_, i) => `<i class="${i === index ? 'on' : ''}"></i>`).join('')}</div>
      </div>`;
  };

  const next = () => {
    if (index < steps.length - 1) {
      index++;
      render();
    } else {
      dialog.close();
    }
  };

  dialog.onclick = async (e) => {
    if (e.target === dialog) return dialog.close(); // backdrop click
    const action = e.target.closest('[data-tour]')?.dataset.tour;
    if (!action) return;
    if (action === 'close') return dialog.close();
    if (action === 'next') return next();
    if (action === 'water-yes') {
      next();
      return handlers.enableWater();
    }
    if (action.startsWith('reminders-')) {
      dialog.close();
      return handlers.chooseReminders(action.slice('reminders-'.length));
    }
  };

  dialog.onclose = () => onClose?.();
  dialog.setAttribute('aria-labelledby', 'tour-title');
  render();
  dialog.showModal();
}
