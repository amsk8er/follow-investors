# Known Issues（按 TEST_PLAN Phase 1 记录）

不阻塞测试推进,但下一轮要回头清理。

## I-1 Acquired 播客 RSS 不可达
- 源:`config/default-sources.json` → `podcasts[Acquired]` → `https://feeds.pacific-content.com/acquired`
- 现象:Node fetch / curl 即使走代理也无响应;CI 直连返回 `fetch failed`
- 影响:之前会卡死整个 podcasts 阶段;I-3 修复后被 10s timeout 截断,流程继续
- 处置候选:换可信 RSS URL,或暂时从 sources 中下线

## I-2 YouTube `@ARKInvest` 无法解析 channelId
- 现象:`resolveYouTubeChannelId` 拿到 HTML 但两个正则都不匹配
- 其他 3 个 handle (asianometry / MeiTouJun / RealVisionFinance) 在加代理后正常
- 处置候选:用 curl 抓 `https://www.youtube.com/@ARKInvest` HTML 看是否被改版,或直接在 sources 里硬写 channelId 字段绕过解析

## ~~I-3 generate-feed.js 缺 fetch timeout~~ (已修复 2026-05-09)
- 修复:`scripts/generate-feed.js` 加 `fetchWithTimeout` helper(`AbortController` + 10s),全部 6 处 `fetch` 替换
- CI 验证:`@leopoldasch` profile 偶发慢响应被 10s 截断,流程继续无阻塞

## I-4 Newsletter URL→RSS 映射只覆盖 2 个域
- 现象:`fetchNewsletters` 只识别 `substack.com` 和 `fabricatedknowledge`
- 当前未识别:`semianalysis.com`、`blog.eladgil.com`、`situational-awareness.ai`
- 处置候选:逐个验证 RSS 路径(SemiAnalysis 多半付费墙,Elad Gil/Situational Awareness 需嗅探),建表替换硬编码分支

## I-5 GitHub Actions 用的 Node.js 20 已 deprecated
- 现象:每次 CI run 末尾出 annotation 警告 `actions/checkout@v4`、`actions/setup-node@v4` 跑在 Node 20 上
- 时间线:2026-06-02 起 GitHub 强制升 Node 24;2026-09-16 移除 Node 20
- 处置候选:把 workflow `setup-node` 的 `node-version: '20'` 升为 `'24'`,或临时 `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true`
- 注:当前我们用的是稳定 v4 action 主版本,GitHub 通常会在 v4 内升级 Node runtime,所以最坏情况也只是警告

## I-6 free-tier TwitterAPI.io 节流让全量跑慢
- 现象:`fetchTweets` 每次 fetch 前 `sleep(5500)`,10 账号 × 2 fetch = 22 个 sleep ≈ 110s
- 触发点:免费 plan QPS = 1 req per 5s
- 处置候选:升级到付费 plan 后把 `sleep(5500)` 调到 `sleep(200)` 或更小;或保持节流但并发拉取多账号(需重写循环为 worker pool)
