const { addonBuilder } = require('stremio-addon-sdk');
const fetch = require('node-fetch').default || global.fetch || require('node-fetch');

const THESPORTSDB_BASE = 'https://www.thesportsdb.com/api/v1/json/123';
const ERGAST_BASE = 'https://ergast.com/api/f1';
const API_FOOTBALL_BASE = 'https://v3.football.api-sports.io';
const SPORTSCORE_BASE = process.env.SPORTSCORE_BASE_URL || '';

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9'
};

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    if (Array.isArray(value.data)) return value.data;
    if (Array.isArray(value.response)) return value.response;
    if (Array.isArray(value.events)) return value.events;
    if (Array.isArray(value.matches)) return value.matches;
    if (Array.isArray(value.results)) return value.results;
  }
  return [];
}

async function fetchJson(url, extraHeaders = {}) {
  try {
    const response = await fetch(url, {
      headers: {
        ...DEFAULT_HEADERS,
        ...extraHeaders
      }
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status} for ${url}: ${text.slice(0, 200)}`);
    }

    const text = await response.text();
    if (!text || !text.trim()) return {};
    const trimmed = text.trim();
    if (trimmed.startsWith('<')) return {};
    return JSON.parse(trimmed);
  } catch (err) {
    console.warn(`[provider] Failed to fetch ${url}: ${err.message || err}`);
    return {};
  }
}

function normalizeSportName(name) {
  if (!name) return 'Other';
  const lower = name.toLowerCase();
  if (lower.includes('football') || lower.includes('soccer')) return 'Soccer';
  if (lower.includes('formula') || lower.includes('f1')) return 'F1';
  if (lower.includes('motorsport') || lower.includes('motor')) return 'Motorsport';
  if (lower.includes('basket')) return 'Basketball';
  if (lower.includes('baseball')) return 'Baseball';
  if (lower.includes('cricket')) return 'Cricket';
  if (lower.includes('tennis')) return 'Tennis';
  if (lower.includes('rugby')) return 'Rugby';
  return name;
}

function makeSearchLink(homeName, awayName, sportName) {
  const q = `${homeName || 'match'} ${awayName || ''} ${sportName || 'live stream'}`.trim();
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

function normalizeBaseMatch(entry, fallbackSportName = 'Soccer') {
  const title = entry.title || entry.name || entry.eventName || entry.raceName || `${entry.homeName || 'Home'} vs ${entry.awayName || 'Away'}`;
  const date = entry.date || entry.start || entry.startTime || entry.match_time || new Date().toISOString();
  const categoryName = entry.categoryName || normalizeSportName(entry.sport || fallbackSportName || 'Soccer');
  const sportKey = (entry.sportKey || categoryName || 'soccer').toLowerCase();

  return {
    id: String(entry.id || `${categoryName}-${Date.now()}-${Math.random()}`),
    title,
    date,
    category: String(entry.category || sportKey),
    categoryName,
    sportKey,
    poster: entry.poster || entry.logo || null,
    teams: {
      home: { name: entry.teams?.home?.name || entry.homeName || 'Home', badge: entry.teams?.home?.badge || entry.homeBadge || null },
      away: { name: entry.teams?.away?.name || entry.awayName || 'Away', badge: entry.teams?.away?.badge || entry.awayBadge || null }
    },
    sources: [
      {
        source: 'search',
        id: String(entry.id || `${categoryName}-${Date.now()}-${Math.random()}`),
        embedUrl: makeSearchLink(entry.teams?.home?.name || entry.homeName, entry.teams?.away?.name || entry.awayName, categoryName)
      }
    ]
  };
}

const cache = {
  sports: [],
  sportsLastFetched: 0,
  matches: [],
  matchesLastFetched: 0
};

const CACHE_TTL_SPORTS = 24 * 60 * 60 * 1000;
const CACHE_TTL_MATCHES = 30 * 60 * 1000;

async function getSportsFromTheSportsDB() {
  const sportsPayload = await fetchJson(`${THESPORTSDB_BASE}/all_sports.php`);
  const sports = toArray(sportsPayload.sports).map(s => ({
    id: String(s.idSport || s.strSport || Math.random()),
    name: normalizeSportName(s.strSport || s.name || 'Unknown')
  })).filter(s => s.name && s.name !== 'Unknown');

  const unique = [];
  const seen = new Set();
  for (const sport of sports) {
    if (!seen.has(sport.name)) {
      seen.add(sport.name);
      unique.push(sport);
    }
  }

  return unique;
}

async function getSports() {
  if (Date.now() - cache.sportsLastFetched < CACHE_TTL_SPORTS && cache.sports.length > 0) {
    return cache.sports;
  }

  const sports = await getSportsFromTheSportsDB();
  const merged = [...new Map([
    ...sports.map(s => [s.name, s]),
    ['Soccer', { id: 'soccer', name: 'Soccer' }],
    ['F1', { id: 'f1', name: 'F1' }]
  ].map(([k, v]) => [k, v])).values()];

  cache.sports = merged;
  cache.sportsLastFetched = Date.now();
  return merged;
}

async function getApiFootballMatches() {
  const apiKey = process.env.API_FOOTBALL_KEY;
  if (!apiKey) return [];

  const url = `${API_FOOTBALL_BASE}/fixtures?live=all`;
  const payload = await fetchJson(url, {
    'x-rapidapi-key': apiKey,
    'x-rapidapi-host': 'v3.football.api-sports.io'
  });

  const fixtures = toArray(payload.response);
  return fixtures.map((f) => {
    const home = f.teams?.home || {};
    const away = f.teams?.away || {};
    const league = f.league || {};
    return normalizeBaseMatch({
      id: `api_fut_${f.fixture?.id || f.id || `${home.name || 'home'}-${away.name || 'away'}`}`,
      title: `${home.name || 'Home'} vs ${away.name || 'Away'}`,
      date: f.fixture?.date || f.date || new Date().toISOString(),
      categoryName: league.name || 'Soccer',
      sport: 'football',
      sportKey: 'soccer',
      category: 'soccer',
      poster: home.logo || away.logo || null,
      teams: {
        home: { name: home.name || 'Home', badge: home.logo || null },
        away: { name: away.name || 'Away', badge: away.logo || null }
      }
    }, 'Soccer');
  });
}

async function getSportScoreMatches() {
  if (!SPORTSCORE_BASE) return [];

  const urls = [
    `${SPORTSCORE_BASE}/api/v1/football/scores/live`,
    `${SPORTSCORE_BASE}/api/v1/football/fixtures`,
    `${SPORTSCORE_BASE}/api/v1/sports` 
  ];

  for (const url of urls) {
    const payload = await fetchJson(url, process.env.SPORTSCORE_API_KEY ? { Authorization: `Bearer ${process.env.SPORTSCORE_API_KEY}` } : {});
    const items = toArray(payload);
    const records = items.filter(item => {
      if (!item) return false;
      const maybe = item.data || item.matches || item.events || item.results || item.records || item.games;
      return !!maybe;
    });

    if (records.length === 0 && Object.keys(payload).length > 0) {
      const nested = toArray(payload.data || payload.matches || payload.events || payload.results || payload.records || payload.games);
      if (nested.length > 0) {
        const out = nested.map((item) => {
          const home = item.home_team || item.homeTeam || item.home || item.teamA || item.teams?.home || {};
          const away = item.away_team || item.awayTeam || item.away || item.teamB || item.teams?.away || {};
          return normalizeBaseMatch({
            id: item.id || `${home.name || 'home'}-${away.name || 'away'}`,
            title: item.name || item.title || `${home.name || 'Home'} vs ${away.name || 'Away'}`,
            date: item.start || item.date || item.scheduled || item.time || new Date().toISOString(),
            categoryName: normalizeSportName(item.sport || item.category || 'Soccer'),
            sport: item.sport || item.category || 'Soccer',
            sportKey: (item.sport || 'soccer').toLowerCase(),
            category: (item.sport || 'soccer').toLowerCase(),
            poster: item.poster || item.badge || home.logo || away.logo || null,
            teams: {
              home: { name: home.name || home.team || 'Home', badge: home.badge || home.logo || null },
              away: { name: away.name || away.team || 'Away', badge: away.badge || away.logo || null }
            }
          }, normalizeSportName(item.sport || 'Soccer'));
        });
        if (out.length > 0) return out;
      }
    }
  }

  return [];
}

async function getF1Matches() {
  const payload = await fetchJson(`${ERGAST_BASE}/current.json`);
  const races = toArray(payload.MRData?.RaceTable?.Races);

  return races.map((race) => normalizeBaseMatch({
    id: `f1_${race.season}_${race.round}`,
    title: race.raceName || 'F1 Race',
    date: race.date ? `${race.date}T${race.time || '00:00:00Z'}` : new Date().toISOString(),
    categoryName: 'F1',
    sport: 'f1',
    sportKey: 'f1',
    category: 'f1',
    poster: null,
    teams: {
      home: { name: race.Circuit?.circuitName || 'Circuit', badge: null },
      away: { name: race.season || 'F1', badge: null }
    }
  }, 'F1'));
}

async function getFallbackMatches() {
  const payload = await fetchJson(`${THESPORTSDB_BASE}/all_leagues.php`);
  const leagues = toArray(payload.leagues);
  const results = [];
  const seen = new Set();

  for (const league of leagues.slice(0, 12)) {
    const leagueId = Number(league.idLeague);
    if (!leagueId) continue;

    const eventsPayload = await fetchJson(`${THESPORTSDB_BASE}/eventsnextleague.php?id=${leagueId}`);
    const events = toArray(eventsPayload.events);

    for (const event of events) {
      const key = event.idEvent || `${event.idLeague || ''}-${event.strEvent || ''}`;
      if (!key || seen.has(key)) continue;
      const homeName = event.strHomeTeam || 'Home';
      const awayName = event.strAwayTeam || 'Away';
      const sportName = normalizeSportName(event.strSport || league.strSport || 'Soccer');
      const match = normalizeBaseMatch({
        id: `fallback_${event.idEvent || key}`,
        title: event.strEvent || `${homeName} vs ${awayName}`,
        date: event.dateEvent || event.date || event.strTimestamp || new Date().toISOString(),
        categoryName: sportName,
        sport: sportName,
        sportKey: sportName.toLowerCase(),
        category: sportName.toLowerCase(),
        poster: event.strThumb || event.strPoster || event.strEventThumb || null,
        teams: {
          home: { name: homeName, badge: event.strHomeTeamBadge || null },
          away: { name: awayName, badge: event.strAwayTeamBadge || null }
        }
      }, sportName);

      results.push(match);
      seen.add(key);
    }
  }

  return results;
}

async function getMatches() {
  if (Date.now() - cache.matchesLastFetched < CACHE_TTL_MATCHES && cache.matches.length > 0) {
    return cache.matches;
  }

  const providers = [
    getApiFootballMatches(),
    getSportScoreMatches(),
    getF1Matches(),
    getFallbackMatches()
  ];

  const providerResults = await Promise.all(providers);
  const merged = providerResults.flat();

  const deduped = [];
  const seen = new Set();
  for (const match of merged) {
    if (!match || !match.title) continue;
    const key = `${match.categoryName}:${match.title}:${match.date}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(match);
    }
  }

  cache.matches = deduped;
  cache.matchesLastFetched = Date.now();
  return deduped;
}

async function buildManifest() {
  const sports = await getSports();
  const options = sports.map(s => s.name).filter(Boolean);
  if (!options.includes('All')) options.unshift('All');
  if (!options.includes('F1')) options.push('F1');

  return {
    id: 'org.multi.sports',
    version: '1.0.0',
    name: 'Multi-Sport Live Catalog',
    description: 'Soccer, F1 and broader sports metadata from public APIs with browser fallback streams.',
    resources: ['catalog', 'meta', 'stream'],
    types: ['tv'],
    idPrefixes: ['sports_'],
    catalogs: [
      {
        type: 'tv',
        id: 'sports_catalog',
        name: 'Live Sports',
        extra: [
          {
            name: 'genre',
            isRequired: false,
            options: options
          }
        ]
      }
    ]
  };
}

const puppeteer = require('puppeteer');

let browserPromise = null;
async function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: 'new',
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath(),
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
  }
  return browserPromise;
}

const resolvedStreamsCache = {};

async function extractM3u8(embedUrl) {
  if (!embedUrl) return null;

  if (resolvedStreamsCache[embedUrl]) {
    if (Date.now() - resolvedStreamsCache[embedUrl].time < 2 * 60 * 60 * 1000) {
      return resolvedStreamsCache[embedUrl].m3u8;
    }
  }

  let page;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    let m3u8Url = null;

    const timeoutPromise = new Promise(resolve => setTimeout(resolve, 15000));
    const m3u8Promise = new Promise(resolve => {
      page.on('request', request => {
        if (request.url().includes('.m3u8')) {
          const url = request.url();
          if (!m3u8Url) {
            m3u8Url = url;
            resolve(url);
          }
        }
      });
    });

    try {
      await page.goto(embedUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    } catch (e) {}

    await Promise.race([m3u8Promise, timeoutPromise]);
    await page.close().catch(() => {});

    if (m3u8Url) {
      resolvedStreamsCache[embedUrl] = { m3u8: m3u8Url, time: Date.now() };
    }

    return m3u8Url;
  } catch (e) {
    if (page) await page.close().catch(() => {});
    return null;
  }
}

async function getAddon() {
  const manifest = await buildManifest();
  const builder = new addonBuilder(manifest);

  builder.defineCatalogHandler(async ({ type, id, extra }) => {
    if (type !== 'tv' || id !== 'sports_catalog') return { metas: [] };

    let matches = await getMatches();
    const genre = extra && extra.genre;
    if (genre && genre !== 'All') {
      matches = matches.filter((match) => {
        if (genre === 'F1') return match.categoryName === 'F1' || match.sportKey === 'f1';
        return match.categoryName === genre || match.sportKey === genre.toLowerCase();
      });
    }

    const metas = matches.map((match) => {
      let description = `Match: ${match.title}\n`;
      if (match.teams?.home && match.teams?.away) {
        description += `${match.teams.home.name} vs ${match.teams.away.name}\n`;
      }
      description += `Start Time: ${new Date(match.date).toLocaleString()}\n`;
      description += `Sport: ${match.categoryName || 'Unknown'}`;

      let poster = match.poster || (match.teams?.home?.badge || null);
      if (poster && poster.startsWith('/')) {
        poster = `https://www.thesportsdb.com${poster}`;
      }

      return {
        id: 'sports_' + match.id,
        type: 'tv',
        name: match.title,
        posterShape: 'landscape',
        poster,
        description
      };
    });

    return { metas };
  });

  builder.defineMetaHandler(async ({ type, id }) => {
    if (type !== 'tv' || !id.startsWith('sports_')) return { meta: {} };

    const matches = await getMatches();
    const matchId = id.replace('sports_', '');
    const match = matches.find(m => m.id === matchId);
    if (!match) return { meta: {} };

    let description = `Match: ${match.title}\n`;
    if (match.teams?.home && match.teams?.away) {
      description += `${match.teams.home.name} vs ${match.teams.away.name}\n`;
    }
    description += `Start: ${new Date(match.date).toLocaleString()}\n`;
    description += `Sport: ${match.categoryName || 'Unknown'}`;

    let poster = match.poster || (match.teams?.home?.badge || null);
    if (poster && poster.startsWith('/')) {
      poster = `https://www.thesportsdb.com${poster}`;
    }

    return {
      meta: {
        id,
        type: 'tv',
        name: match.title,
        posterShape: 'landscape',
        poster,
        description,
        background: poster
      }
    };
  });

  builder.defineStreamHandler(async ({ type, id }) => {
    if (type !== 'tv' || !id.startsWith('sports_')) return { streams: [] };

    const matches = await getMatches();
    const matchId = id.replace('sports_', '');
    const match = matches.find(m => m.id === matchId);
    if (!match || !match.sources) return { streams: [] };

    const streams = [];
    let extractedM3u8 = null;
    let refererUrl = 'https://www.google.com/';
    const bestStream = match.sources.find(s => s && s.embedUrl);

    if (bestStream && bestStream.embedUrl && bestStream.embedUrl.startsWith('http')) {
      extractedM3u8 = await extractM3u8(bestStream.embedUrl);
      try {
        refererUrl = new URL(bestStream.embedUrl).origin + '/';
      } catch (e) {}
    }

    for (const source of match.sources) {
      if (!source || !source.embedUrl) continue;
      const isBestStream = source === bestStream;
      const title = `Search stream (${source.source.toUpperCase()})`;

      if (isBestStream && extractedM3u8) {
        streams.push({
          name: 'Search (Direct)',
          title,
          url: extractedM3u8,
          behaviorHints: {
            notWebReady: true,
            proxyHeaders: {
              request: {
                'Referer': refererUrl,
                'Origin': refererUrl,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
              }
            }
          }
        });
      }

      streams.push({
        name: 'Search Stream',
        title,
        externalUrl: source.embedUrl
      });
    }

    return { streams };
  });

  return builder.getInterface();
}

module.exports = getAddon;
