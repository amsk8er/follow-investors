# Known Issues（按 TEST_PLAN Phase 1 记录）

不阻塞测试推进,但下一轮要回头清理。

## I-1 Acquired 播客 RSS 不可达
- 源:`config/default-sources.json` → `podcasts[Acquired]` → `https://feeds.pacific-content.com/acquired`
- 现象:Node fetch / curl 即使走代理也无响应,长时间挂起
- 影响:`generate-feed.js podcasts` 会卡在该 host 直到默认 fetch 超时(几分钟)
- 处置候选:换可信 RSS URL,或暂时从 sources 中下线

## I-2 YouTube `@ARKInvest` 无法解析 channelId
- 现象:`resolveYouTubeChannelId` 拿到 HTML 但两个正则都不匹配
- 其他 3 个 handle (asianometry / MeiTouJun / RealVisionFinance) 在加代理后正常
- 处置候选:用 curl 抓 `https://www.youtube.com/@ARKInvest` HTML 看是否被改版,或直接在 sources 里硬写 channelId 字段绕过解析

## I-3 generate-feed.js 缺 fetch timeout
- 现象:任意一个 RSS / HTTP 源 host 死,会让整个模块阻塞数分钟
- 触发点:I-1 暴露
- 处置候选:统一封装 `fetch` 包一层 `AbortController` + 10s timeout,失败转 `console.error` 继续下一个源

## I-4 Newsletter URL→RSS 映射只覆盖 2 个域
- 现象:`fetchNewsletters` 只识别 `substack.com` 和 `fabricatedknowledge`
- 当前未识别:`semianalysis.com`、`blog.eladgil.com`、`situational-awareness.ai`
- 处置候选:逐个验证 RSS 路径(SemiAnalysis 多半付费墙,Elad Gil/Situational Awareness 需嗅探),建表替换硬编码分支
