import { config } from 'dotenv';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { homedir } from 'os';

config({ path: join(homedir(), '.follow-investors/.env') });

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');
const USER_DIR = join(homedir(), '.follow-investors');
const GITHUB_RAW_BASE = process.env.GITHUB_RAW_BASE || null;

function loadJson(filename) {
  // Priority: GitHub raw (if configured) > local file
  const localPath = join(ROOT, filename);
  if (existsSync(localPath)) {
    return JSON.parse(readFileSync(localPath, 'utf-8'));
  }
  return null;
}

function loadPrompt(name) {
  // Priority: user custom > local shipped
  const userPath = join(USER_DIR, 'prompts', name);
  if (existsSync(userPath)) return readFileSync(userPath, 'utf-8');

  const localPath = join(ROOT, 'prompts', name);
  if (existsSync(localPath)) return readFileSync(localPath, 'utf-8');

  return '';
}

function loadUserConfig() {
  const configPath = join(USER_DIR, 'config.json');
  if (existsSync(configPath)) {
    return JSON.parse(readFileSync(configPath, 'utf-8'));
  }
  return {
    language: 'zh',
    timezone: 'Asia/Shanghai',
    frequency: 'daily',
    delivery: { method: 'feishu' },
  };
}

function main() {
  const config = loadUserConfig();

  const digest = {
    config,
    generatedAt: new Date().toISOString(),
    prompts: {
      digestIntro: loadPrompt('digest-intro.md'),
      summarizeTweets: loadPrompt('summarize-tweets.md'),
      summarizePodcasts: loadPrompt('summarize-podcasts.md'),
      summarizeNewsletters: loadPrompt('summarize-newsletters.md'),
      summarizeYoutube: loadPrompt('summarize-youtube.md'),
    },
    feeds: {
      x: loadJson('feed-x.json'),
      podcasts: loadJson('feed-podcasts.json'),
      newsletters: loadJson('feed-newsletters.json'),
      youtube: loadJson('feed-youtube.json'),
    },
    sources: loadJson('config/default-sources.json'),
  };

  process.stdout.write(JSON.stringify(digest, null, 2));
}

main();
