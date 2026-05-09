import { config } from 'dotenv';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { homedir } from 'os';

config({ path: join(homedir(), '.follow-investors/.env') });

const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
if (proxyUrl) {
  const { setGlobalDispatcher, ProxyAgent } = await import('undici');
  setGlobalDispatcher(new ProxyAgent(proxyUrl));
  console.log(`[Net] using proxy ${proxyUrl}`);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

// --- Constants ---
const TWEET_LOOKBACK_HOURS = 24;
const PODCAST_LOOKBACK_HOURS = 336; // 14 days
const NEWSLETTER_LOOKBACK_HOURS = 72;
const MAX_TWEETS_PER_USER = 5;
const MAX_ARTICLES_PER_SOURCE = 3;
const STATE_FILE = join(ROOT, 'state-feed.json');
const STATE_MAX_AGE_DAYS = 7;
const FETCH_TIMEOUT_MS = 10000;

async function fetchWithTimeout(url, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// --- Config ---
function loadSources() {
  return JSON.parse(readFileSync(join(ROOT, 'config', 'default-sources.json'), 'utf-8'));
}

function loadState() {
  if (!existsSync(STATE_FILE)) return { seenTweets: {}, seenEpisodes: {}, seenArticles: {} };
  return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
}

function saveState(state) {
  const cutoff = Date.now() - STATE_MAX_AGE_DAYS * 86400000;
  for (const [key, store] of Object.entries(state)) {
    if (typeof store === 'object') {
      for (const [id, ts] of Object.entries(store)) {
        if (ts < cutoff) delete store[id];
      }
    }
  }
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// --- X / Twitter via TwitterAPI.io ---
async function fetchTweets(sources, state) {
  const apiKey = process.env.TWITTERAPI_IO_KEY;
  if (!apiKey) {
    console.warn('[X] TWITTERAPI_IO_KEY not set, skipping tweets');
    return { x: [], stats: { xAccounts: 0, totalTweets: 0 } };
  }

  const cutoff = new Date(Date.now() - TWEET_LOOKBACK_HOURS * 3600000);
  const results = [];

  for (const account of sources.x) {
    try {
      // TwitterAPI.io free-tier QPS: 1 req per 5s. Throttle before every fetch.
      await sleep(5500);
      const profileRes = await fetchWithTimeout(
        `https://api.twitterapi.io/twitter/user/info?userName=${account.handle}`,
        { headers: { 'X-API-Key': apiKey } }
      );
      const profileData = await profileRes.json();
      const user = profileData.data || {};

      await sleep(5500);
      const tweetsRes = await fetchWithTimeout(
        `https://api.twitterapi.io/twitter/user/last_tweets?userName=${account.handle}`,
        { headers: { 'X-API-Key': apiKey } }
      );
      const tweetsData = await tweetsRes.json();
      const rawTweets = tweetsData.data?.tweets || [];

      const tweets = rawTweets
        .filter(t => {
          const created = new Date(t.createdAt);
          return created >= cutoff && !state.seenTweets[t.id];
        })
        .map(t => {
          state.seenTweets[t.id] = Date.now();
          return {
            id: t.id,
            text: t.text,
            createdAt: t.createdAt,
            url: `https://x.com/${account.handle}/status/${t.id}`,
            likes: t.likeCount || 0,
            retweets: t.retweetCount || 0,
            replies: t.replyCount || 0,
            isRetweet: !!t.retweeted_tweet,
            isReply: !!t.isReply,
          };
        })
        .filter(t => !t.isRetweet && !t.isReply)
        .slice(0, MAX_TWEETS_PER_USER);

      if (tweets.length > 0) {
        results.push({
          source: 'x',
          handle: account.handle,
          name: account.name,
          role: account.role,
          tag: account.tag,
          bio: user.description || account.note,
          tweets,
        });
      }
    } catch (err) {
      console.error(`[X] Error fetching @${account.handle}:`, err.message);
    }
  }

  return {
    x: results,
    stats: {
      xAccounts: results.length,
      totalTweets: results.reduce((sum, r) => sum + r.tweets.length, 0),
    },
  };
}

// --- Podcasts via RSS ---
async function fetchPodcasts(sources, state) {
  const cutoff = new Date(Date.now() - PODCAST_LOOKBACK_HOURS * 3600000);
  const results = [];

  for (const pod of sources.podcasts) {
    if (!pod.rssUrl) continue;
    try {
      const res = await fetchWithTimeout(pod.rssUrl);
      const xml = await res.text();

      const episodes = parseRssItems(xml)
        .filter(ep => {
          const pub = new Date(ep.pubDate);
          return pub >= cutoff && !state.seenEpisodes[ep.guid];
        })
        .slice(0, 2);

      for (const ep of episodes) {
        state.seenEpisodes[ep.guid] = Date.now();
        results.push({
          source: 'podcast',
          name: pod.name,
          host: pod.host,
          tag: pod.tag,
          title: ep.title,
          guid: ep.guid,
          url: ep.link,
          publishedAt: ep.pubDate,
          description: ep.description,
        });
      }

      await sleep(100);
    } catch (err) {
      console.error(`[Podcast] Error fetching ${pod.name}:`, err.message);
    }
  }

  return {
    podcasts: results,
    stats: { podcastEpisodes: results.length },
  };
}

// --- Newsletters / Blogs via RSS/HTML ---
async function fetchNewsletters(sources, state) {
  const cutoff = new Date(Date.now() - NEWSLETTER_LOOKBACK_HOURS * 3600000);
  const results = [];

  for (const nl of sources.newsletters) {
    try {
      const rssUrl = nl.url.includes('substack.com')
        ? nl.url.replace(/\/$/, '') + '/feed'
        : nl.url.includes('fabricatedknowledge')
          ? 'https://www.fabricatedknowledge.com/feed'
          : null;

      if (!rssUrl) {
        console.log(`[Newsletter] skip ${nl.name}: no RSS mapping for ${nl.url}`);
        continue;
      }

      const res = await fetchWithTimeout(rssUrl);
      const xml = await res.text();
      const articles = parseRssItems(xml)
        .filter(a => {
          const pub = new Date(a.pubDate);
          return pub >= cutoff && !state.seenArticles[a.link];
        })
        .slice(0, MAX_ARTICLES_PER_SOURCE);

      console.log(`[Newsletter] ${nl.name}: ${articles.length} new (RSS ${rssUrl})`);

      for (const a of articles) {
        state.seenArticles[a.link] = Date.now();
        results.push({
          source: 'newsletter',
          name: nl.name,
          author: nl.author,
          tag: nl.tag,
          title: a.title,
          url: a.link,
          publishedAt: a.pubDate,
          description: a.description,
        });
      }

      await sleep(100);
    } catch (err) {
      console.error(`[Newsletter] Error fetching ${nl.name}:`, err.message);
    }
  }

  return {
    newsletters: results,
    stats: { newsletterArticles: results.length },
  };
}

// --- YouTube channel latest videos via Atom feed ---
async function fetchYouTube(sources, state) {
  const cutoff = new Date(Date.now() - PODCAST_LOOKBACK_HOURS * 3600000);
  const results = [];

  for (const yt of sources.youtube) {
    try {
      // Resolve channel ID from handle
      const channelId = await resolveYouTubeChannelId(yt.handle);
      if (!channelId) {
        console.warn(`[YouTube] Could not resolve channel ID for ${yt.handle}`);
        continue;
      }

      const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
      const res = await fetchWithTimeout(feedUrl);
      const xml = await res.text();

      const entries = parseAtomEntries(xml)
        .filter(e => {
          const pub = new Date(e.published);
          return pub >= cutoff && !state.seenEpisodes[e.videoId];
        })
        .slice(0, 3);

      for (const e of entries) {
        state.seenEpisodes[e.videoId] = Date.now();
        results.push({
          source: 'youtube',
          channel: yt.name,
          handle: yt.handle,
          tag: yt.tag,
          title: e.title,
          videoId: e.videoId,
          url: `https://www.youtube.com/watch?v=${e.videoId}`,
          publishedAt: e.published,
        });
      }

      await sleep(100);
    } catch (err) {
      console.error(`[YouTube] Error fetching ${yt.name}:`, err.message);
    }
  }

  return {
    youtube: results,
    stats: { youtubeVideos: results.length },
  };
}

// --- Helpers ---
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseRssItems(xml) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = re.exec(xml)) !== null) {
    const block = match[1];
    items.push({
      title: extractTag(block, 'title'),
      link: extractTag(block, 'link'),
      guid: extractTag(block, 'guid') || extractTag(block, 'link'),
      pubDate: extractTag(block, 'pubDate'),
      description: cleanHtml(extractTag(block, 'description') || ''),
    });
  }
  return items;
}

function parseAtomEntries(xml) {
  const entries = [];
  const re = /<entry>([\s\S]*?)<\/entry>/g;
  let match;
  while ((match = re.exec(xml)) !== null) {
    const block = match[1];
    const videoIdMatch = block.match(/<yt:videoId>(.*?)<\/yt:videoId>/);
    entries.push({
      title: extractTag(block, 'title'),
      videoId: videoIdMatch ? videoIdMatch[1] : null,
      published: extractTag(block, 'published'),
    });
  }
  return entries.filter(e => e.videoId);
}

function extractTag(xml, tag) {
  const cdataRe = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`);
  const cdataMatch = xml.match(cdataRe);
  if (cdataMatch) return cdataMatch[1].trim();

  const re = new RegExp(`<${tag}[^>]*>(.*?)</${tag}>`, 's');
  const m = xml.match(re);
  return m ? m[1].trim() : '';
}

function cleanHtml(html) {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

async function resolveYouTubeChannelId(handle) {
  try {
    const cleanHandle = handle.replace(/^@/, '');
    const res = await fetchWithTimeout(`https://www.youtube.com/@${cleanHandle}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      redirect: 'follow',
    });
    const html = await res.text();
    const m = html.match(/channel_id=([A-Za-z0-9_-]{24})/);
    if (m) return m[1];
    const m2 = html.match(/"channelId":"([A-Za-z0-9_-]{24})"/);
    return m2 ? m2[1] : null;
  } catch {
    return null;
  }
}

// --- Main ---
async function main() {
  const mode = process.argv[2] || 'all';
  const sources = loadSources();
  const state = loadState();
  const now = new Date().toISOString();

  console.log(`[${now}] Starting feed generation (mode: ${mode})`);

  if (mode === 'all' || mode === 'tweets') {
    const tweetFeed = await fetchTweets(sources, state);
    tweetFeed.generatedAt = now;
    tweetFeed.lookbackHours = TWEET_LOOKBACK_HOURS;
    writeFileSync(join(ROOT, 'feed-x.json'), JSON.stringify(tweetFeed, null, 2));
    console.log(`[X] ${tweetFeed.stats.xAccounts} accounts, ${tweetFeed.stats.totalTweets} tweets`);
  }

  if (mode === 'all' || mode === 'podcasts') {
    const podFeed = await fetchPodcasts(sources, state);
    podFeed.generatedAt = now;
    podFeed.lookbackHours = PODCAST_LOOKBACK_HOURS;
    writeFileSync(join(ROOT, 'feed-podcasts.json'), JSON.stringify(podFeed, null, 2));
    console.log(`[Podcast] ${podFeed.stats.podcastEpisodes} episodes`);
  }

  if (mode === 'all' || mode === 'newsletters') {
    const nlFeed = await fetchNewsletters(sources, state);
    nlFeed.generatedAt = now;
    nlFeed.lookbackHours = NEWSLETTER_LOOKBACK_HOURS;
    writeFileSync(join(ROOT, 'feed-newsletters.json'), JSON.stringify(nlFeed, null, 2));
    console.log(`[Newsletter] ${nlFeed.stats.newsletterArticles} articles`);
  }

  if (mode === 'all' || mode === 'youtube') {
    const ytFeed = await fetchYouTube(sources, state);
    ytFeed.generatedAt = now;
    ytFeed.lookbackHours = PODCAST_LOOKBACK_HOURS;
    writeFileSync(join(ROOT, 'feed-youtube.json'), JSON.stringify(ytFeed, null, 2));
    console.log(`[YouTube] ${ytFeed.stats.youtubeVideos} videos`);
  }

  saveState(state);
  console.log('[Done] Feed generation complete');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
