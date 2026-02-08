import fs from 'node:fs/promises';
import path from 'node:path';

const STANDINGS_URL = 'https://cdn.nba.com/static/json/liveData/standings/standings.json';
const SCHEDULE_URL = 'https://cdn.nba.com/static/json/staticData/scheduleLeagueV2.json';
const ESPN_STANDINGS_URL = 'https://site.api.espn.com/apis/v2/sports/basketball/nba/standings';
const ESPN_TEAM_SCHEDULE_BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams';
const BOTTOM_TEAM_COUNT = 14;
const FETCH_TIMEOUT_MS = 25000;
const FETCH_ATTEMPTS = 4;
const ESPN_FETCH_ATTEMPTS = 2;

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

    const streak = deriveStreakFromCandidate(c);
    const last10 = deriveLastTenFromCandidate(c);

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
        streak,
        last10,
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

function readStat(stats, ...names) {
  if (!Array.isArray(stats)) return null;

  const statMap = new Map();
  for (const stat of stats) {
    const key = String(stat?.name || '').trim().toLowerCase();
    if (!key) continue;
    statMap.set(key, stat);
    const abbrKey = String(stat?.abbreviation || '').trim().toLowerCase();
    if (abbrKey) statMap.set(abbrKey, stat);
  }

  for (const name of names) {
    const stat = statMap.get(String(name).toLowerCase());
    const value = toNumber(stat?.value ?? stat?.displayValue);
    if (value !== null && value !== undefined) return value;
  }

  return null;
}

function readStatDisplay(stats, ...names) {
  if (!Array.isArray(stats)) return null;

  const statMap = new Map();
  for (const stat of stats) {
    const key = String(stat?.name || '').trim().toLowerCase();
    if (!key) continue;
    statMap.set(key, stat);
    const abbrKey = String(stat?.abbreviation || '').trim().toLowerCase();
    if (abbrKey) statMap.set(abbrKey, stat);
  }

  for (const name of names) {
    const stat = statMap.get(String(name).toLowerCase());
    const text = String(stat?.displayValue ?? stat?.value ?? '').trim();
    if (text) return text;
  }

  return null;
}

function normalizeStreak(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) return null;
  const compact = raw.replaceAll(' ', '');
  if (/^[WL]\d+$/.test(compact)) return compact;
  return null;
}

function normalizeLastTen(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const match = raw.match(/(\d+)\s*-\s*(\d+)/);
  if (!match) return null;
  return `${match[1]}-${match[2]}`;
}

function deriveStreakFromCandidate(candidate) {
  const direct = normalizeStreak(
    candidate?.streak ||
      candidate?.currentStreak ||
      candidate?.teamStreak ||
      candidate?.team?.streak ||
      candidate?.teamSitesOnly?.streak
  );
  if (direct) return direct;

  const winStreak = toNumber(candidate?.winStreak ?? candidate?.team?.winStreak);
  if (winStreak !== null && winStreak > 0) return `W${winStreak}`;

  const lossStreak = toNumber(candidate?.lossStreak ?? candidate?.team?.lossStreak);
  if (lossStreak !== null && lossStreak > 0) return `L${lossStreak}`;

  return null;
}

function deriveLastTenFromCandidate(candidate) {
  const direct = normalizeLastTen(
    candidate?.lastTen ||
      candidate?.lastTenRecord ||
      candidate?.l10 ||
      candidate?.team?.lastTen ||
      candidate?.teamSitesOnly?.lastTen
  );
  if (direct) return direct;

  const wins = toNumber(candidate?.lastTenWins ?? candidate?.last10Wins);
  const losses = toNumber(candidate?.lastTenLosses ?? candidate?.last10Losses);
  if (wins !== null && losses !== null) return `${wins}-${losses}`;

  return null;
}

function normalizeEspnStandings(standingsJson) {
  const entries = [];
  for (const child of standingsJson?.children ?? []) {
    if (Array.isArray(child?.standings?.entries)) {
      entries.push(...child.standings.entries);
    }
  }

  const byId = new Map();
  for (const entry of entries) {
    const teamId = String(entry?.team?.id || '').trim();
    const teamName = String(entry?.team?.displayName || entry?.team?.name || '').trim();
    if (!teamId || !teamName) continue;

    const wins = readStat(entry?.stats, 'wins');
    const losses = readStat(entry?.stats, 'losses');
    let winPct = readStat(entry?.stats, 'winpercent', 'leaguewinpercent');
    if (winPct === null && wins !== null && losses !== null && wins + losses > 0) {
      winPct = wins / (wins + losses);
    }
    if (winPct === null) continue;

    const streak = normalizeStreak(readStatDisplay(entry?.stats, 'streak', 'strk'));
    const last10 = normalizeLastTen(readStatDisplay(entry?.stats, 'last ten games', 'l10', 'last10'));

    const existing = byId.get(teamId);
    const gamesPlayed = (wins ?? 0) + (losses ?? 0);
    const existingGames = existing ? (existing.wins ?? 0) + (existing.losses ?? 0) : -1;

    if (!existing || gamesPlayed >= existingGames) {
      byId.set(teamId, {
        teamId,
        teamName,
        wins,
        losses,
        winPct,
        streak,
        last10,
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

function normalizeEspnGame(eventLike) {
  if (!eventLike || typeof eventLike !== 'object') return null;
  const competition = eventLike?.competitions?.[0];
  const competitors = Array.isArray(competition?.competitors) ? competition.competitors : [];
  if (competitors.length < 2) return null;

  const home = competitors.find((c) => c?.homeAway === 'home') || competitors[0];
  const away = competitors.find((c) => c?.homeAway === 'away') || competitors[1];

  const homeTeamId = String(home?.team?.id || '').trim();
  const awayTeamId = String(away?.team?.id || '').trim();
  if (!homeTeamId || !awayTeamId) return null;

  const statusName = String(competition?.status?.type?.name || '').trim();
  const statusDetail = String(
    competition?.status?.type?.detail ||
      competition?.status?.type?.shortDetail ||
      competition?.status?.type?.description ||
      ''
  ).trim();
  const statusText = statusDetail || statusName || null;

  const completed = Boolean(competition?.status?.type?.completed);
  const isFinal = completed || statusName.toLowerCase().includes('final');

  return {
    gameId: String(eventLike?.id || competition?.id || `${awayTeamId}_${homeTeamId}_${eventLike?.date || ''}`),
    homeTeamId,
    awayTeamId,
    homeTeamName: String(home?.team?.displayName || home?.team?.name || home?.team?.abbreviation || homeTeamId),
    awayTeamName: String(away?.team?.displayName || away?.team?.name || away?.team?.abbreviation || awayTeamId),
    date: parseDate(eventLike?.date || competition?.date),
    isFinal,
    statusText,
  };
}

function normalizeEspnSchedule(schedulePayloads) {
  const unique = new Map();

  for (const payload of schedulePayloads) {
    const events = Array.isArray(payload?.events) ? payload.events : [];
    for (const eventLike of events) {
      const game = normalizeEspnGame(eventLike);
      if (!game) continue;
      if (!unique.has(game.gameId)) unique.set(game.gameId, game);
    }
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
      streak: team.streak || null,
      last10: team.last10 || null,
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

function buildUpcomingSchedule(bottomTeams, games) {
  const easternTimeZone = 'America/New_York';
  const today = new Date();

  const dayKeys = [];
  for (let offset = 0; offset < 3; offset += 1) {
    const day = new Date(today.getTime() + offset * 24 * 60 * 60 * 1000);
    dayKeys.push(dateKey(day, easternTimeZone));
  }

  const daySet = new Set(dayKeys);
  const bottomTeamIds = new Set(bottomTeams.map((team) => team.teamId));
  const bottomTeamNameById = new Map(bottomTeams.map((team) => [team.teamId, team.teamName]));

  const dayGames = new Map(dayKeys.map((key) => [key, []]));

  for (const game of games) {
    if (!game.date) continue;
    const gameDayKey = dateKey(game.date, easternTimeZone);
    if (!daySet.has(gameDayKey)) continue;
    if (!bottomTeamIds.has(game.homeTeamId) && !bottomTeamIds.has(game.awayTeamId)) continue;

    const trackedTeams = [];
    if (bottomTeamIds.has(game.awayTeamId)) trackedTeams.push(bottomTeamNameById.get(game.awayTeamId) || game.awayTeamName);
    if (bottomTeamIds.has(game.homeTeamId)) trackedTeams.push(bottomTeamNameById.get(game.homeTeamId) || game.homeTeamName);

    dayGames.get(gameDayKey).push({
      gameId: game.gameId,
      matchup: `${game.awayTeamName} at ${game.homeTeamName}`,
      tipoffUtc: game.date.toISOString(),
      trackedTeams,
      status: game.statusText,
    });
  }

  for (const key of dayKeys) {
    dayGames.get(key).sort((a, b) => new Date(a.tipoffUtc).getTime() - new Date(b.tipoffUtc).getTime());
  }

  return {
    timeZone: easternTimeZone,
    days: dayKeys.map((dateEt) => ({
      dateEt,
      games: dayGames.get(dateEt) || [],
    })),
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function classifyFetchError(error) {
  const cause = error?.cause;
  const code = cause?.code || error?.code || '';
  const message = String(error?.message || '').toLowerCase();

  return {
    code,
    isNetworkLike:
      code === 'ETIMEDOUT' ||
      code === 'ECONNRESET' ||
      code === 'ECONNREFUSED' ||
      code === 'EAI_AGAIN' ||
      code === 'ENOTFOUND' ||
      message.includes('fetch failed') ||
      message.includes('network') ||
      message.includes('timed out') ||
      message.includes('aborted'),
  };
}

async function fetchJson(url, attempts = FETCH_ATTEMPTS) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'user-agent': 'race-to-the-tank-data-bot/1.0',
          accept: 'application/json,text/plain,*/*',
        },
      });

      if (!res.ok) {
        throw new Error(`Fetch failed: ${url} -> ${res.status}`);
      }

      return await res.json();
    } catch (error) {
      lastError = error;
      const { isNetworkLike, code } = classifyFetchError(error);
      const waitMs = 1200 * attempt;
      if (attempt < attempts) {
        const codeText = code ? ` (${code})` : '';
        console.warn(`Fetch retry ${attempt}/${attempts} for ${url}${codeText}. Waiting ${waitMs}ms...`);
        await sleep(waitMs);
      } else {
        console.warn(`Fetch exhausted retries for ${url}.`);
      }

      if (!isNetworkLike && attempt >= attempts) break;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError;
}

async function readCachedPayload() {
  try {
    const raw = await fs.readFile(OUTPUT_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.rows)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writePayload(payload) {
  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function buildLivePayload({ rows, todaySchedule, provider, dataSources }) {
  const generatedAt = new Date().toISOString();
  return {
    app: 'Race to the Tank',
    generatedAt,
    dataSources,
    refreshStatus: {
      source: 'live',
      provider,
      attemptedAt: generatedAt,
    },
    todaySchedule,
    rows,
  };
}

async function loadFromEspn() {
  const standingsJson = await fetchJson(ESPN_STANDINGS_URL, ESPN_FETCH_ATTEMPTS);
  const standings = normalizeEspnStandings(standingsJson);
  if (standings.length < BOTTOM_TEAM_COUNT) {
    throw new Error(`Unable to resolve ${BOTTOM_TEAM_COUNT} teams from ESPN standings.`);
  }

  const bottomTeams = standings.slice(0, BOTTOM_TEAM_COUNT);
  const schedulePayloads = await Promise.all(
    bottomTeams.map((team) =>
      fetchJson(`${ESPN_TEAM_SCHEDULE_BASE}/${team.teamId}/schedule?seasontype=2`, ESPN_FETCH_ATTEMPTS)
    )
  );

  const games = normalizeEspnSchedule(schedulePayloads);
  const rows = buildRows(bottomTeams, games);
  const todaySchedule = buildUpcomingSchedule(bottomTeams, games);

  return buildLivePayload({
    rows,
    todaySchedule,
    provider: 'espn',
    dataSources: {
      standings: ESPN_STANDINGS_URL,
      schedule: `${ESPN_TEAM_SCHEDULE_BASE}/{teamId}/schedule?seasontype=2`,
    },
  });
}

async function loadFromNba() {
  const [standingsJson, scheduleJson] = await Promise.all([
    fetchJson(STANDINGS_URL),
    fetchJson(SCHEDULE_URL),
  ]);

  const standings = normalizeStandings(standingsJson);
  if (standings.length < BOTTOM_TEAM_COUNT) {
    throw new Error(`Unable to resolve ${BOTTOM_TEAM_COUNT} teams from NBA standings feed.`);
  }

  const bottomTeams = standings.slice(0, BOTTOM_TEAM_COUNT);
  const games = normalizeSchedule(scheduleJson);
  const rows = buildRows(bottomTeams, games);
  const todaySchedule = buildUpcomingSchedule(bottomTeams, games);

  return buildLivePayload({
    rows,
    todaySchedule,
    provider: 'nba',
    dataSources: {
      standings: STANDINGS_URL,
      schedule: SCHEDULE_URL,
    },
  });
}

async function loadLivePayload() {
  const loaders = [
    { name: 'espn', fn: loadFromEspn },
    { name: 'nba', fn: loadFromNba },
  ];

  let lastError = null;
  for (const loader of loaders) {
    try {
      const payload = await loader.fn();
      console.log(`Live data source selected: ${loader.name}`);
      return payload;
    } catch (error) {
      lastError = error;
      console.warn(`Live source ${loader.name} failed: ${error?.message || error}`);
    }
  }

  throw lastError || new Error('No live data source succeeded.');
}

async function main() {
  try {
    const payload = await loadLivePayload();
    await writePayload(payload);
    console.log(`Wrote ${payload.rows.length} rows to ${OUTPUT_PATH}`);
  } catch (error) {
    const { isNetworkLike, code } = classifyFetchError(error);

    const cached = await readCachedPayload();
    if (!cached) throw error;

    const cachedAt = cached.generatedAt || 'unknown timestamp';
    const codeText = code ? ` (${code})` : '';
    console.warn(`Using cached data from ${cachedAt} because upstream fetch timed out${codeText}.`);

    const fallbackPayload = {
      ...cached,
      refreshStatus: {
        source: 'cached',
        provider: cached?.refreshStatus?.provider || null,
        attemptedAt: new Date().toISOString(),
        lastLiveGeneratedAt: cached.generatedAt || null,
        reasonType: isNetworkLike ? 'network' : 'processing',
        reasonCode: code || null,
      },
    };

    await writePayload(fallbackPayload);
    console.warn('Wrote cached payload with refreshStatus=cached.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
