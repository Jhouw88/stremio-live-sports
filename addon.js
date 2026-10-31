const { addonBuilder } = require('stremio-addon-sdk');
const fetch = require('node-fetch').default || global.fetch || require('node-fetch');

const API_BASE = 'https://www.thesportsdb.com/api/v1/json/123';

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
      throw new Error(`Received HTML instead of JSON from ${url}`);
    }

    return JSON.parse(trimmed);
  } catch (err) {
    console.warn(`[provider] Failed to fetch ${url}: ${err.message || err}`);
    return {};
  }
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

  const payload = await fetchJson(`${API_BASE}/all_sports.php`);
  const sports = Array.isArray(payload.sports) ? payload.sports : [];
  const normalized = sports
    .map(s => ({
      id: String(s.idSport || s.strSport || s.name || Math.random()),
      name: s.strSport || s.name || 'Unknown'
    }))
    .filter(s => s.name && s.name !== 'Unknown');

  cache.sports = normalized;
  cache.sportsLastFetched = Date.now();
  return normalized;
}

async function getMatches() {
  if (Date.now() - cache.matchesLastFetched < CACHE_TTL_MATCHES && cache.matches.length > 0) {
    return cache.matches;
  }

  const sports = await getSports();
  const leagueData = await fetchJson(`${API_BASE}/all_leagues.php`);
  const leagues = Array.isArray(leagueData.leagues) ? leagueData.leagues : [];
  const matchList = [];
  const seen = new Set();

  for (const sport of sports) {
    const sportName = sport.name.toLowerCase();
    const relevantLeagues = leagues
      .filter(l => (l.strSport || '').toLowerCase() === sportName)
      .map(l => Number(l.idLeague))
      .filter(Boolean)
      .slice(0, 3);

    for (const leagueId of relevantLeagues) {
      const payload = await fetchJson(`${API_BASE}/eventsnextleague.php?id=${leagueId}`);
      const events = Array.isArray(payload.events) ? payload.events : [];

      for (const event of events) {
        const key = event.idEvent || `${event.idLeague || ''}-${event.strEvent || ''}`;
        if (!key || seen.has(key)) continue;

        const homeTeam = event.strHomeTeam || 'Home';
        const awayTeam = event.strAwayTeam || 'Away';
        const match = {
          id: String(event.idEvent || key),
          title: event.strEvent || `${homeTeam} vs ${awayTeam}`,
          date: event.dateEvent || event.date || event.strTimestamp || new Date().toISOString(),
          category: String(sport.id),
          categoryName: sport.name,
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

        matchList.push(match);
        seen.add(key);
      }
    }
  }

  cache.matches = matchList;
  cache.matchesLastFetched = Date.now();
  return matchList;
}

async function buildManifest() {
  const sports = await getSports();
  const genres = sports.map(s => s.name);
  if (!genres.includes('All')) {
    genres.unshift('All');
  }

  return {
    id: 'org.thesportsdb.sports',
    version: '1.0.0',
    name: 'TheSportsDB Live Sports',
    description: 'Live sports metadata backed by TheSportsDB with browser fallback links.',
    resources: ['catalog', 'meta', 'stream'],
    types: ['tv'],
    idPrefixes: ['tstdb_'],
    catalogs: [
      {
        type: 'tv',
        id: 'tstdb_sports',
        name: 'Live Sports',
        extra: [
          {
            name: 'genre',
            isRequired: false,
            options: genres.length ? genres : ['All']
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
    if (type !== 'tv' || id !== 'tstdb_sports') return { metas: [] };

    let matches = await getMatches();
    const genre = extra && extra.genre;
    if (genre && genre !== 'All') {
      const sports = await getSports();
      const sportId = sports.find(s => s.name === genre)?.id;
      if (sportId) {
        matches = matches.filter(m => m.category === sportId);
      }
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
        poster = 'https://www.thesportsdb.com' + poster;
      }

      return {
        id: 'tstdb_' + match.id,
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
    if (type !== 'tv' || !id.startsWith('tstdb_')) return { meta: {} };

    const matches = await getMatches();
    const matchId = id.replace('tstdb_', '');
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
      poster = 'https://www.thesportsdb.com' + poster;
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
    if (type !== 'tv' || !id.startsWith('tstdb_')) return { streams: [] };

    const matches = await getMatches();
    const matchId = id.replace('tstdb_', '');
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
