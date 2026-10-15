# Ink for CF-Server-Monitor

将 [komari-theme-ink](https://github.com/jacob-bytes/komari-theme-ink) 的深蓝黑／冷灰视觉移植为 CF-Server-Monitor 独立 Vue 3 主题。数据层重新实现，不包含 Komari API、登录页或后台管理功能。

**当前状态：可构建、自动化测试通过；尚未达到完整发布验收。** 已用本地构建主题连接用户真实后端，完成公开访问开启／Turnstile 关闭组合的列表、WebSocket 和详情历史检查，未修改线上部署。其余三种组合与后台登录尚待验证。当前参考后端的 Turnstile 凭证返回问题也尚待实站确认，见下文。artifacts 中的截图仍为模拟数据。

## 本地运行与构建

界面对照参考截图提供四块总览、四列卡片、地区／分组筛选、卡片／文字列表切换及收藏；详情提供设备信息、合并指标图、可切换图例和共用历史范围的探测曲线。布局与收藏在本次页面内暂存；已移除主题选项、搜索和紧凑视图入口，不再通过页面保存站点主题选项。

数据边界：高负载表示在线节点 CPU ≥80% 或内存 ≥90%；在线／总数／离线仍使用后端 stats 快照。总流量为已返回的累计计数，不冒充今日流量。卡片额度使用后端 traffic_limit（GiB）和 monthly 计数，遵守 dl／ul／max／total 口径。详情采样覆盖条只显示当前已加载时间范围的真实采样，不代表 7 天在线率；7 天范围仅用户主动选择后请求。旗帜、系统图标、价格、到期时间和分组都来自当前站点，未返回的数据不填造。

### 在后台预览测试产物

仓库 dist 分支存放可安装测试产物。后台“主题商店”→“自定义主题 URL”填写 `https://github.com/guboysky/cfsm-theme-ink/tree/dist`，点击“预览”。此流程由内置后台管理，第三方主题不会调用管理接口。预览仅作用于当前浏览器；正式应用仍需完成下文待验收项。需要固定某次验收版本时，把 URL 的 dist 替换成该分支的完整 commit SHA。

此安装方式由 Worker 代理 GitHub 的静态文件，主题使用同源 API；无需启用 Pages 或为预览额外配置 API_BASE。独立静态托管才需要下面的跨域配置。

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
- 主题配置从 config.theme_options 合并默认值；当前只提供卡片和文字列表切换，旧 compact 设置回退到普通卡片，忽略旧密度设置。界面没有主题选项保存入口。

标题、背景、语言、明暗模式来自 config，标题／背景可用构建 meta 提供后备。支持 zh/en/es；auto 跟随浏览器。后台提供 custom_head/custom_script 时应用，并暴露资源加载错误。当前参考后端 config 并未返回 custom_bg/custom_bg_mobile/custom_head/custom_script：同源部署依靠后端注入 HTML；独立静态部署要让后端在 config 暴露这些外观字段，或使用环境变量提供背景，不能增加其他配置查询接口。旗帜与系统图标使用对应 Worker 的 `/flags/`、`/os-icons/`。

## 必须解决：参考后端 Turnstile 凭证

核对后端提交 `fa60c60d7a5e872c874fe92822206b32d072c3af`：

1. `/api/config` 未带验证头时可用于初始化，只有它的响应体会填入 `turnstile_verified`。
2. `/api/servers`、`/api/server` 等接口首次验证成功后，路由公共响应分支计算了 `encryptedData`，但没有放入响应体或可读响应头，也没有设置对应验证 Cookie。
3. 因此在 config 只查一次的约束下，主题拿不到后续可复用凭证；Turnstile 单次 token 也不能重复使用。不能通过重复查询 config 规避。

[`docs/backend-turnstile.patch`](docs/backend-turnstile.patch) 提供针对该提交的最小后端补丁：对验证成功的 JSON 对象响应追加 turnstile_verified。它不修改此主题的接口范围，也不会额外查询 D1。补丁**未替用户部署或提交到上游**；应用后还需要真实 Turnstile 环境验证。主题已支持数据响应中的凭证缓存（按后端隔离），403 清缓存并交互重验，仅重试一次，401 清 JWT 跳内置后台，不 reload。

## 验证与待验收

自动化测试覆盖四种组合的前端接口契约、匿名私站跳转、401／403、验证缓存复用、路由请求次数、独立详情订阅、隐藏恢复、WS 节流与增量字段、指数退避上限、多站 ID 隔离、跨域 JWT、连接超时交互、旧布局配置兼容、价格/到期显示开关、桌面深浅色和移动端布局。模拟 Turnstile 不等同 Cloudflare 实际人机验证。

真实部署验收记录如下。其余项目仍为**待验收**，当前不应视为合格发布版：

- 公开 + Turnstile 关：已完成本地主题连接真实后端检查。2 个节点，首页与单机 WS 均收到 batchUpdate，四个 REST 接口均返回 200，未发现页面错误。尚未将主题安装到线上。
- 公开 + Turnstile 开：真实挑战、响应凭证、刷新复用。
- 私有 + Turnstile 关：已连接真实后端确认 is_public=false，匿名访问本地构建主题会跳转 /admin#/admin，未发现页面错误。登录后的 Cookie／跨域 JWT 与真实 WS 尚待验证。跳转后内置后台会自行初始化配置，其请求不属于第三方主题。
- 私有 + Turnstile 开：JWT + 真实挑战，列表／WS／历史和过期重验。
- GitHub Actions 已通过构建及自动化检查，dist 预览分支已按追加方式更新；GitHub Pages 实际托管仍待验收。

测试截图位于 `artifacts/`。进一步验收需要由用户切换后台公开访问和 Turnstile 选项，并自行完成后台登录；不需要提供账户密码或密钥。

## 来源与许可

视觉参考 [jacob-bytes/komari-theme-ink](https://github.com/jacob-bytes/komari-theme-ink)，参考提交 `a706123c603e3b2825dde7302156702e6e8d6612`。保留上游 MIT 许可及版权声明，见 LICENSE。协议实现对照 [huilang-me/CF-Server-Monitor](https://github.com/huilang-me/CF-Server-Monitor/)。

## 字体、节点备注与信息标签

主题随构建打包 Inter Variable 字体，无需外部字体 CDN。中文回退到系统无衬线字体；字体 OFL 许可随构建放在 `assets/inter-OFL.txt`。

卡片底部仅展示接口实际返回的 `note`，按换行、逗号或分号拆成标签；不会用 Default、分组或 IP 状态冒充备注。IPv4/IPv6 位于卡片右侧信息区，价格位于其下方。文字列表的「剩余日期」列仅展示剩余天数与价格，例如「剩余 17 天 / €14.99 / 月」，并遵守后端 show_expire/show_price 开关。节点名称下方不再重复展示价格和剩余天数。

参考后端 `fa60c60d7a5e872c874fe92822206b32d072c3af` 的 `withoutPrivateServerFields` 在列表和详情中无条件移除了 note，所以仅修改主题不能读取后台备注。可选补丁 [`docs/backend-public-note.patch`](docs/backend-public-note.patch) 仅公开以 `[public]` 开头的备注，返回时去掉标记；其他备注继续隐藏，不增加查询。应用补丁并重新部署后端后，可在需要公开的节点备注填写 `[public] CN2 GIA, 备用节点`。补丁未自动应用到用户站点，不通过后台管理接口读取备注。

详情的节点切换器仅使用已缓存的首页列表；直接打开单机详情时只显示当前节点，不额外请求列表。

## 紧凑布局与背景设置

整站最大内容宽度为 1280px，移动端保留自适应边距；列表收紧信息列和行距。在线时长显示小时、分钟（如 `在线 3小时0分`，超过一天显示 `在线 3天1小时1分`）；IP 状态位于卡片右上方，到期日期显示为 `2026.11.1`。图表时间轴按实际时间均匀排布刻度，不随密集新增采样挤在一起。

探针保留后台自定义名称；中文界面未配置名称或使用 CT/CU/CM 默认代码时显示电信、联通、移动，不猜测探针所在省份。可在后台自定义为广东电信等名称。

后台登录图标已移除，仍可直接访问 Worker 的 `/admin#/admin`。齿轮主题选项、搜索与紧凑视图入口已移除。背景图片已由后台支持，在「设置 → 外观」中填写图片地址或上传桌面/手机背景。同源部署直接沿用后端注入的背景样式，不增加管理 API 请求。
