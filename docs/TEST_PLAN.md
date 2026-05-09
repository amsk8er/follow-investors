# follow-investors · 测试计划

## 测试原则

1. **先免费 → 后付费**：podcast/newsletter/youtube 优先于 X
2. **先小批量 → 后全量**：X 先用 1 个账号探路，确认结构再跑 10 个
3. **状态可回滚**：每个会改 `state-feed.json` 的 Phase 前先备份；失败可恢复，避免去重导致复测假阴性
4. **不暴露 secret**：测试命令不 `cat ~/.follow-investors/.env`，不 `echo $KEY`

## 已识别的代码缺陷（必须在 Phase 0 修复）

| ID | 问题 | 位置 | 修法 |
|---|---|---|---|
| Defect-1 | 脚本不会自动加载 `~/.follow-investors/.env` | `generate-feed.js:42`、`deliver.js:1`、`prepare-digest.js` | 三个脚本顶部用 dotenv 显式指定路径加载（详见 Phase 0.2） |
| Defect-2 | TwitterAPI.io 响应结构与代码假设不匹配 | `generate-feed.js:67` 等 | Phase 2.2 用 curl 探针拿真实结构后改字段映射 |
| Defect-3 | GitHub Actions 必失败 | `.github/workflows/generate-feed.yml` | 提交 `scripts/package-lock.json`；workflow 加 `permissions: contents: write` |

---

## Phase 0：环境准备 + 已知缺陷修复（15 分钟）

### 0.1 基础环境

| 步骤 | 命令 | 验收 |
|---|---|---|
| 0.1.a | `node --version` | ≥ 20 |
| 0.1.b | `cd follow-investors/scripts && npm install` | 生成 `node_modules/` 和 **`package-lock.json`** |
| 0.1.c | `ls ~/.follow-investors/.env`（**不要 cat**） | 文件存在 |
| 0.1.d | 见下方 | 两个布尔值符合预期，**不打印实际值** |

0.1.d 命令（Node 20 ESM 风格）：
```bash
node --input-type=module -e "
import { config } from 'dotenv';
import { homedir } from 'os';
import { join } from 'path';
config({ path: join(homedir(), '.follow-investors/.env') });
console.log('FEISHU set:', !!process.env.FEISHU_WEBHOOK_URL,
            '/ X set:', !!process.env.TWITTERAPI_IO_KEY);
"
```

### 0.2 修 Defect-1（环境变量加载）

修改三个脚本顶部，把现有的 `import 'dotenv/config'` 或缺失的加载替换为：

```js
import { config } from 'dotenv';
import { homedir } from 'os';
import { join } from 'path';
config({ path: join(homedir(), '.follow-investors/.env') });
```

涉及文件：
- `scripts/generate-feed.js`（顶部新加，原本无 dotenv）
- `scripts/deliver.js`（替换 `import 'dotenv/config'`）
- `scripts/prepare-digest.js`（顶部新加，统一风格）

### 0.3 修 Defect-3（GitHub Actions）

1. **提交 lockfile**：确认 `scripts/package-lock.json` 由 0.1.b 生成。打开 `.gitignore`，确保未排除 `package-lock.json`
2. **加权限**：`.github/workflows/generate-feed.yml` 在 `on:` 块和 `jobs:` 块之间加：
   ```yaml
   permissions:
     contents: write
   ```
3. 保留现有的 `npm ci --ignore-scripts`（有 lockfile 即可正常运行）

### 0.4 状态备份机制（约定）

每次测试前若 `state-feed.json` 存在则备份：
```bash
cd follow-investors
[ -f state-feed.json ] && cp state-feed.json state-feed.json.bak || true
```

复测前清状态：
```bash
rm -f state-feed.json
```

### Phase 0 验收

- [ ] 0.1.b 产出 `package-lock.json`
- [ ] 0.1.d 两个变量布尔值都为 `true`
- [ ] 0.2 三个脚本头部统一加上显式 dotenv 加载
- [ ] 0.3 lockfile 已提交准备、workflow 加 `permissions: contents: write`

**回滚**：删 `node_modules`、`package-lock.json` 重做；workflow 用 `git checkout` 回退；脚本头部用 `git checkout` 回退

---

## Phase 1：免费源单跑（10 分钟，零成本）

免费模块**只有 3 个**：podcasts、newsletters、youtube。每次跑前清状态：

```bash
cd follow-investors
rm -f state-feed.json
```

### 1.1 Podcasts

```bash
node scripts/generate-feed.js podcasts
```

**验收**：`feed-podcasts.json` 生成；`stats.podcastEpisodes ≥ 1`（14 天回溯，6 档节目至少 1 档有更新）

**已知风险**：6 个 RSS URL 是基于推测，可能死链或路径错误。

**失败处置**：
```bash
# 检查 HTTP 状态
curl -sI "<rssUrl>" | head -5
# 检查是否返回有效 RSS XML
curl -s "<rssUrl>" | head -50
```
逐个修正 `config/default-sources.json` 中的 `rssUrl` 字段，重跑。

### 1.2 Newsletters

```bash
rm -f state-feed.json
node scripts/generate-feed.js newsletters
```

**已知风险**：
- `fetchNewsletters` 的 URL → RSS 映射只识别 substack 和 fabricatedknowledge，其他源会被静默跳过
- 72 小时窗口可能真实为 0（Newsletter 更新频率低）

**验收**：脚本正常退出。0 条不算失败，但需在控制台输出可解释原因（哪些源被识别、哪些被跳过、各自命中数）。

### 1.3 YouTube

```bash
rm -f state-feed.json
node scripts/generate-feed.js youtube
```

**已知风险**：
- `resolveYouTubeChannelId` 用正则匹配 HTML，YouTube 改版会失效
- `@handle` 写错会拿不到 channelId

**验收**：4 个频道至少 2 个能解析到 channelId；控制台无大量 `Could not resolve` 警告

### Phase 1 整体验收

- [ ] **3 个免费模块至少 2 个产出非空 feed**
- [ ] 任一为空都需有可解释原因（死链 / 自然无更新 / 解析失败）
- [ ] 失败的源已在 `default-sources.json` 旁记录注释或单独 issue，不阻塞下一轮

---

## Phase 2：付费源验证（10 分钟，~$0.05）

### 2.1 拿 key

- 从 [twitterapi.io](https://twitterapi.io/) 控制台拿 key
- 写入 `~/.follow-investors/.env` 的 `TWITTERAPI_IO_KEY=...`
- ⚠️ 不要在终端 `echo`、不要 `cat` 这个文件

### 2.2 探针：验证响应结构（**Defect-2 修复点**）

不跑 `generate-feed.js`，先用 curl 直接打两个端点：

```bash
set +o history   # 防止 key 进 shell history
KEY=$(node --input-type=module -e "
import { config } from 'dotenv';
import { homedir } from 'os';
import { join } from 'path';
config({ path: join(homedir(), '.follow-investors/.env') });
process.stdout.write(process.env.TWITTERAPI_IO_KEY || '');
")

curl -s "https://api.twitterapi.io/twitter/user/info?userName=dylan522p" \
  -H "X-API-Key: $KEY" | jq '.' > /tmp/probe-info.json

curl -s "https://api.twitterapi.io/twitter/user/last_tweets?userName=dylan522p" \
  -H "X-API-Key: $KEY" | jq '.' > /tmp/probe-tweets.json

unset KEY
set -o history
```

**比对清单**（验证后按实际改 `generate-feed.js`）：

| 代码假设 | 待验证（按官方文档可能不同） | 修法 |
|---|---|---|
| `tweetsData.data.tweets` | 顶层 `tweets` | 改为 `tweetsData.tweets` |
| `profileData.data.description` | 顶层 or 嵌套（待确认） | 按实际改 |
| 推文字段 `createdAt` / `likeCount` / `retweetCount` / `replyCount` | 可能是 `created_at` / `favorite_count` 等 snake_case | 按实际改 |
| `?count=N` 参数限制条数 | 文档未列，可能无效 | 改为返回后 `.slice(0, MAX_TWEETS_PER_USER)` |

**修代码**：把 `fetchTweets()` 中的字段映射按 `/tmp/probe-*.json` 实际结构改正，提交。

### 2.3 单账号小批量

```bash
rm -f state-feed.json
# 临时把 sources.x 改成只留 1 个账号
git stash
# 编辑 config/default-sources.json，注释或删除 9 个账号
node scripts/generate-feed.js tweets
```

**验收**：`feed-x.json` 包含 1 个账号、若干推文，字段完整无 undefined

**回滚**：
```bash
git stash pop   # 恢复 sources 配置
```

### 2.4 全量 X

```bash
rm -f state-feed.json
node scripts/generate-feed.js tweets
```

**验收**：10 个账号大部分有内容（24h 窗口允许部分为空）

**成本**：~$0.02-0.05（仅作上限提醒，不阻塞测试）

---

## Phase 3：本地组装（1 分钟，零成本）

```bash
cd follow-investors
node scripts/prepare-digest.js > /tmp/digest-input.json
jq 'keys' /tmp/digest-input.json
jq '.feeds | keys' /tmp/digest-input.json
jq '.prompts | keys' /tmp/digest-input.json
```

**验收**：
- 5 个顶层键：`config / generatedAt / prompts / feeds / sources`
- `feeds` 含 4 子键：`x / podcasts / newsletters / youtube`
- `prompts` 含 5 子键且字符串非空

---

## Phase 4：飞书投递（1 分钟，零成本）

```bash
echo -e "## 测试日报\n\n端到端管线连通测试。" | node scripts/deliver.js feishu
```

**验收**：
- 终端无错误
- 飞书群收到蓝色卡片，标题 "📊 AI 投资日报"，正文 markdown 正确渲染

**已知风险**：如 Defect-1 修复未到位，会报 `FEISHU_WEBHOOK_URL not set`

---

## Phase 5：端到端真实日报（10 分钟，~$0.02）

只在 Phase 1-4 全通过后做。

```bash
cd follow-investors
[ -f state-feed.json ] && cp state-feed.json state-feed.json.bak
rm -f state-feed.json
node scripts/generate-feed.js all
node scripts/prepare-digest.js > /tmp/digest-input.json
```

然后把 `/tmp/digest-input.json` 喂给 Claude Code（同会话或新会话），按 `prompts/digest-intro.md` + `prompts/summarize-*.md` 的规则生成 markdown 日报。

```bash
# 假设 LLM 输出已保存为 /tmp/digest.md
cat /tmp/digest.md | node scripts/deliver.js feishu
```

**验收**：飞书收到结构完整、含真实信号的日报，至少一个数据源有有效内容

---

## Phase 6：GitHub Actions 部署（15 分钟）

只在 Phase 1-5 全通过后做。前置：Defect-3 已在 Phase 0 修复。

### 6.1 推 repo

```bash
cd follow-investors
git init
git add .
# ⚠️ 确认 package-lock.json 已加入；.env 不在仓库内
git commit -m "init: follow-investors v0.1"
git branch -M main
gh repo create follow-investors --public --source=. --remote=origin --push
```

### 6.2 配 secrets

GitHub repo `Settings → Secrets and variables → Actions`：
- 加 `TWITTERAPI_IO_KEY`

### 6.3 手动触发：先用免费 mode

- Actions 页 → "Generate Investment Feed" → "Run workflow"
- 选 mode = `podcasts`
- 检查 logs：
  - `npm ci` 成功（lockfile 存在）
  - feed 生成成功
  - `git push` 成功（permissions 生效）
- 仓库出现新 commit `feed: YYYY-MM-DD`

### 6.4 全量 mode

mode = `all`，验证 4 个 feed-*.json 都被更新

### 6.5 等定时

隔日（CST 14:00 之后）确认 GitHub Actions 自动跑了一次

---

## 测试阶段总览

| Phase | 时间 | 成本 | 阻塞下一阶段 | 关键风险 |
|---|---|---|---|---|
| 0 环境+缺陷修复 | 15min | $0 | 是 | env 加载、lockfile、permissions |
| 1 免费源 | 10min | $0 | 否（≥2/3 即过） | RSS 死链、Substack 检测 |
| 2 X 验证 | 10min | ~$0.05 | 是（结构错则全量浪费） | TwitterAPI.io 字段映射、`count` 参数 |
| 3 组装 | 1min | $0 | 是 | — |
| 4 投递 | 1min | $0 | 是 | env 加载 |
| 5 端到端 | 10min | ~$0.02 | — | LLM 输出质量 |
| 6 CI 部署 | 15min | $0 | — | secrets / push 权限 |

**总成本预算**：< $0.15

---

## 复用 / 复测 提示

- 任何阶段失败后，先看 `state-feed.json` 是否需要清空再重跑
- TwitterAPI.io 的探针响应文件（`/tmp/probe-*.json`）保留几天，便于回看真实字段结构
- Phase 6 触发 workflow 之前，先在本地把 Phase 1-5 全部跑通，避免 CI 调试浪费 token
