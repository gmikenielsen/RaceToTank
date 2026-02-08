const DATA_URL = './data/latest.json';

const statusEl = document.getElementById('status');
const updatedChipEl = document.getElementById('updated-chip');
const desktopBodyEl = document.getElementById('desktop-body');
const mobileCardsEl = document.getElementById('mobile-cards');
const refreshButtonEl = document.getElementById('refresh-btn');
const todaySubEl = document.getElementById('today-sub');
const todayListEl = document.getElementById('today-list');

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatTimestamp(iso) {
  if (!iso) return 'Unknown';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleString();
}

function showStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.className = isError ? 'status error' : 'status';
}

function renderTodaySchedule(todaySchedule) {
  todayListEl.innerHTML = '';

  const schedule = todaySchedule && typeof todaySchedule === 'object' ? todaySchedule : {};
  const games = Array.isArray(schedule.games) ? schedule.games : [];
  const dateEt = schedule.dateEt || 'Unknown date';
  const timeZone = schedule.timeZone || 'America/New_York';

  todaySubEl.textContent = `${dateEt} (${timeZone})`;

  if (!games.length) {
    todayListEl.innerHTML = '<li>No games today for these 12 teams.</li>';
    return;
  }

  const formatter = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  });

  todayListEl.innerHTML = games
    .map((game) => {
      const matchup = escapeHtml(game.matchup || 'Unknown matchup');
      const tracked = Array.isArray(game.trackedTeams) ? game.trackedTeams.join(', ') : '';
      const trackedText = tracked ? ` [Tracked: ${escapeHtml(tracked)}]` : '';
      const tipoff = game.tipoffUtc ? formatter.format(new Date(game.tipoffUtc)) : 'TBD';
      const status = game.status ? ` (${escapeHtml(game.status)})` : '';
      return `<li><strong>${tipoff}</strong> - ${matchup}${status}${trackedText}</li>`;
    })
    .join('');
}

function renderRows(rows) {
  desktopBodyEl.innerHTML = '';
  mobileCardsEl.innerHTML = '';

  if (!rows.length) {
    showStatus('No rows available yet. Run the daily data builder.');
    return;
  }

  const desktopHtml = rows
    .map((row) => {
      const team = escapeHtml(row.teamDisplay || row.team || 'Unknown Team');
      const opponents = escapeHtml(row.opponentsText || 'None');
      return `<tr><td class="team">${team}</td><td class="opponents">${opponents}</td></tr>`;
    })
    .join('');

  const mobileHtml = rows
    .map((row) => {
      const team = escapeHtml(row.teamDisplay || row.team || 'Unknown Team');
      const opponents = escapeHtml(row.opponentsText || 'None');
      return `<article class="card"><div class="team">${team}</div><div class="opponents">${opponents}</div></article>`;
    })
    .join('');

  desktopBodyEl.innerHTML = desktopHtml;
  mobileCardsEl.innerHTML = mobileHtml;
  showStatus(`${rows.length} teams loaded.`);
}

async function loadData() {
  showStatus('Loading data...');

  try {
    const response = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Data request failed with ${response.status}`);
    }

    const payload = await response.json();
    const rows = Array.isArray(payload.rows) ? payload.rows : [];

    updatedChipEl.textContent = `Last updated: ${formatTimestamp(payload.generatedAt)}`;
    renderTodaySchedule(payload.todaySchedule);
    renderRows(rows);
  } catch (error) {
    showStatus(`Unable to load data: ${error.message}`, true);
    todaySubEl.textContent = 'Unavailable';
    todayListEl.innerHTML = "<li>Unable to load today's schedule.</li>";
  }
}

refreshButtonEl.addEventListener('click', () => {
  loadData();
});

loadData();
