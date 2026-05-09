# follow-investors · 项目描述

## 1. 项目缘起

### 1.1 问题
做 AI 产业链投资的人每天面对极度过载的信息流：X 推文、播客、Newsletter、YouTube、研报、公众号。绝大多数是观点和情绪，不是信号。判断"该不该跟"耗费的时间常常超过判断"该不该买"。

### 1.2 起点：Zara Zhang 的 "Follow builders, not influencers"
Zara Zhang（[zarazhangrui](https://github.com/zarazhangrui)）在 AI 创作者圈提出：信号来自在造东西的人（有 commit、有产品、有 artifact），不是在讲故事的人。她的 [follow-builders](https://github.com/zarazhangrui/follow-builders) 项目把这个理念工程化——一个跨 X / 播客 / 博客的 AI builder 动态聚合 agent。

### 1.3 平移到投资
本项目把同一理念应用到投资领域：

> **关注用真金白银下注的人，不关注观点贩子。**

筛选标准：有 13F、有公开持仓、有可验证的数据/分析/工具，artifact 存在且可追踪。

### 1.4 目标
- 每天自动抓取 ~24 个一线投资源（基金经理、独立分析师、VC、CEO、播客、Newsletter、YouTube）的最新动态
- 由宿主 LLM（Claude Code）按预设规则生成结构化日报
- 推送到飞书，节省每日信息扫描时间

---

## 2. 设计哲学

### 2.1 三阶段管线（hub-and-spoke）
抓取（中央） → 组装（本地） → 投递（终端）三阶段分离，每个阶段都可独立替换、独立验证、独立失败。这是直接借鉴 follow-builders 的核心架构。

### 2.2 Pipeline 中无 AI
抓取脚本是确定性的：拉 RSS、调 REST API、解析 XML/HTML，**不调用任何 LLM**。摘要工作完全交给宿主 agent（用户机器上的 Claude Code），通过读 `prompts/` 下的 markdown 模板执行。

好处：
- 模型无关：换 LLM 不需改抓取代码
- 成本可控：抓取免费 + LLM 按量
- 可调试：每阶段产物都是 JSON / markdown，肉眼可见

### 2.3 Prompt-as-config
摘要风格、输出结构、过滤规则全部用 `prompts/*.md` 表达，不写进代码。用户要改风格只需改 markdown。

### 2.4 信号分层（六类标签）
每个信息源在 `default-sources.json` 中带一个 `tag` 字段，prompts 按权重处理：

| 标签 | 含义 | 处理权重 |
|---|---|---|
| `一手资金` | 有 13F / 公开持仓的基金经理 | 最高，单独提取 |
| `产业研究` | 数据驱动的独立分析师（SemiAnalysis 等） | 高，提取数据点 |
| `私有市场` | VC、看到公开市场前 6-12 个月的管线 | 高，作为前瞻信号 |
| `叙事温度` | 有资本但也有强观点秀属性 | 中，明确标注为"叙事信号" |
| `中文压缩` | 中文信息整合者 | 中，需交叉验证 |
| `认知框架` | 长对话、深度访谈 | 低（时效性弱），作周末深读 |

---

## 3. 数据流图

```
┌──────────────────────────────────────────────────────────────┐
│  Stage 1 · 中央抓取（GitHub Actions, 每天 06:00 UTC = 14:00 CST）│
│                                                                │
│  scripts/generate-feed.js                                      │
│    ├── fetchTweets()      → TwitterAPI.io REST API             │
│    ├── fetchPodcasts()    → Megaphone / Transistor RSS         │
│    ├── fetchNewsletters() → Substack /feed 端点                 │
│    └── fetchYouTube()     → youtube.com/feeds/videos.xml       │
│                                                                │
│  产出：feed-x.json / feed-podcasts.json /                       │
│       feed-newsletters.json / feed-youtube.json                │
│  状态：state-feed.json（去重，7 天 TTL）                          │
│  提交：自动 commit 回 repo                                       │
└──────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────┐
│  Stage 2 · 本地组装                                            │
│                                                                │
│  scripts/prepare-digest.js                                     │
│    读取所有 feed-*.json + prompts/*.md + ~/.follow-investors/  │
│    合并为单一 JSON 喂给 LLM                                     │
└──────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────┐
│  Stage 3 · LLM 摘要 + 投递                                     │
│                                                                │
│  宿主 agent（Claude Code）读 JSON → 生成 markdown 日报          │
│        ↓                                                       │
│  scripts/deliver.js feishu                                     │
│    POST 飞书 webhook，4000 字自动分块为多张交互卡片              │
└──────────────────────────────────────────────────────────────┘
```

---

## 4. 核心常量与配置

### 4.1 时间窗与限额
| 常量 | 值 | 说明 |
|---|---|---|
| `TWEET_LOOKBACK_HOURS` | 24 | 每日推文回溯窗口 |
| `PODCAST_LOOKBACK_HOURS` | 336 (14 天) | 播客回溯窗口（节目通常一周一更） |
| `NEWSLETTER_LOOKBACK_HOURS` | 72 | Newsletter 回溯窗口 |
| `MAX_TWEETS_PER_USER` | 5 | 单账号上限 |
| `MAX_ARTICLES_PER_SOURCE` | 3 | 单 Newsletter 上限 |
| `STATE_MAX_AGE_DAYS` | 7 | 去重状态保留期 |

### 4.2 配置体系
| 文件 | 作用 | 是否提交 |
|---|---|---|
| `config/default-sources.json` | 信息源清单（10 X + 6 podcast + 4 newsletter + 4 YouTube） | 提交 |
| `prompts/*.md` | 摘要规则模板（可被用户覆盖） | 提交 |
| `~/.follow-investors/config.json` | 用户偏好（语言、时区、投递方式） | 不提交 |
| `~/.follow-investors/.env` | 用户密钥（TwitterAPI.io key、飞书 webhook） | 不提交 |
| `~/.follow-investors/prompts/` | 用户自定义 prompts（可选，覆盖项目默认） | 不提交 |

### 4.3 环境变量加载机制（**重要**）
脚本不会自动加载用户主目录下的 `.env`。`scripts/generate-feed.js`、`scripts/deliver.js`、`scripts/prepare-digest.js` 三个脚本顶部统一通过 `dotenv` 显式指定路径加载：

```js
import { config } from 'dotenv';
import { homedir } from 'os';
import { join } from 'path';
config({ path: join(homedir(), '.follow-investors/.env') });
```

GitHub Actions 不需要这行加载（CI 环境通过 `env:` 块直接注入），但本地运行依赖此机制。

---

## 5. 信息源清单

权威清单：[`01 Materials/AI投资信息源清单.md`](../../memory-work/01%20Materials/AI投资信息源清单.md)（在 memory-work 仓库下）

代码化子集：`config/default-sources.json`，包含：
- **10 个 X 账号**：基金经理（Leopold Aschenbrenner、Brad Gerstner、Gavin Baker、Brett Caughran、Cathie Wood）、宏观（Chamath）、VC（Sarah Guo、Andrew Ng）、独立分析（Dylan Patel、The Last Bear Standing）
- **6 档播客**：In Good Company、Acquired、All-In、No Priors、Invest Like the Best、Odd Lots
- **4 个 Newsletter**：SemiAnalysis、Fabricated Knowledge、Elad Gil Blog、Situational Awareness
- **4 个 YouTube 频道**：Asianometry、ARK Invest、美投讲美股、Real Vision

---

## 6. 成本估算

| 项目 | 估算 | 备注 |
|---|---|---|
| TwitterAPI.io | ~$0.02-0.05/批 × 30 = $0.6-1.5/月 | 按返回 tweet/profile 数计费，每次调用有最低费 |
| GitHub Actions | $0 | 公共仓库或个人免费额度内 |
| 飞书 webhook | $0 | 自定义机器人免费 |
| Claude Code | 主账号订阅成本，无额外开支 | 由用户已有订阅承担 |

⚠️ TwitterAPI.io 的 `count` 参数是否生效未在官方文档明确，实际单次调用返回的 tweet 数可能多于 `MAX_TWEETS_PER_USER`，最终费用以返回数为准。代码层在拿到结果后已用 `.slice()`（待 Phase 2 补） / 时间窗过滤。

---

## 7. 已知限制 / 未来改进

### 7.1 当前限制
- **Newsletter 解析**：URL → RSS 端点的映射在 `fetchNewsletters` 中硬编码，仅识别 substack 子域和 `fabricatedknowledge.com`。新增非 substack 源需改代码
- **未集成播客转录**：原版 follow-builders 用 pod2txt 拉转录文本喂给 LLM；本项目目前仅传递标题 + description，深度受限
- **YouTube 解析脆弱**：`resolveYouTubeChannelId` 依赖 HTML 正则匹配，YouTube 改版会失效
- **去重单机**：`state-feed.json` 是单文件，多机部署需换数据库或对象存储
- **TwitterAPI.io 字段映射**：当前代码假设响应在 `data.tweets` 嵌套层，实际可能是顶层 `tweets`。Phase 2 测试时需按真实响应修正

### 7.2 未来改进方向
- 集成 pod2txt 或自建 Whisper 转录，让播客摘要更深
- 支持自定义 RSS 源（用户可在 `~/.follow-investors/sources.json` 覆盖）
- 增加 13F 持仓变化追踪（独立模块，定期拉 SEC 数据）
- 多投递通道（邮件、Telegram、Slack 并存）

---

## 8. 与 follow-builders 的差异对比

| 维度 | follow-builders | follow-investors |
|---|---|---|
| 主题 | AI builders 动态（创作者、研究者） | AI 投资信号（基金经理、分析师） |
| X 数据源 | 官方 X API（`X_BEARER_TOKEN`） | TwitterAPI.io（成本约 1/30） |
| 播客转录 | pod2txt 集成（深度摘要） | 仅标题+描述（占位） |
| 投递通道 | Telegram / 邮件 / stdout | 飞书 / stdout |
| 标签体系 | 无 | 六类信号标签 |
| 输出语言 | 英文为主，可双语 | 中文为主 |
| 调度 | 每日 6:17 UTC | 每日 6:00 UTC = 14:00 CST |

---

## 9. 关键文件清单

```
follow-investors/
├── .github/workflows/generate-feed.yml   # CI 调度
├── config/default-sources.json           # 信息源清单
├── docs/
│   ├── PROJECT.md                        # 本文档
│   └── TEST_PLAN.md                      # 测试计划
├── prompts/
│   ├── digest-intro.md                   # 整体输出结构
│   ├── summarize-tweets.md
│   ├── summarize-podcasts.md
│   ├── summarize-newsletters.md
│   └── summarize-youtube.md
├── scripts/
│   ├── generate-feed.js                  # Stage 1
│   ├── prepare-digest.js                 # Stage 2
│   ├── deliver.js                        # Stage 3
│   ├── package.json
│   └── package-lock.json                 # 由 npm install 生成，必须提交（CI 用）
├── feed-*.json                           # 由 generate-feed.js 产出
├── state-feed.json                       # 去重状态（自动提交）
├── README.md
├── SKILL.md                              # Claude Code skill 定义
└── package.json
```

---

## 10. 致谢

- [Zara Zhang](https://github.com/zarazhangrui) 提供了核心理念和工程模板
- 信息源清单参考了 SemiAnalysis、ARK Invest、In Good Company 等公开内容
