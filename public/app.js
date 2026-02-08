const DATA_URL = './data/latest.json';

const statusEl = document.getElementById('status');
const updatedChipEl = document.getElementById('updated-chip');
const desktopBodyEl = document.getElementById('desktop-body');
const mobileCardsEl = document.getElementById('mobile-cards');
const refreshButtonEl = document.getElementById('refresh-btn');
const todaySubEl = document.getElementById('today-sub');
const todayListEl = document.getElementById('today-list');
const refreshStatusChipEl = document.getElementById('refresh-status-chip');

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

function sumFromOpponentsText(opponentsText) {
  if (typeof opponentsText !== 'string') return null;
  const matches = [...opponentsText.matchAll(/\((\d+)\)/g)];
  if (!matches.length) return null;
  return matches.reduce((sum, m) => sum + Number(m[1] || 0), 0);
}

function resolveTeamDisplay(row) {
  const baseTeam = row.team || row.teamDisplay || 'Unknown Team';

  const directTotal = Number(row.totalRemainingVsBottom12);
  if (Number.isFinite(directTotal)) return `${baseTeam} (${directTotal})`;

  if (Array.isArray(row.opponents) && row.opponents.length) {
    const total = row.opponents.reduce((sum, item) => sum + Number(item?.gamesRemaining || 0), 0);
    return `${baseTeam} (${total})`;
  }

  const parsedTotal = sumFromOpponentsText(row.opponentsText);
  if (Number.isFinite(parsedTotal)) return `${baseTeam} (${parsedTotal})`;

  return baseTeam;
}

function renderRefreshStatus(refreshStatus) {
  if (!refreshStatusChipEl) return;

  const status = refreshStatus && typeof refreshStatus === 'object' ? refreshStatus : {};
  if (status.source !== 'cached') {
    refreshStatusChipEl.textContent = '';
    refreshStatusChipEl.classList.add('hidden');
    return;
  }

  const lastLive = status.lastLiveGeneratedAt ? formatTimestamp(status.lastLiveGeneratedAt) : 'unknown';
  refreshStatusChipEl.textContent = `Using cached data (last live: ${lastLive})`;
  refreshStatusChipEl.classList.remove('hidden');
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

  const orderedRows = [...rows].sort((a, b) => {
    const aRank = Number(a?.rank);
    const bRank = Number(b?.rank);

    const aHasRank = Number.isFinite(aRank) && aRank > 0;
    const bHasRank = Number.isFinite(bRank) && bRank > 0;

    if (aHasRank && bHasRank) return aRank - bRank;
    if (aHasRank) return -1;
    if (bHasRank) return 1;

    return 0;
  });

  const desktopHtml = orderedRows
    .map((row, index) => {
      const team = `${index + 1}.&nbsp;${escapeHtml(resolveTeamDisplay(row))}`;
      const opponents = escapeHtml(row.opponentsText || 'None');
      return `<tr><td class="team">${team}</td><td class="opponents">${opponents}</td></tr>`;
    })
    .join('');

  const mobileHtml = orderedRows
    .map((row, index) => {
      const team = `${index + 1}.&nbsp;${escapeHtml(resolveTeamDisplay(row))}`;
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
    renderRefreshStatus(payload.refreshStatus);
    renderTodaySchedule(payload.todaySchedule);
    renderRows(rows);
  } catch (error) {
    showStatus(`Unable to load data: ${error.message}`, true);
    todaySubEl.textContent = 'Unavailable';
    todayListEl.innerHTML = "<li>Unable to load today's schedule.</li>";
    renderRefreshStatus(null);
  }
}

refreshButtonEl.addEventListener('click', () => {
  loadData();
});

loadData();
