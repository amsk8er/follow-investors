---
name: follow-investors
description: AI 投资信息源跟踪 — 生成每日投资日报
trigger: "投资日报 / investment digest / follow investors / 今日信号"
---

# follow-investors Skill

追踪 AI 产业链投资领域的关键声音（基金经理、分析师、VC、CEO），生成结构化日报推送到飞书。

## 工作流程

### 1. 生成日报

```bash
# 组装所有 feed 数据 + prompts 为一个 JSON
node scripts/prepare-digest.js
```

读取 `prepare-digest.js` 的输出 JSON，按照 `prompts/` 中的规则生成日报。

### 2. 日报生成规则

按照以下顺序处理 JSON 中的 feeds：

1. 读取 `prompts.digestIntro` 了解整体输出结构
2. 用 `prompts.summarizeTweets` 处理 `feeds.x`
3. 用 `prompts.summarizePodcasts` 处理 `feeds.podcasts`
4. 用 `prompts.summarizeNewsletters` 处理 `feeds.newsletters`
5. 用 `prompts.summarizeYoutube` 处理 `feeds.youtube`
6. 整合为一份完整日报

### 3. 投递

```bash
# 投递到飞书
echo "日报内容" | node scripts/deliver.js feishu

# 或输出到终端
echo "日报内容" | node scripts/deliver.js stdout
```

### 4. 手动触发 feed 更新（通常由 GitHub Actions 自动完成）

```bash
# 需要设置环境变量
export TWITTERAPI_IO_KEY=your_key
node scripts/generate-feed.js all
```

## 配置

用户配置文件：`~/.follow-investors/config.json`

```json
{
  "language": "zh",
  "timezone": "Asia/Shanghai",
  "frequency": "daily",
  "delivery": {
    "method": "feishu"
  }
}
```

环境变量（`~/.follow-investors/.env`）：

```
TWITTERAPI_IO_KEY=your_twitterapi_io_key
FEISHU_WEBHOOK_URL=your_feishu_webhook_url
```

## 信号源管理

编辑 `config/default-sources.json` 增减跟踪的账号、播客、Newsletter 和 YouTube 频道。

每个源都有一个 `tag` 字段标注信号层级：
- `一手资金`：有仓位的基金经理
- `产业研究`：数据驱动的分析师
- `私有市场`：VC，看到公开市场前 6-12 个月的管线
- `叙事温度`：有资本但也有观点秀属性
- `中文压缩`：中文信息整合
- `认知框架`：长对话、深度拆解
