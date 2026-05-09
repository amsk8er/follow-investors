# architecture.md · 信号处理架构

> 本文档与 [`PROJECT.md`](./PROJECT.md) 互补。
> - **PROJECT.md** 描述「项目是什么、做什么、有哪些文件」。
> - **architecture.md** 描述「信号怎么处理、模型与代码如何分工、为什么要这么分」。

---

## 0. TL;DR

当前 v0 架构把「过滤、聚类、提取、写文案」全部交给 LLM 在最后一公里完成（见 `prompts/digest-intro.md`）。这条路在小规模能跑，但加 prompt 规则后会越加越笨——卡兹克在 AIHOT 项目用 11 个版本验证了这一点（V1~V8 全部走死）。

v1 目标架构：把单一 LLM 调用拆成 **5 层**，让 AI 只做无法用代码做的部分（理解语义 + 多维评分），其余全部代码化（过滤、权重、聚类、阈值、渲染）。

```
v0 当前： 抓取 → 组装大 JSON → LLM 一次性产日报 → 投递

v1 目标： 抓取 → 预筛(Haiku) → 评分(Sonnet, 5维原子分) → 聚类(embedding) → 渲染(纯代码) → 投递
              [ 入库时一次性处理，结果落库 ]                              [ 日报只是查询 ]
```

---

## 1. 演进动机

### 1.1 当前架构在哪里会撑不住

| 症状 | 触发条件 | 根因 |
|---|---|---|
| Prompt 越改越笨 | 加 5 条以上规则后 | LLM 同时负责过滤+聚类+提取+写作，规则之间互相干扰 |
| 调参没法量化 | 想知道"改了 prompt 是变好还是变坏" | 没有中间产物，没法做 A/B |
| 成本无法管控 | 信源扩到 50+ | 每条信息都喂给同一个大模型 |
| 同事件多源刷屏 | 同一观点被 X、播客、Newsletter 复述 | 聚类靠 LLM 每次重做，不持久化 |
| 日报每天重新生成 | 想看历史日报 | 日报是 LLM 输出，不是数据库视图 |

### 1.2 卡兹克的关键教训（AIHOT，2026-05）

> "你绝不能，把所有的事情都交给模型，打分是他、权重计算是他、打标是它、判断是否精选还是它。"
>
> "能用代码处理的，一律不用模型处理。"
>
> "现在大模型评分只做一件事：根据 Prompt，对每条信息打 5 个维度分，不需要打最终分了，这样会更准确和客观。"

迭代轨迹：
- **V1**：单 prompt 全包 → 硬核论文 90 分、软文 87 分
- **V2~V6**：往 prompt 加规则到 600 行 → 模型泛化能力崩坏
- **V7~V8**：双维度评分 + 实体热度 → "纯负向优化"
- **V11（当前）**：模型只输出 5 维原子分，公式/阈值/聚类全代码化

我们直接复用 V11 形态，跳过 V1~V8 的弯路。

---

## 2. 现状评估（v0）

| 模块 | 当前实现 | 评价 |
|---|---|---|
| Pipeline 无 AI | `generate-feed.js` 只做 RSS/REST 抓取，确定性 | ✅ 与 AIHOT 一致 |
| 三阶段分离 | 抓取 / 组装 / 投递 | ✅ Hub-and-spoke 设计正确 |
| 信源分级 | 6 类标签（一手资金/产业研究/私有市场/叙事温度/中文压缩/认知框架） | ✅ 比 AIHOT 的 T1/T1.5/T2 更细 |
| 去重 | `state-feed.json`，7 天 TTL | ✅ 但仅基于 ID，没有跨源语义聚类 |
| LLM 职责 | `digest-intro.md` 让 LLM 一次产出 6 段日报 | ❌ V1 形态，待拆分 |
| 评分维度 | 隐式（在 prompt 文字中） | ❌ 无中间产物，无法回测 |
| 成本控制 | 单一模型处理全量信息 | ❌ 缺预筛层 |
| 事件聚类 | 由 LLM 在 prompt 中"按主题聚合" | ❌ 不持久化、不一致 |

绿色项保留，红色项是 v1 改造范围。

---

## 3. 目标架构（v1）

### 3.1 五层数据流

```
┌──────────────────────────────────────────────────────────────────┐
│ Layer 1 · 抓取（不变）                                              │
│   generate-feed.js → feed-x.json / feed-podcasts.json / ...        │
│   产出：raw_items[]                                                 │
└──────────────────────────────────────────────────────────────────┘
                            ↓ raw_items
┌──────────────────────────────────────────────────────────────────┐
│ Layer 2 · 预筛（新增）                                              │
│   Haiku 4.5 / DeepSeek V3.2 — 选最便宜可用的                        │
│   输入：单条 raw_item                                               │
│   输出：{ relevant: bool, reason: str }                             │
│   作用：砍掉日常寒暄、晒娃、转段子、纯转发                            │
│   预期淘汰率：60-70%                                                │
└──────────────────────────────────────────────────────────────────┘
                            ↓ relevant_items
┌──────────────────────────────────────────────────────────────────┐
│ Layer 3 · 多维评分（新增）                                          │
│   Sonnet 4.6 — 智力够用、世界知识强                                  │
│   输入：单条 relevant_item                                          │
│   输出：5 维原子分（每维 0-10，详见 §4）+ 中文摘要 + 译文            │
│   不做：最终分、是否精选判断                                         │
└──────────────────────────────────────────────────────────────────┘
                            ↓ scored_items
┌──────────────────────────────────────────────────────────────────┐
│ Layer 4 · 事件聚类（新增）                                          │
│   embedding 模型（OpenAI text-embedding-3-small 或本地 BGE）        │
│   余弦相似度 > 0.85 视为同一事件簇                                   │
│   主条选权威源（一手资金 > 产业研究 > 私有市场 > 其他）               │
│   其余条目折叠为 related[]                                          │
└──────────────────────────────────────────────────────────────────┘
                            ↓ event_clusters
┌──────────────────────────────────────────────────────────────────┐
│ Layer 5 · 渲染（重写，零 AI）                                       │
│   纯 SQL + Mustache/handlebars 模板                                │
│   按 §5 公式算最终分                                                │
│   按类别阈值过滤进日报                                              │
│   分桶（资金动向/产业信号/多空视角/...）                              │
│   生成 Markdown                                                    │
└──────────────────────────────────────────────────────────────────┘
                            ↓ digest.md
                    deliver.js → Feishu / stdout
```

### 3.2 中间产物 Schema（待落地为 SQLite 或 JSON）

#### Layer 2 → Layer 3：`prefiltered_item`
```jsonc
{
  "id": "tweet:dylan_patel:1234567",         // 全局唯一 ID
  "source": "x",                              // x | podcast | newsletter | youtube
  "author": "Dylan Patel",
  "author_tag": "产业研究",                    // 来自 default-sources.json
  "url": "https://x.com/dylan_patel/status/...",
  "published_at": "2026-05-09T03:24:00Z",
  "raw_text": "...",
  "engagement": { "likes": 1240, "retweets": 89 },
  "prefilter": {
    "relevant": true,
    "model": "haiku-4-5",
    "reason": "discusses CoWoS capacity"
  }
}
```

#### Layer 3 → Layer 4：`scored_item`
```jsonc
{
  "...prefiltered fields": "...",
  "score": {
    "model": "sonnet-4-6",
    "dimensions": {
      "signal_strength": 8,    // 该信息承载的投资判断力度
      "actionability": 6,      // 是否可转化为决策（持仓变化/数据点）
      "originality": 9,        // 一手 vs 转述
      "timeliness": 7,         // 时效性（事件新鲜度）
      "scarcity": 8            // 公开稀缺性（是否别处也能看到）
    },
    "summary_zh": "Dylan Patel 拆解 CoWoS Q3 产能，指 H200 交付节奏将提前 4 周。",
    "tags": ["半导体", "供应链", "NVDA"]
  }
}
```

#### Layer 4 → Layer 5：`event_cluster`
```jsonc
{
  "cluster_id": "evt:cowos-q3-2026-05",
  "primary": { "...scored_item ID": "..." },
  "related": [ "tweet:abc:...", "newsletter:xyz:..." ],
  "topic": "CoWoS Q3 产能",
  "embedding": [0.123, -0.456, ...]
}
```

---

## 4. 五维评分 Prompt 设计原则

**铁律**：模型不输出最终分，不判断是否精选。只对每个维度打 0-10 整数分。

### 4.1 五个维度（草案，待用黄金集校准）

| 维度 | 含义 | 高分（8-10）样例 | 低分（0-3）样例 |
|---|---|---|---|
| `signal_strength` | 信息承载的投资判断力度 | "我们已减仓 NVDA 30%" | "AI 很有意思" |
| `actionability` | 能否转化为具体决策 | 数据点（CoWoS 产能 +15%）、持仓变化、价位 | 哲学讨论 |
| `originality` | 一手 vs 转述/二手 | 基金经理本人发言、独立研究 | 引用 WSJ 报道 |
| `timeliness` | 事件/数据的新鲜度 | 今晨发布的 13F | 半年前财报回顾 |
| `scarcity` | 公开稀缺性 | 内部圆桌、付费 Newsletter 引述 | 大众财经媒体头条 |

### 4.2 Prompt 模板要点（以 `score-tweet.md` 为例）

```markdown
你将收到一条投资人的推文。请对它输出 5 个维度的整数分（0-10）和一句中文摘要。

不要输出"是否值得精选"的结论。
不要给最终综合分。
不要解释打分原因。

输出严格 JSON：
{
  "signal_strength": <0-10>,
  "actionability": <0-10>,
  "originality": <0-10>,
  "timeliness": <0-10>,
  "scarcity": <0-10>,
  "summary_zh": "<一句中文摘要，不超过 50 字>",
  "tags": ["tag1", "tag2"]
}

打分规则（每条独立判断，不用对比其他推文）：
- signal_strength：...
- actionability：...
...
```

每个维度规则限制在 5-10 行内。**Prompt 总行数硬上限：200 行**（卡兹克教训）。

---

## 5. 最终分公式（代码化）

```python
def final_score(item: ScoredItem) -> float:
    d = item.score.dimensions

    # 加权和（权重向量是回测调出来的，不是 LLM 给的）
    base = (
        d.signal_strength * 0.30
      + d.actionability   * 0.25
      + d.originality     * 0.20
      + d.timeliness      * 0.15
      + d.scarcity        * 0.10
    )

    # 信源等级乘子
    tag_multiplier = {
        "一手资金":   1.30,
        "产业研究":   1.15,
        "私有市场":   1.10,
        "叙事温度":   0.85,
        "中文压缩":   0.95,
        "认知框架":   0.90,
    }[item.author_tag]

    # 互动信号微调（仅 X，且仅在显著高于该作者均值时）
    engagement_bonus = 0
    if item.source == "x" and item.engagement.likes > item.author_avg_likes * 3:
        engagement_bonus = 0.5

    return base * tag_multiplier + engagement_bonus  # 范围约 0-13


# 阈值按 source 分别设定（也是回测调出来的）
THRESHOLDS = {
    "x":          {"daily": 7.5, "weekly": 6.5},
    "podcast":    {"daily": 6.0},   # 播客天然稀缺，门槛低
    "newsletter": {"daily": 6.5},
    "youtube":    {"daily": 6.0},
}
```

**为什么权重这样设**：占位值，待 §6 黄金集回测后调整。所有数字必须能在 5 秒内改完——这是相对 LLM 调 prompt 的核心优势。

---

## 6. 黄金集 + 回测机制

### 6.1 黄金集

- **规模**：50-100 条历史信息（覆盖 X / 播客 / Newsletter）
- **标注字段**：`should_include_in_digest: bool` + `reason: str`
- **来源**：Phase 1 上线后第一周产出的 feed-*.json，人工挑选
- **存储**：`tests/golden_set.jsonl`（提交进 repo）

### 6.2 回测脚本

`scripts/eval.py`（待写）：
1. 加载黄金集
2. 跑当前版本管线（Layer 2-5）打分
3. 对比预测 `should_include` vs 标注
4. 输出：precision / recall / F1 / 错例清单

每次改 prompt、改公式、改阈值都跑一遍。

### 6.3 评估目标

| 指标 | 目标 |
|---|---|
| Precision（被精选的真的该精选） | ≥ 0.85 |
| Recall（该精选的真的被精选） | ≥ 0.75 |
| 单条推理成本 | ≤ $0.0005（预筛 + 评分合计） |

Precision 优先于 Recall——日报的痛点是噪音，宁缺毋滥。

---

## 7. 渐进迁移路径

不要一次性重写。按以下顺序，每步可独立验证、可独立回滚：

### Step 1 ｜ 落地黄金集（不改代码）
- 跑 Phase 1 MVP 一周
- 在 `tests/golden_set.jsonl` 标注 50-100 条
- 此时 baseline 是当前 v0 LLM 一次性产日报，记录 precision/recall

### Step 2 ｜ 加 Layer 3 评分（保留 v0 渲染）
- 写 `prompts/score-{tweet,podcast,article,video}.md`
- 改 `prepare-digest.js`：先批量调评分，把 5 维分塞进 feed JSON
- 渲染层暂时仍用 v0 LLM，但喂给它的数据多了 score 字段
- 跑回测：v0 LLM 用了 score 后是否更准

### Step 3 ｜ 渲染代码化（去掉日报 LLM）
- 写 `scripts/render-digest.py`：从 scored items 直接渲染日报
- 用 §5 公式算最终分，按阈值过滤，按桶分组
- 此时整条管线零 LLM 渲染，成本骤降
- 回测对比：代码渲染 vs LLM 渲染

### Step 4 ｜ 加 Layer 2 预筛
- 写 `prompts/prefilter.md`（极简，只问"是否承载投资信号"）
- 改 `generate-feed.js` 或新建 `scripts/prefilter.js`
- 砍掉的不入下游，省 60%+ token

### Step 5 ｜ 加 Layer 4 聚类
- 调 embedding API 生成向量，存 `embeddings.json` 或 SQLite
- 跨 source 找余弦 > 0.85 的，按 `author_tag` 优先级选主条
- 渲染层只展示主条，related 折叠

每步耗时估计：1-3 个夜晚。

---

## 8. 与 PROJECT.md 字段映射

| PROJECT.md §4.1 常量 | 在新架构的位置 |
|---|---|
| `TWEET_LOOKBACK_HOURS = 24` | Layer 1 抓取窗口（不变） |
| `MAX_TWEETS_PER_USER = 5` | Layer 1 抓取限额（不变） |
| `STATE_MAX_AGE_DAYS = 7` | Layer 1 去重 TTL（不变） |
| 待新增：`PREFILTER_MODEL` | Layer 2 |
| 待新增：`SCORE_MODEL` | Layer 3 |
| 待新增：`CLUSTER_THRESHOLD = 0.85` | Layer 4 |
| 待新增：`THRESHOLDS = {...}` | Layer 5 |

---

## 9. 待解决问题（决策日志）

- [ ] **预筛模型选型**：Haiku 4.5 / DeepSeek V3.2 / Gemini Flash——选最便宜且 zh-en 双语的
- [ ] **embedding 模型**：OpenAI text-embedding-3-small（$0.02/M tokens，云端）vs 本地 BGE（零成本但需机器跑）
- [ ] **状态存储**：继续 JSON 文件 vs SQLite——多层产物后 JSON 会膨胀
- [ ] **黄金集是否需要分级**：除了 `should_include` 之外，是否需要"哪个桶"标注
- [ ] **作者均值如何计算**：`author_avg_likes` 需要历史数据。冷启动期可能只能用占位值
- [ ] **失败模式**：评分 LLM 偶尔输出非 JSON——是用 strict mode 还是 retry-with-fix
- [ ] **cluster 跨日**：今天精选了一条 NVDA，明天又冒出 5 条同事件——是新 cluster 还是续旧 cluster

---

## 10. 灵感与致谢

- **卡兹克 / AIHOT**（[原文](https://mp.weixin.qq.com/s/r6CE2U3Y0-pU05wF3_PuTQ)，2026-05-06）：贡献了 V1~V11 的迭代轨迹与"能用脚本就别用 Agent"的设计原则
- **follow-builders / Zara Zhang**：贡献了 hub-and-spoke 三阶段管线
- **A Note on Black Forest**：「信源 > 信息」——本架构的隐性公理
