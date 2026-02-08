const DATA_URL = './data/latest.json';

const statusEl = document.getElementById('status');
const desktopBodyEl = document.getElementById('desktop-body');
const mobileCardsEl = document.getElementById('mobile-cards');
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

function ordinalSuffix(day) {
  if (day % 100 >= 11 && day % 100 <= 13) return 'th';
  if (day % 10 === 1) return 'st';
  if (day % 10 === 2) return 'nd';
  if (day % 10 === 3) return 'rd';
  return 'th';
}

function formatScheduleDate(dateEt, timeZone) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateEt || '').trim());
  if (!match) return dateEt || 'Unknown date';

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, monthIndex, day, 12, 0, 0));

  if (Number.isNaN(date.getTime())) return dateEt || 'Unknown date';

  const weekday = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    timeZone,
  }).format(date);
  const month = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    timeZone,
  }).format(date);

  return `${weekday}, ${month} ${day}${ordinalSuffix(day)}`;
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

function resolveRecordText(row) {
  const record = String(row?.record || '').trim();
  return record || '--';
}

function formatLoadStatus(rowsCount, generatedAt, refreshStatus) {
  let message = `Last updated: ${formatTimestamp(generatedAt)}.`;

  if (refreshStatus && refreshStatus.source === 'cached') {
    const lastLive = refreshStatus.lastLiveGeneratedAt ? formatTimestamp(refreshStatus.lastLiveGeneratedAt) : 'unknown';
    message += ` Using cached data (last live: ${lastLive}).`;
  }

  return message;
}

function renderTodaySchedule(todaySchedule) {
  todayListEl.innerHTML = '';

  const schedule = todaySchedule && typeof todaySchedule === 'object' ? todaySchedule : {};
  const games = Array.isArray(schedule.games) ? schedule.games : [];
  const dateEt = schedule.dateEt || 'Unknown date';
  const timeZone = schedule.timeZone || 'America/New_York';

  todaySubEl.textContent = formatScheduleDate(dateEt, timeZone);

  if (!games.length) {
    todayListEl.innerHTML = '<li>No games today for these 14 teams.</li>';
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
      const tipoff = game.tipoffUtc ? formatter.format(new Date(game.tipoffUtc)) : 'TBD';
      return `<li><strong>${tipoff}</strong> - ${matchup}</li>`;
    })
    .join('');
}

function renderRows(rows, payload) {
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
      const rank = escapeHtml(String(index + 1));
      const teamName = escapeHtml(resolveTeamDisplay(row));
      const record = escapeHtml(resolveRecordText(row));
      const opponents = escapeHtml(row.opponentsText || 'None');
      return `<tr><td class="team"><div class="team-main"><span class="team-rank">${rank}.</span><span class="team-name">${teamName}</span></div><div class="team-record">Record: ${record}</div></td><td class="opponents">${opponents}</td></tr>`;
    })
    .join('');

  const mobileHtml = orderedRows
    .map((row, index) => {
      const rank = escapeHtml(String(index + 1));
      const teamName = escapeHtml(resolveTeamDisplay(row));
      const record = escapeHtml(resolveRecordText(row));
      const opponents = escapeHtml(row.opponentsText || 'None');
      return `<article class="card"><div class="team"><div class="team-main"><span class="team-rank">${rank}.</span><span class="team-name">${teamName}</span></div><div class="team-record">Record: ${record}</div></div><div class="opponents">${opponents}</div></article>`;
    })
    .join('');

  desktopBodyEl.innerHTML = desktopHtml;
  mobileCardsEl.innerHTML = mobileHtml;
  showStatus(formatLoadStatus(rows.length, payload.generatedAt, payload.refreshStatus));
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

    renderTodaySchedule(payload.todaySchedule);
    renderRows(rows, payload);
  } catch (error) {
    showStatus(`Unable to load data: ${error.message}`, true);
    todaySubEl.textContent = 'Unavailable';
    todayListEl.innerHTML = "<li>Unable to load today's schedule.</li>";
  }
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  try {
    await navigator.serviceWorker.register('./sw.js?v=6', { scope: './' });
  } catch (error) {
    console.warn('Service worker registration failed', error);
  }
}

registerServiceWorker();
loadData();
