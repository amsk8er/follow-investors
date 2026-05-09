# follow-investors

AI-powered digest that tracks investment voices in the AI industry chain — fund managers, analysts, VCs, and infrastructure CEOs — across X, podcasts, newsletters, and YouTube.

Inspired by [follow-builders](https://github.com/zarazhangrui/follow-builders) by Zara Zhang.

## How it works

```
Stage 1: Central Feed Generation      Stage 2: Local Assembly      Stage 3: Delivery
(GitHub Actions, daily)               (Your machine)               (Feishu / stdout)

generate-feed.js              →     prepare-digest.js      →     deliver.js
  ├── feed-x.json                    Assembles feeds +            Sends to Feishu
  ├── feed-podcasts.json             prompts into JSON            webhook or prints
  ├── feed-newsletters.json          for LLM to remix            to terminal
  └── feed-youtube.json
```

The system fetches raw content deterministically — **no AI in the pipeline**. Your host agent (Claude Code, etc.) does the summarization using prompt templates.

## Sources

Configured in `config/default-sources.json`:

| Source | Count | Method |
|--------|-------|--------|
| X/Twitter accounts | 10 | TwitterAPI.io |
| Podcasts | 6 | RSS feeds |
| Newsletters | 4 | RSS/Substack feeds |
| YouTube channels | 4 | YouTube Atom feeds |

Each source has a signal tag: `一手资金` (real positions), `产业研究` (data-driven), `私有市场` (VC/private), `叙事温度` (narrative), `中文压缩` (Chinese digest), `认知框架` (deep frameworks).

## Setup

### 1. Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/follow-investors.git
cd follow-investors/scripts && npm install
```

### 2. Set up API keys

Create `~/.follow-investors/.env`:

```env
TWITTERAPI_IO_KEY=your_key_here
FEISHU_WEBHOOK_URL=your_feishu_webhook_url
```

Get your TwitterAPI.io key at [twitterapi.io](https://twitterapi.io/) (pay-per-use, ~$0.02/batch).

### 3. GitHub Actions

Add `TWITTERAPI_IO_KEY` to your repo's Settings → Secrets → Actions.

Feeds are generated daily at 14:00 CST (06:00 UTC). You can also trigger manually via Actions tab.

### 4. Generate digest

```bash
# Run locally (after feeds are generated)
node scripts/prepare-digest.js | your-agent-here | node scripts/deliver.js feishu
```

Or use the Claude Code skill: just say "投资日报" or "investment digest".

## Customization

- **Add/remove sources**: Edit `config/default-sources.json`
- **Change prompts**: Copy `prompts/` files to `~/.follow-investors/prompts/` and edit
- **Delivery**: Feishu webhook or stdout (extensible to email, Telegram, etc.)

## License

MIT
