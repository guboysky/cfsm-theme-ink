# Ink for CF-Server-Monitor

将 [komari-theme-ink](https://github.com/jacob-bytes/komari-theme-ink) 的深蓝黑／冷灰视觉移植为 CF-Server-Monitor 独立 Vue 3 主题。数据层重新实现，不包含 Komari API、登录页或后台管理功能。

**当前状态：可构建、自动化测试通过；尚未达到完整发布验收。** 已用本地构建主题连接用户真实后端，完成公开访问开启／Turnstile 关闭组合的列表、WebSocket 和详情历史检查，未修改线上部署。其余三种组合与后台登录尚待验证。当前参考后端的 Turnstile 凭证返回问题也尚待实站确认，见下文。artifacts 中的截图仍为模拟数据。

## 本地运行与构建

需要 Node.js 22.12+。

```sh
npm ci
npm run dev
npm test
npx playwright install chromium
npm run test:e2e
npm run build
```

直接运行开发服务时，默认请求同源后端。连接已有 Worker 时，通过进程环境变量 `API_BASE` 设置 origin 后启动；支持逗号分隔多个 origin。也可以由托管方在 HTML 写入 `<meta name="apiBase" content="…">`。不要把真实 Worker 地址提交到源码。

构建输出严格为 `dist/index.html` 与 `dist/assets/`，JS、CSS 均使用相对路径。首页 `/#/`，独立详情 `/#/server/:id`；多站详情用 `?site=0` 标识后端索引。管理入口指向相应后端的 `/admin#/admin`。

## Pages 自动发布

`.github/workflows/build-pages.yml` 在推送 main/master 或手动触发时构建，将文件追加提交到 **dist** 分支。每次完整保留触发源码提交的说明，不强制推送、不覆盖提交历史，并用 concurrency 串行发布。

仓库 Settings → Actions → General 中允许工作流写入仓库（workflow 自带 `contents: write`）；Settings → Pages 选择 Deploy from a branch，分支 **dist**，目录 **/(root)**。

Settings → Secrets and variables → Actions 添加以下 Secrets：

| Secret | 用途 |
| --- | --- |
| `API_BASE` | 一个或多个后端纯 origin，逗号分隔；空值使用同源 |
| `TITLE` | 配置未返回站点标题时的备用标题 |
| `BACKGROUND_IMAGE` | 配置未返回背景时的备用背景地址 |
| `CSP_API` | CSP 允许连接的额外 HTTP(S) origin，逗号或空格分隔 |
| `CSP_STATIC` | CSP 允许的图片、字体、脚本、样式源 origin，包含远程背景源 |

设置任一 CSP Secret 时生成 CSP meta；自动包含 API_BASE 的 HTTP 和 WS origin、Cloudflare Turnstile。后台自定义脚本使用的外部资源源站需要加入对应白名单。Secrets 会被写入公开静态 HTML，**不可用来保存 JWT、密码或其他机密**。运行时 API 地址本身必须公开给浏览器。

跨域部署时，**每个 Worker** 都需配置 `CORS_ALLOWED_ORIGINS` 环境变量，值为允许的前端纯 origin，逗号分隔。Turnstile 管理后台也需允许前端域名。同域 WebSocket 使用后台登录 Cookie `cfsm_auth`，跨域时从 `localStorage.jwt_token` 读取 JWT，放入 WS URL 的 `token` 参数。

## 数据与额度约束

每个后端单独缓存一次 config、一次首页列表（包括 Promise 去重），路由往返不重新查列表。唯一例外是页面隐藏后恢复：按当前页补一次列表或单机指标，再连接 WS；不补查 config／历史。

- 首页 `subscribe=all`，连接后发送该后端的服务器 ID；独立详情 `subscribe=<id>`。
- 样本按 `data || payload || metrics` 读取，增量合并，在内存累计后最多每秒一次更新响应式数据。每台仅保留这一秒最新字段值，低频字段保留。
- 卡片小图只读取列表自带的 ping/loss 窗口；开关关闭或窗口为空时不画小图。标量探测值仍可显示。不会补查历史。
- 详情历史默认 0.167 小时；仅进入详情／用户切换范围时读取同一个 history/all 接口。范围切换有竞态保护。实时历史点来自当前单机 WS，内存最多保留 2000 行。
- 没有 REST 轮询。WS 断线最多重试 6 次，延迟 1、2、4、8、16、30 秒。达到站点连接时限后保持最后数据，必须点击继续；切换可见性不会解除超时暂停。
- false／未返回不显示，null 显示超时，0 正常展示。磁盘 IO 只读 disk 对象；GPU 只读 gpu_info，历史字符串先解析。
- 总数／在线／离线直接展示后端 stats 的列表快照；卡片按最后上报 5 分钟口径判断。没有为刷新统计额外查库。
- 主题配置从 config.theme_options 合并默认值，只用 POST theme_options 持久化。布局密度和网络图表可在右上角调整；保存需要已有 JWT，无凭证将由后端引导至内置登录页。

标题、背景、语言、明暗模式来自 config，标题／背景可用构建 meta 提供后备。支持 zh/en/es；auto 跟随浏览器。后台提供 custom_head/custom_script 时应用，并暴露资源加载错误。当前参考后端 config 并未返回 custom_bg/custom_bg_mobile/custom_head/custom_script：同源部署依靠后端注入 HTML；独立静态部署要让后端在 config 暴露这些外观字段，或使用环境变量提供背景，不能增加其他配置查询接口。旗帜与系统图标使用对应 Worker 的 `/flags/`、`/os-icons/`。

## 必须解决：参考后端 Turnstile 凭证

核对后端提交 `fa60c60d7a5e872c874fe92822206b32d072c3af`：

1. `/api/config` 未带验证头时可用于初始化，只有它的响应体会填入 `turnstile_verified`。
2. `/api/servers`、`/api/server` 等接口首次验证成功后，路由公共响应分支计算了 `encryptedData`，但没有放入响应体或可读响应头，也没有设置对应验证 Cookie。
3. 因此在 config 只查一次的约束下，主题拿不到后续可复用凭证；Turnstile 单次 token 也不能重复使用。不能通过重复查询 config 规避。

[`docs/backend-turnstile.patch`](docs/backend-turnstile.patch) 提供针对该提交的最小后端补丁：对验证成功的 JSON 对象响应追加 turnstile_verified。它不修改此主题的接口范围，也不会额外查询 D1。补丁**未替用户部署或提交到上游**；应用后还需要真实 Turnstile 环境验证。主题已支持数据响应中的凭证缓存（按后端隔离），403 清缓存并交互重验，仅重试一次，401 清 JWT 跳内置后台，不 reload。

## 验证与待验收

自动化测试覆盖四种组合的前端接口契约、匿名私站跳转、401／403、验证缓存复用、路由请求次数、独立详情订阅、隐藏恢复、WS 节流与增量字段、指数退避上限、多站 ID 隔离、跨域 JWT、连接超时交互、主题配置保存、桌面深浅色和移动端布局。模拟 Turnstile 不等同 Cloudflare 实际人机验证。

真实部署验收记录如下。其余项目仍为**待验收**，当前不应视为合格发布版：

- 公开 + Turnstile 关：已完成本地主题连接真实后端检查。2 个节点，首页与单机 WS 均收到 batchUpdate，四个 REST 接口均返回 200，未发现页面错误。尚未将主题安装到线上。
- 公开 + Turnstile 开：真实挑战、响应凭证、刷新复用。
- 私有 + Turnstile 关：已连接真实后端确认 is_public=false，匿名访问本地构建主题会跳转 /admin#/admin，未发现页面错误。登录后的 Cookie／跨域 JWT 与真实 WS 尚待验证。跳转后内置后台会自行初始化配置，其请求不属于第三方主题。
- 私有 + Turnstile 开：JWT + 真实挑战，列表／WS／历史和过期重验。
- GitHub Actions 远程运行、dist 分支追加历史和 GitHub Pages 实际托管。

测试截图位于 `artifacts/`。进一步验收需要由用户切换后台公开访问和 Turnstile 选项，并自行完成后台登录；不需要提供账户密码或密钥。

## 来源与许可

视觉参考 [jacob-bytes/komari-theme-ink](https://github.com/jacob-bytes/komari-theme-ink)，参考提交 `a706123c603e3b2825dde7302156702e6e8d6612`。保留上游 MIT 许可及版权声明，见 LICENSE。协议实现对照 [huilang-me/CF-Server-Monitor](https://github.com/huilang-me/CF-Server-Monitor/)。
