const { addonBuilder } = require('stremio-addon-sdk');
const fetch = require('node-fetch').default || global.fetch || require('node-fetch');

const THESPORTSDB_BASE = 'https://www.thesportsdb.com/api/v1/json/123';
const ERGAST_BASE = 'https://ergast.com/api/f1';

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9'
};

async function fetchJson(url) {
  try {
    const response = await fetch(url, { headers: DEFAULT_HEADERS });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status} for ${url}: ${text.slice(0, 200)}`);
    }

    const text = await response.text();
    if (!text || !text.trim()) return {};

    const trimmed = text.trim();
    if (trimmed.startsWith('<')) {
      return {};
    }

    return JSON.parse(trimmed);
  } catch (err) {
    console.warn(`[provider] Failed to fetch ${url}: ${err.message || err}`);
    return {};
  }
}

function toSafeArray(value) {
  return Array.isArray(value) ? value : [];
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

const cache = {
  sports: [],
  sportsLastFetched: 0,
  matches: [],
  matchesLastFetched: 0
};

const CACHE_TTL_SPORTS = 24 * 60 * 60 * 1000;
const CACHE_TTL_MATCHES = 30 * 60 * 1000;

async function getSports() {
  if (Date.now() - cache.sportsLastFetched < CACHE_TTL_SPORTS && cache.sports.length > 0) {
    return cache.sports;
  }

  const sportsPayload = await fetchJson(`${THESPORTSDB_BASE}/all_sports.php`);
  const sports = toSafeArray(sportsPayload.sports);

  const normalized = sports.map(s => ({
    id: String(s.idSport || s.strSport || Math.random()),
    name: normalizeSportName(s.strSport || s.name || 'Unknown')
  })).filter(s => s.name && s.name !== 'Unknown');

  const unique = [];
  const seen = new Set();
  for (const s of normalized) {
    if (!seen.has(s.name)) {
      seen.add(s.name);
      unique.push(s);
    }
  }

  cache.sports = unique;
  cache.sportsLastFetched = Date.now();
  return unique;
}

async function getGeneralMatches() {
  const sports = await getSports();
  const leaguesPayload = await fetchJson(`${THESPORTSDB_BASE}/all_leagues.php`);
  const leagues = toSafeArray(leaguesPayload.leagues);
  const results = [];
  const seen = new Set();

  for (const sport of sports) {
    const sportName = sport.name.toLowerCase();
    const relevantLeagues = leagues
      .filter(l => (l.strSport || '').toLowerCase() === sportName)
      .map(l => Number(l.idLeague))
      .filter(Boolean)
      .slice(0, 3);

    for (const leagueId of relevantLeagues) {
      const payload = await fetchJson(`${THESPORTSDB_BASE}/eventsnextleague.php?id=${leagueId}`);
      const events = toSafeArray(payload.events);

      for (const event of events) {
        const key = event.idEvent || `${event.idLeague || ''}-${event.strEvent || ''}`;
        if (!key || seen.has(key)) continue;

        const homeTeam = event.strHomeTeam || 'Home';
        const awayTeam = event.strAwayTeam || 'Away';
        const match = {
          id: `tdb_${event.idEvent || key}`,
          title: event.strEvent || `${homeTeam} vs ${awayTeam}`,
          date: event.dateEvent || event.date || event.strTimestamp || new Date().toISOString(),
          category: sport.id,
          categoryName: sport.name,
          sportKey: sport.name.toLowerCase(),
          poster: event.strThumb || event.strPoster || event.strEventThumb || null,
          teams: {
            home: { name: homeTeam, badge: event.strHomeTeamBadge || null },
            away: { name: awayTeam, badge: event.strAwayTeamBadge || null }
          },
          sources: [
            {
              source: 'search',
              id: String(event.idEvent || key),
              embedUrl: `https://www.google.com/search?q=${encodeURIComponent(`${homeTeam} ${awayTeam} live stream`)}`
            }
          ]
        };

        results.push(match);
        seen.add(key);
      }
    }
  }

  return results;
}

async function getF1Matches() {
  const payload = await fetchJson(`${ERGAST_BASE}/current.json`);
  const races = toSafeArray(payload.MRData?.RaceTable?.Races);

  return races.map(race => ({
    id: `f1_${race.season}_${race.round}`,
    title: `${race.raceName}`,
    date: race.date ? `${race.date}T${race.time || '00:00:00Z'}` : new Date().toISOString(),
    category: 'f1',
    categoryName: 'F1',
    sportKey: 'f1',
    poster: null,
    teams: {
      home: { name: race.Circuit?.circuitName || 'Circuit', badge: null },
      away: { name: race.season || 'F1', badge: null }
    },
    sources: [
      {
        source: 'search',
        id: `f1_${race.season}_${race.round}`,
        embedUrl: `https://www.google.com/search?q=${encodeURIComponent(`${race.raceName} live stream`)}`
      }
    ]
  }));
}

async function getMatches() {
  if (Date.now() - cache.matchesLastFetched < CACHE_TTL_MATCHES && cache.matches.length > 0) {
    return cache.matches;
  }

  const generalMatches = await getGeneralMatches();
  const f1Matches = await getF1Matches();
  const combined = [...generalMatches, ...f1Matches];

  const deduped = [];
  const seen = new Set();
  for (const match of combined) {
    if (!seen.has(match.id)) {
      deduped.push(match);
      seen.add(match.id);
    }
  }

  cache.matches = deduped;
  cache.matchesLastFetched = Date.now();
  return deduped;
}

async function buildManifest() {
  const sports = await getSports();
  const genres = sports.map(s => s.name);
  if (!genres.includes('All')) genres.unshift('All');
  if (!genres.includes('F1')) genres.push('F1');

  return {
    id: 'org.sports.replacement',
    version: '1.0.0',
    name: 'Multi-Sport Live Catalog',
    description: 'Live sports metadata from public APIs with browser fallback streams.',
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
            options: genres
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
      matches = matches.filter(match => {
        if (genre === 'F1') return match.categoryName === 'F1' || match.sportKey === 'f1';
        return match.categoryName === genre || match.sportKey === genre.toLowerCase();
      });
    }

    const metas = matches.map(match => {
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
        poster: poster,
        description: description
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
        id: id,
        type: 'tv',
        name: match.title,
        posterShape: 'landscape',
        poster: poster,
        description: description,
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
          title: title,
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
        title: title,
        externalUrl: source.embedUrl
      });
    }

    return { streams };
  });

  return builder.getInterface();
}

module.exports = getAddon;
