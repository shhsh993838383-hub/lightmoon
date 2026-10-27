# 光幕 lightmoon

面向中文用户的电影资料与发现平台原型。包含真实海报、多维标签筛选、电影详情、导演关联检索、主题片单、想看片单、我已看过、个人评分与 AI 对话找电影。

## 网站部署

网站入口：[光幕 lightmoon](https://shhsh993838383-hub.github.io/lightmoon/)。源码：[GitHub 仓库](https://github.com/shhsh993838383-hub/lightmoon)。

GitHub Pages 发布页面、海报和当前已收录的电影快照，不依赖本机运行。尚未配置 Vercel 地址时，页面提供快照片库的搜索、筛选、详情、想看、已看记录、个人评分和主题片单，AI 页面明确显示尚未开放，不请求不存在的服务器接口。快照目前为 137 部电影，并非全球全部影片；个人想看、已看记录和评分保存在访问者自己的浏览器中。

`.github/workflows/pages.yml` 会在推送 `main` 后测试、构建并发布页面，自动处理 `/lightmoon/` 路径。快照从 `server/data/initial-catalog.json` 和精选资料生成。`public/catalog.json` 是构建产物，不包含密钥。

Vercel 后端部署配置已提供，实际启用还需完成账户验证、创建云数据库与设置环境变量：

1. Vercel 导入本仓库，使用 `vercel.json`，Node.js 24。后端入口为 `api/index.mjs`，不启动常驻服务器。
2. 在 Vercel 配置 `DATABASE_URL`（PostgreSQL，例如 Neon）、`DEEPSEEK_API_KEY`、`TMDB_ACCESS_TOKEN`，以及 `ALLOWED_ORIGINS=https://shhsh993838383-hub.github.io`。DeepSeek 其他配置沿用 `.env.example`。
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

默认构建后可以直接访问 http://127.0.0.1:8787/ ，同一个服务提供前端文件和 API。服务默认仅监听本机；目前未实现账户和公共社区。

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

实现基于 2026-10-27 查看过的 [DeepSeek 官方文档](https://api-docs.deepseek.com/)：使用 `/chat/completions`、Bearer 认证与 JSON 输出，模型名可配置。无密钥时明确展示“片库检索”；填入密钥后切换到 DeepSeek 模式，不能仅凭已配置状态断言密钥有效。无效密钥会出现真实错误提示，用户可明确选择改用本地检索。

配置 DeepSeek 后，当前对话和匹配的影片资料会由服务端发送到 DeepSeek。密钥始终留在服务端，不通过状态接口或前端构建文件返回。

## 电影知识库

- 编辑精选：`src/data/movies.json`，22 部，包含海报、资料出处和人工观感标签。
- TMDB 快照：`.data/tmdb-movies.json`，由同步命令生成；按 TMDB ID 去重，并保留精选影片 ID，避免影响已有想看和个人评分。
- 知识库：`.data/knowledge.sqlite`，首次运行 API 自动建立。`GET /api/catalog` 与 AI 共用合并后的片库；同步后下一次读取自动更新索引，无需重新构建前端。
- 每部电影形成一份结构化文档；用中文双字词、英文词与 SQLite FTS5 检索。
- 对话先整理条件并过滤片长、类型、气质、地区等，再召回候选，DeepSeek 只接收有限候选与对话。
- 推荐卡片只接受本轮候选中的影片 ID。没有符合条件的电影时明确说明，不用不匹配作品补位。
- 本地模式支持常见中文条件、继续修改要求、相似影片、避开看过的影片；复杂含糊表达的理解能力有限。
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

页面每次打开会从 `/api/catalog` 读取片库，加载失败时保留本地精选供浏览。新增影片分批展示；想看与个人评分保留 TMDB 影片 ID，刷新后不会丢失。TMDB 评分与个人评分分别标明来源。

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

## GitHub 与部署

仓库包含代码、精选影片和本地海报，排除 `.env`、全部密钥、`.data` 数据库/导入进度、依赖、构建文件及截图。GitHub Actions 会执行测试与构建，CI 不需要 API 密钥。

主要部署方式为 GitHub Pages 前端与 Vercel API + PostgreSQL，见上方部署说明。另提供 `Dockerfile`：通过环境变量配置服务端密钥，将 `/app/.data` 挂载到服务器持久磁盘后，可以使用原有 SQLite 和全量导入命令；无需把百万级数据库提交进 Git 历史。

## 本版范围

想看与个人评分保存在当前浏览器。AI 聊天在当前页面会话中保留，切换导航后可以继续；刷新页面会清空聊天。公共评分、登录、审核、影评和自动日更仍需后续开发。全量片库是否导入完毕以实际进度为准。

`docs/中国版IMDb产品定位.md` 记录产品定位、IMDb 功能观察、与豆瓣的区别，以及后续数据模型与平台规划。
