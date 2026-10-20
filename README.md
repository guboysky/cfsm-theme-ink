# CF-Server-Monitor · Terracotta 主题

紧凑的 Vue 3 第三方主题，适配 CF-Server-Monitor 的现行 API。支持多后端、明暗主题、卡片 / 列表视图、实时流量排行与弹窗详情。

## 安装

在原版管理后台的“自定义主题 URL”中填入构建产物地址：

https://github.com/guboysky/cfsm-theme-ink/tree/dist

这是持续更新的构建分支；固定提交链接见对应发布消息。不要填 main 源码分支。

## 当前界面

- 首页四项摘要：节点总览、按上下行速率之和判断的最忙节点、本月总流量、实时网速。
- 固定最近 10 分钟流量趋势、流量分布、流量排行、实时排行及到期排行；只展示真实数据。排行榜仅显示前五项，删除底部数量 / 合计栏。
- 卡片延迟 / 丢包方块条默认展示最近 1 小时，直接截取列表返回的 ping / loss 窗口；不逐台补查历史。
- 列表包含服务器、系统 / 核心数、续期价格、CPU、内存、存储及上下行速率。
- 点击卡片或展开按钮进入详情弹窗，默认显示延迟监控。机器信息页包括四张圆环资源卡、原始节点资料及双列历史图。
- 详情延迟、资源小图及全部历史趋势默认共用 24 小时数据；可手动切换 10 分钟、30 分钟、1 / 6 / 12 / 24 小时、2 / 4 / 7 天。
- 弹窗支持放大、Esc、遮罩关闭和焦点恢复；关闭后保留首页筛选和滚动位置。
- 详情新增“IP 质量”标签，支持 IPQuality JSON 归档的基本信息、来源评分、风险矩阵、流媒体与 AI、邮件与黑名单、原始归档；无报告显示“未检测”。

## IP 质量自动检测

自动检测通过独立接入 Worker 与 Linux 定时任务实现，保留原探针后台和数据库。Cloudflare 控制台部署、服务绑定、节点安装步骤见 [自动检测接入说明](integrations/ip-quality/README.md)。接入后，管理员可在节点详情生成专用凭证与安装命令，每天自动上传 IPv4 / IPv6 报告，按需查看约 30 天归档。

自动接口仅在后端明确返回 ip_quality_enabled 时使用；旧后端不会请求不存在的接口。报告按节点和后端隔离，首次点击“IP 质量”读取，缓存 5 分钟；实时状态变化不重查，刷新只读取归档，不触发检测。报告不进入原版 WebSocket。自动接入增加 /api/ip-quality（只读）和 /api/ip-quality/setup（管理员生成凭证），原版鉴权仍负责读取权限。

也可导入已有的 [IPQuality](https://github.com/xykt/IPQuality) JSON（单份对象或最多 100 份报告组成的数组，文件上限 2 MB）。导入只保留在本次弹窗内存，关闭即清除，不上传、不写浏览器持久存储。兼容 Head、Info、Type、Score、Factor、Media、Mail；0 分与 false 保留，null / 缺失显示无数据，平台部分支持与超时单独展示。

## 数据与权限

基础监控使用 /api/config、/api/servers、/api/server、/api/history/all、/api/ws、/api/theme_options；自动检测按上节的可选接口接入。配置与首页列表缓存，无 REST 定时轮询；为满足固定 10 分钟趋势，首页对允许显示流量的每个节点首次读取一次 hours=0.167 历史（并发上限 3），随后仅合并原有实时推送，切换节点 / 方向不重查；首页弹窗共用已有实时连接，独立详情仅订阅本节点。隐藏时停止连接和未开始的历史任务，可见时只补当前页面状态并完成尚未开始的初始历史任务；已读取的历史不重查；达到连接时限后由用户主动继续。

保留后端流量、到期、费用与线路显示开关；false / undefined 不展示探测值，null 为超时，0 为有效值。管理及登录使用对应后端 /admin#/admin。地区旗帜和 OS 图标从后端读取。

## 开发与构建

Node.js 24；依次执行 npm ci、npm test、npm run build。构建目录仅包含 index.html 与 assets/。本地演示执行 npm run preview:demo，地址为 http://127.0.0.1:4325，使用隔离样例数据；npm run test:browser 运行浏览器回归。

根目录 .env.example 列出可选构建变量。默认 API_BASE 为空，使用部署后端同源地址。GitHub Actions 在 main / master 更新时构建并追加提交到 dist 分支，保留历史和源码提交说明；可选 Secrets 为 API_BASE、TITLE、BACKGROUND_IMAGE、CSP_API、CSP_STATIC。

验证详情见 VALIDATION.md。tests/fixtures/default-assets 中的图标仅用于演示与测试，包含上游 MIT 许可证，不进入生产构建。

流量图时间轴固定覆盖最近 10 分钟，按 10 秒归集，显示六个时间刻度，悬浮显示柱子的精确时间。历史与实时计数器按节点 / 时间戳合并，防止异步历史返回造成重复计数；断连、重置及长缺口不跨段估算，缺少数据保持空白。UI 时间轴会继续滚动，不触发新的历史请求。
