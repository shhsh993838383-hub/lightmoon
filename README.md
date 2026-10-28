# 光幕 lightmoon

面向中文用户的电影资料与发现平台原型。包含真实海报、多维标签筛选、导演与演员检索、国家／地区、语言、年代、电影详情、主题片单、想看片单、我已看过、个人评分与 AI 对话找电影。

## 网站部署

网站入口：[光幕 lightmoon](https://shhsh993838383-hub.github.io/lightmoon/)。源码：[GitHub 仓库](https://github.com/shhsh993838383-hub/lightmoon)。

GitHub Pages 发布页面、海报和当前已收录的 **10,000 部电影**快照，不依赖本机运行。配置云端 API 后提供邮箱注册、账号登录、光幕评分和评论；游客可只读浏览。目录接口不可用时自动读取完整快照，保留搜索、筛选和分页。AI 找电影只使用 DeepSeek，未配置或服务不可用时显示错误并支持重试。

`.github/workflows/pages.yml` 会在推送 `main` 后测试、构建并发布页面，自动处理 `/lightmoon/` 路径。快照从 `server/data/initial-catalog.json` 和精选资料生成。`public/catalog.json` 是构建产物，不包含密钥。

### Cloudflare Workers + D1（当前首选）

`workers/index.mjs` 提供电影目录、组合筛选、搜索建议、TMDB 搜索、豆瓣榜单及 DeepSeek 对话接口。`workers/knowledge.mjs` 使用 D1、FTS5 和中文双字词索引，查询采用分页，并适配 D1 的 SQL 参数和批量查询限制。片库不打包进 Worker 脚本。

1. 用 Cloudflare 账号登录：`npx wrangler login --use-keyring`。首次登录与授权需要账号所有者完成。
2. 创建免费 D1：`npx wrangler d1 create lightmoon-movies`，把返回的数据库 ID 填入 `wrangler.jsonc` 的 `database_id`。
3. 执行 `npx wrangler d1 migrations apply lightmoon-movies --remote`。
4. 执行 `npm run cf:seed`，再执行 `npx wrangler d1 execute lightmoon-movies --remote --file .data/cloudflare-seed.sql`。该导入按稳定 ID 更新已发布快照，保留后来检索加入的其他电影。
5. 使用 `npx wrangler secret put DEEPSEEK_API_KEY` 和 `npx wrangler secret put TMDB_API_KEY` 写入服务端密钥；也支持 `TMDB_ACCESS_TOKEN`。不要把值写入配置或提交 Git。
6. 执行 `npm run cf:deploy`，取得 `https://lightmoon-api.实际子域.workers.dev`。
7. 确认云端状态、组合筛选、跨域及一次真实 AI 对话后，在 GitHub Actions Variables 设置 `VITE_API_BASE_URL` 为上述公开网址，运行 Publish lightmoon 工作流。

`wrangler.jsonc` 默认只允许现有 GitHub Pages 来源跨域访问，AI 每个 IP 每分钟最多 12 次、站点每天最多 100 次 DeepSeek 请求；每日值可用 `AI_DAILY_LIMIT` 调整。请求限额保存在 D1，密钥只在服务端。Cloudflare 的免费额度不包含 DeepSeek API 调用费用。

免费 D1 的每日读取额度耗尽时，在线 AI 会在数据库检索或限流检查处返回 `storage_daily_limit`，请求尚未到达 DeepSeek。每日额度在 UTC 00:00（北京时间早上 8 点）重置；AI 页面显示真实错误并支持重试，不生成替代回复。普通电影目录仍可使用 Pages 快照浏览。状态接口只说明配置和知识库状态，不代表一次真实 AI 调用已成功。

现有免费数据库尚未执行 `0003_catalog_tag_index.sql`；这份迁移会回填全部标签，执行前需核算当天写入额度，不要在现有免费实例上直接运行全部远端迁移。Worker 在未回填时保持兼容。

本地验证：`npx wrangler d1 migrations apply lightmoon-movies --local`，`npm run cf:seed`，`npx wrangler d1 execute lightmoon-movies --local --file .data/cloudflare-seed.sql`，`npm run cf:dev`。默认端口 8790。

### Vercel 备用方案

Vercel 后端部署配置保留，实际启用还需完成账户验证、创建云数据库与设置环境变量：

1. Vercel 导入本仓库，使用 `vercel.json`，Node.js 24。后端入口为 `api/index.mjs`，不启动常驻服务器。
2. 在 Vercel 配置 `DATABASE_URL`（PostgreSQL，例如 Neon）、`DEEPSEEK_API_KEY`、`TMDB_API_KEY` 或 `TMDB_ACCESS_TOKEN`，以及 `ALLOWED_ORIGINS=https://shhsh993838383-hub.github.io`。DeepSeek 其他配置沿用 `.env.example`。
3. PostgreSQL 首次访问时建表并导入初始快照；全文索引、后续检索导入的影片和请求限额保存到云数据库。豆瓣榜单使用实例内短期缓存，不向 Vercel 只读目录写文件。
4. 在 GitHub 仓库 Actions Variables 设置 `VITE_API_BASE_URL=https://实际项目.vercel.app`，手动运行 Publish lightmoon 工作流。该变量只放公开网址。后端密钥不进入 Pages 构建。
5. 验证 `/api/assistant/status`、跨域请求、电影搜索及一次真实 AI 对话，再开放动态能力。

Vercel 不承载百万影片的单次长时间导入任务。现有 `tmdb:all` 仍是服务器/本机 SQLite 导入工具；在数据库容量和云端任务配置完成前，不会自动运行，也不表示全量片库已经同步。Docker 持久磁盘方案保留作备用部署方式。

## 本机运行

需要 Node.js 24 或更新版本，知识库使用内置的 SQLite 与 FTS5。

```powershell
npm install
npm run dev
```

页面地址：http://127.0.0.1:5173/ 。开发命令同时启动页面与本机 API，默认 API 端口为 8787。

```powershell
npm test
npm run build
npm start
```

默认构建后可以直接访问 http://127.0.0.1:8787/ ，同一个服务提供前端文件和 API。服务默认仅监听本机。

## DeepSeek 配置

1. 在 [DeepSeek 开放平台](https://platform.deepseek.com/api_keys) 创建 API 密钥。
2. 复制 `.env.example` 为 `.env`，在 `DEEPSEEK_API_KEY=` 后填入密钥，不要给变量加 `VITE_` 前缀，也不要把密钥贴进页面代码。
3. 重启本项目 API 服务。只需重启项目服务，无需重启 Codex。

Windows 也可以运行下面的命令，在遮住输入的本地窗口中填写密钥。它只更新 `.env` 中的密钥，不把密钥写入命令行或聊天记录。

```powershell
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File .\scripts\configure-deepseek.ps1
```

```dotenv
DEEPSEEK_API_KEY=在本地填入自己的密钥
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-flash
API_HOST=127.0.0.1
API_PORT=8787
```

实现基于 2026-10-27 查看过的 [DeepSeek 官方文档](https://api-docs.deepseek.com/)：使用 `/chat/completions`、Bearer 认证与 JSON 输出，模型名可配置。AI 找电影的所有成功回复均来自 DeepSeek，包括没有匹配影片时的追问。缺少密钥、无效密钥、超时或额度耗尽均返回真实错误，不回退到本地答复；不能仅凭已配置状态断言密钥有效。

配置 DeepSeek 后，当前对话和匹配的影片资料会由服务端发送到 DeepSeek。密钥始终留在服务端，不通过状态接口或前端构建文件返回。

## 电影知识库

- 编辑精选：`src/data/movies.json`，22 部，包含海报、资料出处和人工观感标签。
- TMDB 快照：`.data/tmdb-movies.json`，由同步命令生成；按 TMDB ID 去重，并保留精选影片 ID，避免影响已有想看和个人评分。
- 知识库：`.data/knowledge.sqlite`，首次运行 API 自动建立。`GET /api/catalog` 与 AI 共用合并后的片库；同步后下一次读取自动更新索引，无需重新构建前端。
- 每部电影形成一份结构化文档；用中文双字词、英文词与 SQLite FTS5 检索。
- 对话先整理条件并过滤片长、类型、气质、地区等，再召回候选，DeepSeek 只接收有限候选与对话。
- 推荐卡片只接受本轮候选中的影片 ID。没有符合条件的电影时明确说明，不用不匹配作品补位。
- 服务端检索为 DeepSeek 提供候选影片和对话条件，包括继续修改要求、相似影片与避开看过的影片；不单独生成聊天回复。
- 索引包括中外文片名、别名、演职员、关键词和简介。全量导入可断点继续，未接入向量模型。
- TMDB 新片只提供已有的客观类型与元数据，不自动猜测情绪、节奏等观感标签。未标注字段不能通过相应包含或排除条件，未知片长和年份不能通过对应限制。

修改电影资料后运行：

```powershell
npm run kb:build
```

编辑源文件或同步快照变动后，API 会自动加载更新后的电影记录。精选影片海报的有限导入脚本为 `scripts/prepare-movies.py`，使用 Wikimedia 上与影片对应的真实发行海报；TMDB 导入影片使用 TMDB 图片服务。来源随条目保存。

## TMDB 配置与同步

在 [TMDB API 设置](https://www.themoviedb.org/settings/api) 取得 API Read Access Token，然后运行遮挡输入的本地窗口：

```powershell
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File .\scripts\configure-tmdb.ps1
npm run tmdb:sync -- --limit 120
```

也可以在本机 `.env` 中配置 `TMDB_ACCESS_TOKEN`，或使用 v3 的 `TMDB_API_KEY`。密钥只供同步脚本调用官方 API，不通过前端或片库接口返回。`tmdb:sync` 使用 Node 的 `--use-env-proxy`，在设置了 `HTTP_PROXY` / `HTTPS_PROXY` 的环境中沿用现有代理。

单次导入数量为 1 到 2000 部，默认 120 部。同步先匹配编辑精选，再收集华语高票数影片及全球高分、热门影片，导入中文资料、演职员、关键词、海报与 TMDB 评分。重复执行会更新相同记录；只有本轮全部成功后才替换快照，请求失败时保留原有资料。该命令是有限批量导入，不代表收录了全球全部电影，也不会在后台定时运行。

仓库 Actions 中的 **Expand movie catalog** 可手动在云端扩充快照，需要 Actions Secret `TMDB_API_KEY` 或 `TMDB_ACCESS_TOKEN`。每批保存进度并输出 `expanded-catalog.json` artifact；artifact 尚需核对、补评分和更新 `server/data/initial-catalog.json` 后提交，才会发布到网站。当前 2,014 部数据由该云端流程扩充而来。

导演、演员、国家／地区、语言使用各自资料字段筛选，支持搜索名称和最多 8 项组合。国家／地区表示影片出品地，不推测演员或导演国籍；演员资料目前为每片最多 8 位主要演职员。年代来自上映年份，未知字段不能满足相关条件。相同组的“任选／全部”规则同样适用这些维度。

页面每次打开会从 `/api/catalog` 读取片库，加载失败时读取 Pages 的完整快照。新增影片分批展示；影片使用稳定 ID，TMDB 评分与光幕评分分开展示。

官方 Logo 保存在 `public/brand/tmdb.svg`，下载自 [TMDB Logos & Attribution](https://www.themoviedb.org/about/logos-attribution)。站内“关于与资料来源”包含官方署名：

> This product uses the TMDB API but is not endorsed or certified by TMDB.

当前为个人非商业原型；商业用途须按 TMDB 的 [API 使用说明](https://developer.themoviedb.org/docs/faq) 另行确认许可。

### 完整片库搜索与全量导入

搜索框输入片名后，可在结果下方选择“搜索完整片库”，通过服务端查询整个 TMDB 电影搜索接口。首批结果和打开的详情会加入电影知识库，支持 AI 后续检索；搜索结果不受本地已收录数量限制，未补齐的字段明确留空。

```powershell
npm run tmdb:all
```

该命令下载 TMDB 前一日的完整电影 ID 导出，逐条导入中文详情、演职员、关键词和海报 URL，跳过成人条目、已收录条目和已移除条目。数据直接写入 SQLite 并增量建立检索索引。`.data/tmdb-import-state.json` 保存断点；按 Ctrl+C 安全暂停，同一命令可继续。`--concurrency 4` 为默认值，最多 8；`--batch-limit 3` 可用于有限验证。网络错误会重试，仍失败则保存断点并停止。`GET /api/import/status` 返回真实进度，取得 ID 清单不表示详情已全部导入。

API 和页面采用数据库筛选与分页，每次最多返回 200 部；前端每页加载 40 部，AI 仅加载有限候选，避免一次把百万条记录传入浏览器或模型。

## 豆瓣榜单

采用 [x1ao4/douban-api](https://github.com/x1ao4/douban-api) 的移动端榜单接口约定，集成到现有 Node 后端，无需另起 Docker 服务。支持热门、最新、高分和冷门佳片，地区包含全部、华语、欧美、韩国、日本，入口位于“主题片单”下方。接口不是豆瓣官方开放平台的授权服务。

`GET /api/douban/movie/hot/全部` 等接口返回真实榜单，缓存一小时。请求失败时保留并明确标记已有缓存；无缓存则显示失败，不使用上游仓库的模拟数据兜底。若设置 `DOUBAN_API_KEY`，仅在高分总榜移动端失败时尝试旧版 Top250 接口；无效 Key 不会伪装成成功。豆瓣与 TMDB 评分分别标明。第三方 MIT 许可见 `THIRD_PARTY_NOTICES.md`。

## 多平台评分

电影卡片、搜索推荐和详情分别展示 TMDB、豆瓣、烂番茄评分。TMDB 和豆瓣是十分制；烂番茄显示专业影评好评比例，详情另列观众好评率。缺失项显示“暂无评分”，不拿其他平台或示例值补齐。

“平台评分区间”支持分别设置 TMDB 0–10 分、豆瓣 0–10 分、烂番茄专业新鲜度 0–100% 的上下限。区间包含边界，跨平台同时满足，也可与导演、演员、类型等标签组合。缺少该平台评分的电影不会匹配对应区间；未设置的平台不作限制。

`scripts/enrich-ratings.mjs` 根据精确 IMDb ID，通过 Wikidata 关联豆瓣 ID 和烂番茄影片路径，再读取实际评分；豆瓣同时核对片名和年份。`scripts/collect-douban-ratings.mjs` 有限读取公开榜单并缓存，`scripts/publish-catalog.mjs` 合并已核对评分到发布快照。`node --use-env-proxy scripts/enrich-ratings.mjs --input 文件 --limit 2014 --providers rotten` 可单独补烂番茄。遇到明确限流会停止该平台，未核对资料保持空缺。

用户提供的 `bookyo/douban-imdb-api` 仓库只有接口说明，2026-10-27 测试其 `movie.querydata.org` 服务无法连接，未把 README 的示例评分作为影片资料。当前评分读取实现独立于该服务。

## GitHub 与部署

仓库包含代码、精选影片和本地海报，排除 `.env`、全部密钥、`.data` 数据库/导入进度、依赖、构建文件及截图。GitHub Actions 会执行测试与构建，CI 不需要 API 密钥。

主要部署方式为 GitHub Pages 前端与 Cloudflare Workers API + D1，见上方部署说明；Vercel + PostgreSQL 保留为备用。另提供 `Dockerfile`：通过环境变量配置服务端密钥，将 `/app/.data` 挂载到服务器持久磁盘后，可以使用原有 SQLite 和全量导入命令；无需把百万级数据库提交进 Git 历史。

## 本版范围

登录账号的想看、已看、光幕评分与评论保存在云端，评分范围为 1–10 分。登录凭证与服务端到期时间保存在当前浏览器，刷新、关闭后重开或新标签页可恢复，最长 7 天；只保存随机凭证，不保存密码。退出登录会清除凭证，同源标签页同步退出；网络或数据库临时故障不会清除已保存的凭证。密码最低 6 位；邮箱验证和找回密码尚未接入。AI 聊天在当前页面会话中保留，切换导航后可以继续；刷新页面会清空聊天。评论审核和自动日更仍需后续开发。全量片库是否导入完毕以实际进度为准。

`docs/中国版IMDb产品定位.md` 记录产品定位、IMDb 功能观察、与豆瓣的区别，以及后续数据模型与平台规划。
