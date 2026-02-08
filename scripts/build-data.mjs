import fs from 'node:fs/promises';
import path from 'node:path';

const STANDINGS_URL = 'https://cdn.nba.com/static/json/liveData/standings/standings.json';
const SCHEDULE_URL = 'https://cdn.nba.com/static/json/staticData/scheduleLeagueV2.json';
const BOTTOM_TEAM_COUNT = 12;

const OUTPUT_PATH = path.join(process.cwd(), 'public', 'data', 'latest.json');

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) return date;

  // Handles date strings like 20260208
  if (typeof value === 'string' && /^\d{8}$/.test(value)) {
    const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00Z`;
    const compact = new Date(iso);
    if (!Number.isNaN(compact.getTime())) return compact;
  }

  return null;
}

function deepCollect(root, predicate, out = [], seen = new WeakSet(), depth = 0) {
  if (!root || typeof root !== 'object') return out;
  if (seen.has(root)) return out;
  seen.add(root);
  if (depth > 20) return out;

  if (predicate(root)) out.push(root);

  if (Array.isArray(root)) {
    for (const item of root) deepCollect(item, predicate, out, seen, depth + 1);
    return out;
  }

  for (const value of Object.values(root)) {
    deepCollect(value, predicate, out, seen, depth + 1);
  }

  return out;
}

function normalizeTeamName(teamLike) {
  if (!teamLike || typeof teamLike !== 'object') return null;

  const direct =
    teamLike.teamName ||
    teamLike.fullName ||
    teamLike.name ||
    teamLike.team?.teamName ||
    teamLike.team?.fullName ||
    teamLike.team?.displayName;

  if (direct) return String(direct).trim();

  const city = teamLike.teamCity || teamLike.city || teamLike.team?.city;
  const nickname = teamLike.teamNickname || teamLike.nickname || teamLike.team?.nickname;
  if (city && nickname) return `${String(city).trim()} ${String(nickname).trim()}`;

  return null;
}

function normalizeStandings(standingsJson) {
  const candidates = deepCollect(
    standingsJson,
    (obj) => {
      if (!obj || typeof obj !== 'object') return false;
      const hasId = obj.teamId || obj.team?.teamId || obj.id;
      const hasRecordLike =
        obj.wins !== undefined ||
        obj.losses !== undefined ||
        obj.winPct !== undefined ||
        obj.winPercentage !== undefined;
      return Boolean(hasId && hasRecordLike);
    },
    []
  );

  const byId = new Map();

  for (const c of candidates) {
    const teamId = String(c.teamId || c.team?.teamId || c.id || '');
    if (!teamId) continue;

    const wins = toNumber(c.wins ?? c.win ?? c.w);
    const losses = toNumber(c.losses ?? c.loss ?? c.l);

    let winPct = toNumber(c.winPct ?? c.winPercentage ?? c.win_pct);
    if (winPct === null && wins !== null && losses !== null && wins + losses > 0) {
      winPct = wins / (wins + losses);
    }

    const teamName = normalizeTeamName(c) || normalizeTeamName(c.teamSitesOnly) || c.teamTricode || c.team?.teamTricode;
    if (!teamName || winPct === null) continue;

    const existing = byId.get(teamId);
    const gamesPlayed = (wins ?? 0) + (losses ?? 0);
    const existingGames = existing ? (existing.wins ?? 0) + (existing.losses ?? 0) : -1;

    if (!existing || gamesPlayed >= existingGames) {
      byId.set(teamId, {
        teamId,
        teamName,
        teamTricode: String(c.teamTricode || c.team?.teamTricode || '').trim() || null,
        wins,
        losses,
        winPct,
      });
    }
  }

  return [...byId.values()].sort((a, b) => {
    if (a.winPct !== b.winPct) return a.winPct - b.winPct;
    const aGp = (a.wins ?? 0) + (a.losses ?? 0);
    const bGp = (b.wins ?? 0) + (b.losses ?? 0);
    if (aGp !== bGp) return bGp - aGp;
    return a.teamName.localeCompare(b.teamName);
  });
}

function normalizeGame(gameLike) {
  if (!gameLike || typeof gameLike !== 'object') return null;

  const home = gameLike.homeTeam || gameLike.home || gameLike.hTeam;
  const away = gameLike.awayTeam || gameLike.away || gameLike.vTeam;

  const homeTeamId = String(home?.teamId || home?.team?.teamId || home?.id || '');
  const awayTeamId = String(away?.teamId || away?.team?.teamId || away?.id || '');

  if (!homeTeamId || !awayTeamId) return null;

  const gameId = String(gameLike.gameId || gameLike.gameCode || gameLike.id || `${homeTeamId}_${awayTeamId}_${gameLike.gameDate ?? ''}`);
  const date =
    parseDate(gameLike.gameDateTimeUTC) ||
    parseDate(gameLike.gameDateTimeEst) ||
    parseDate(gameLike.gameDateUTC) ||
    parseDate(gameLike.gameDateEst) ||
    parseDate(gameLike.gameDate) ||
    parseDate(gameLike.startDateEastern);

  const statusValue = toNumber(gameLike.gameStatus ?? gameLike.statusNum ?? gameLike.status);
  const statusTextRaw = String(gameLike.gameStatusText || gameLike.gameStatusTextShort || gameLike.statusText || '').trim();
  const statusText = statusTextRaw.toLowerCase();

  const isFinal = statusValue === 3 || statusText.includes('final');
  const homeTeamName = normalizeTeamName(home) || String(home?.teamTricode || home?.tricode || '').trim() || homeTeamId;
  const awayTeamName = normalizeTeamName(away) || String(away?.teamTricode || away?.tricode || '').trim() || awayTeamId;

  return {
    gameId,
    homeTeamId,
    awayTeamId,
    homeTeamName,
    awayTeamName,
    date,
    isFinal,
    statusText: statusTextRaw || null,
  };
}

function normalizeSchedule(scheduleJson) {
  const rawGames = deepCollect(
    scheduleJson,
    (obj) => Boolean(obj && typeof obj === 'object' && (obj.homeTeam || obj.home) && (obj.awayTeam || obj.away)),
    []
  );

  const unique = new Map();
  for (const g of rawGames) {
    const game = normalizeGame(g);
    if (!game) continue;
    if (!unique.has(game.gameId)) unique.set(game.gameId, game);
  }

  return [...unique.values()];
}

function buildRows(bottomTeams, games) {
  const now = new Date();
  const teamIds = new Set(bottomTeams.map((t) => t.teamId));

  const counts = new Map();
  for (const team of bottomTeams) {
    const row = new Map();
    for (const opp of bottomTeams) {
      if (team.teamId !== opp.teamId) row.set(opp.teamId, 0);
    }
    counts.set(team.teamId, row);
  }

  for (const game of games) {
    const { homeTeamId, awayTeamId, isFinal, date } = game;
    if (!teamIds.has(homeTeamId) || !teamIds.has(awayTeamId)) continue;

    const isInFutureOrUnknown = !date || date >= now;
    if (isFinal || !isInFutureOrUnknown) continue;

    counts.get(homeTeamId).set(awayTeamId, (counts.get(homeTeamId).get(awayTeamId) ?? 0) + 1);
    counts.get(awayTeamId).set(homeTeamId, (counts.get(awayTeamId).get(homeTeamId) ?? 0) + 1);
  }

  const names = new Map(bottomTeams.map((t) => [t.teamId, t.teamName]));

  return bottomTeams.map((team, rankIndex) => {
    const opponentCounts = [...(counts.get(team.teamId)?.entries() ?? [])]
      .map(([oppId, n]) => ({
        opponentTeamId: oppId,
        opponentTeam: names.get(oppId) || oppId,
        gamesRemaining: n,
      }))
      .sort((a, b) => a.opponentTeam.localeCompare(b.opponentTeam));

    const remainingOnly = opponentCounts.filter((x) => x.gamesRemaining > 0);
    const total = remainingOnly.reduce((sum, x) => sum + x.gamesRemaining, 0);

    return {
      rank: rankIndex + 1,
      teamId: team.teamId,
      team: team.teamName,
      teamDisplay: `${team.teamName} (${total})`,
      winPct: team.winPct,
      record: team.wins !== null && team.losses !== null ? `${team.wins}-${team.losses}` : null,
      totalRemainingVsBottom12: total,
      opponents: remainingOnly,
      opponentsText: remainingOnly.map((x) => `${x.opponentTeam} (${x.gamesRemaining})`).join(', '),
    };
  });
}

function dateKey(date, timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function buildTodaySchedule(bottomTeams, games) {
  const easternTimeZone = 'America/New_York';
  const todayDateEt = dateKey(new Date(), easternTimeZone);
  const bottomTeamIds = new Set(bottomTeams.map((team) => team.teamId));
  const bottomTeamNameById = new Map(bottomTeams.map((team) => [team.teamId, team.teamName]));

  const result = [];
  for (const game of games) {
    if (!game.date) continue;
    if (dateKey(game.date, easternTimeZone) !== todayDateEt) continue;
    if (!bottomTeamIds.has(game.homeTeamId) && !bottomTeamIds.has(game.awayTeamId)) continue;

    const trackedTeams = [];
    if (bottomTeamIds.has(game.awayTeamId)) trackedTeams.push(bottomTeamNameById.get(game.awayTeamId) || game.awayTeamName);
    if (bottomTeamIds.has(game.homeTeamId)) trackedTeams.push(bottomTeamNameById.get(game.homeTeamId) || game.homeTeamName);

    result.push({
      gameId: game.gameId,
      matchup: `${game.awayTeamName} at ${game.homeTeamName}`,
      tipoffUtc: game.date.toISOString(),
      trackedTeams,
      status: game.statusText,
    });
  }

  result.sort((a, b) => new Date(a.tipoffUtc).getTime() - new Date(b.tipoffUtc).getTime());
  return {
    timeZone: easternTimeZone,
    dateEt: todayDateEt,
    games: result,
  };
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      'user-agent': 'race-to-the-tank-data-bot/1.0',
      accept: 'application/json,text/plain,*/*',
    },
  });

  if (!res.ok) {
    throw new Error(`Fetch failed: ${url} -> ${res.status}`);
  }

  return res.json();
}

async function main() {
  const [standingsJson, scheduleJson] = await Promise.all([
    fetchJson(STANDINGS_URL),
    fetchJson(SCHEDULE_URL),
  ]);

  const standings = normalizeStandings(standingsJson);
  if (standings.length < BOTTOM_TEAM_COUNT) {
    throw new Error(`Unable to resolve ${BOTTOM_TEAM_COUNT} teams from standings feed.`);
  }

  const bottomTeams = standings.slice(0, BOTTOM_TEAM_COUNT);
  const games = normalizeSchedule(scheduleJson);

  const rows = buildRows(bottomTeams, games);
  const todaySchedule = buildTodaySchedule(bottomTeams, games);

  const payload = {
    app: 'Race to the Tank',
    generatedAt: new Date().toISOString(),
    dataSources: {
      standings: STANDINGS_URL,
      schedule: SCHEDULE_URL,
    },
    todaySchedule,
    rows,
  };

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  console.log(`Wrote ${rows.length} rows to ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
