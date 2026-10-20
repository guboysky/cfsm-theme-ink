# CF-Server-Monitor · Terracotta 主题

紧凑的 Vue 3 第三方主题，适配 CF-Server-Monitor 的现行 API。支持多后端、明暗主题、卡片 / 列表视图、实时流量排行与弹窗详情。

## 安装

在原版管理后台的“自定义主题 URL”中填入构建产物地址：

https://github.com/guboysky/cfsm-theme-ink/tree/6c5642e93e833464b25b0628e67ae6acaae75010

这是固定构建版本。持续跟随更新可使用 https://github.com/guboysky/cfsm-theme-ink/tree/dist 。不要填 main 源码分支。

## 当前界面

- 首页四项摘要：节点总览、按上下行速率之和判断的最忙节点、本月总流量、实时网速。
- 固定最近 10 分钟流量趋势、流量分布、流量排行、实时排行及到期排行；只展示真实数据。排行榜仅显示前五项，删除底部数量 / 合计栏。
- 卡片延迟 / 丢包方块条默认展示最近 1 小时，直接截取列表返回的 ping / loss 窗口；不逐台补查历史。
- 列表包含服务器、系统 / 核心数、续期价格、CPU、内存、存储及上下行速率。
- 点击卡片或展开按钮进入详情弹窗，默认显示延迟监控。机器信息页包括四张圆环资源卡、原始节点资料及双列历史图。
- 详情延迟、资源小图及全部历史趋势默认共用 24 小时数据；可手动切换 10 分钟、30 分钟、1 / 6 / 12 / 24 小时、2 / 4 / 7 天。
- 弹窗支持放大、Esc、遮罩关闭和焦点恢复；关闭后保留首页筛选和滚动位置。

## 数据与权限

仅使用 /api/config、/api/servers、/api/server、/api/history/all、/api/ws、/api/theme_options。配置与首页列表缓存，无 REST 定时轮询；为满足固定 10 分钟趋势，首页对允许显示流量的每个节点首次读取一次 hours=0.167 历史（并发上限 3），随后仅合并原有实时推送，切换节点 / 方向不重查；首页弹窗共用已有实时连接，独立详情仅订阅本节点。隐藏时停止连接和未开始的历史任务，可见时只补当前页面状态并完成尚未开始的初始历史任务；已读取的历史不重查；达到连接时限后由用户主动继续。

保留后端流量、到期、费用与线路显示开关；false / undefined 不展示探测值，null 为超时，0 为有效值。管理及登录使用对应后端 /admin#/admin。地区旗帜和 OS 图标从后端读取。

## 开发与构建

Node.js 24；依次执行 npm ci、npm test、npm run build。构建目录仅包含 index.html 与 assets/。本地演示执行 npm run preview:demo，地址为 http://127.0.0.1:4325，使用隔离样例数据；npm run test:browser 运行浏览器回归。

根目录 .env.example 列出可选构建变量。默认 API_BASE 为空，使用部署后端同源地址。GitHub Actions 在 main / master 更新时构建并追加提交到 dist 分支，保留历史和源码提交说明；可选 Secrets 为 API_BASE、TITLE、BACKGROUND_IMAGE、CSP_API、CSP_STATIC。

验证详情见 VALIDATION.md。tests/fixtures/default-assets 中的图标仅用于演示与测试，包含上游 MIT 许可证，不进入生产构建。

流量图时间轴固定覆盖最近 10 分钟，按 10 秒归集，显示六个时间刻度，悬浮显示柱子的精确时间。历史与实时计数器按节点 / 时间戳合并，防止异步历史返回造成重复计数；断连、重置及长缺口不跨段估算，缺少数据保持空白。UI 时间轴会继续滚动，不触发新的历史请求。
