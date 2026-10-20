# 自动 IP 质量检测接入（Cloudflare 控制台 + Linux）

这是 CF-Server-Monitor 的独立接入 Worker。原版后台、原数据库、探针更新与 WebSocket 由服务绑定转发，报告单独保存在新 D1 数据库。无需替换 V2.8.5 Beta1 的程序，也无需修改已有 cf-probe 配置。

链路：Linux 节点每日检测 → 接入 Worker 接收报告 → 新 D1 保存归档 → 详情“IP 质量”按需读取。查看网页不会执行检测。

## 1. 更新主题

在原探针后台的自定义主题 URL 中安装本仓库最新 `dist` 构建：

https://github.com/guboysky/cfsm-theme-ink/tree/dist

## 2. 在 Cloudflare 创建接入 Worker

1. 新建一个 Worker，例如 `cfsm-ip-quality`。保留原探针 Worker。
2. 打开这个新 Worker 的代码编辑器，将 **[worker.js](worker.js)** 的完整内容替换进去并部署。此文件已经打包，没有外部模块，不需要在控制台编译。兼容日期设为 `2025-01-01` 或更新。
3. 新建一个 D1 数据库，例如 `cfsm-ip-quality`，用于检测报告。
4. 在新 Worker 的绑定页添加以下两个绑定，然后重新部署：

| 类型 | 变量名（严格区分大小写） | 选择的资源 |
|---|---|---|
| 服务 / Service binding | `MONITOR` | 你原来运行 V2.8.5 Beta1 的探针 Worker，默认入口 |
| D1 数据库 | `IPQ_DB` | 刚刚新建的报告数据库 |

参考 Cloudflare 官方文档：[服务绑定](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)、[创建和绑定 D1](https://developers.cloudflare.com/d1/get-started/)。

表结构会在首次使用接口时创建，不需要手工执行 SQL，也不需要填写原探针的 API_SECRET 或数据库 ID 到脚本里。接入 Worker 不需要 Cron；检测定时任务安装在节点上。

## 3. 从新 Worker 地址打开面板

使用新 Worker 的 HTTPS 地址（例如 Cloudflare 分配的 `cfsm-ip-quality.你的子域.workers.dev`）访问面板，并用原后台账号登录。这里看到的仍是原探针数据。

验证：访问新地址的 `/api/config`，应包含 `ip_quality_enabled: true`。旧地址没有此字段是正常的。已有 cf-probe 仍可上报旧地址。

如果主题曾手动固定了 API_BASE 为旧域名，需要重新使用 API_BASE 为空的主题构建，或把它改为新地址；本仓库默认构建使用同源地址。先使用新 Worker 自带地址验证，之后再按需给新入口绑定自定义域名。

## 4. 给每个 Linux 节点安装一次

1. 打开对应节点详情 → IP 质量 → 自动检测接入。
2. 点击“生成节点安装信息”。
3. 复制安装命令，在这一台节点的终端执行。
4. 安装器提示输入凭证时，点击“复制报告凭证”并粘贴。

初次安装会安装缺失依赖、校验并下载固定版本检测脚本，创建独立用户 `cfsm-ipq`，立即启动首次检测。以后按节点本地时间每天 03:00–05:00 分散执行。首次检测可能需要几分钟；完成后详情页点击“刷新报告”。

支持 systemd 的 Debian / Ubuntu / RHEL / Fedora 等 Linux（自动安装依赖目前覆盖 apt-get 与 dnf）。Alpine/OpenRC 和 Windows 尚未包含自动安装支持；安装器会明确退出，不会显示安装成功。

查看日志：

```sh
journalctl -u cfsm-ipq -n 30 --no-pager
```

手动再跑一次：

```sh
sudo systemctl start cfsm-ipq.service
```

查看定时任务：

```sh
systemctl list-timers cfsm-ipq.timer
```

重新生成凭证会使旧凭证失效；之后需在该节点重新执行安装命令并输入新凭证。普通查看与刷新不会生成凭证。

## 数据与行为

- 每个节点独立的报告上传凭证，只能写自己的报告。服务器保存 SHA-256 摘要，前端仅在生成当次显示原凭证，不写浏览器存储。
- 读取报告沿用原探针的公开 / 私有、登录、隐藏节点及 Turnstile 判断。安装凭证不提供报告读取或后台管理权限。
- IPv4 / IPv6 分别检测；缺少网络路由会显示“未配置此网络出口”。
- 保留约 30 天的 UTC 日期归档，每节点 / 日期 / 协议仅保存一份。首次打开只返回最近 30 天内的最新报告与日期目录，切换日期才读取当天报告。过期存档在该节点下次成功上传时清理；离线期间存储量不再增加。前端缓存 5 分钟，不轮询。
- 检测超时、无效输出、上传失败均有失败状态。失败不会删除上次成功报告；上传失败最多保留每个协议一份待传报告，下次先补传。
- 每个协议检测上限 12 分钟，任务整体上限 30 分钟，并用锁防止并发重复检测。
- 存储前遮罩 IP，删除原始命令与地图链接；归档时间保留实际检测时间，另记接收时间。原版实时推送不携带检测报告。
- 同一节点同一协议上报最短间隔 30 秒；文件上限 256 KiB。异常原始日志留在本次临时目录，不上传凭证、终端日志或 shell 命令。

检测器使用 [xykt/IPQuality](https://github.com/xykt/IPQuality) 的独立进程，固定到提交 `87397e2c3196ec796f5477c83343c2354df601ea` 并校验 SHA-256；遵循其 AGPL-3.0 协议。运行启用隐私模式，不生成其公开报告链接。部分数据库依赖第三方可用性和额度，缺失结果保持无数据。检测不会修复 IP 风控，也不保证平台账号或播放可用。

## 故障定位

| 页面状态 | 检查事项 |
|---|---|
| 仍提示需要部署后端 | 是否从新接入地址访问、主题是否为最新版本、`IPQ_DB` 是否已绑定 |
| `MONITOR` 未绑定 | 绑定的变量名必须为 `MONITOR`，目标选原探针，不能选接入 Worker 自己 |
| IP quality service unavailable | 查看接入 Worker 日志，检查 `IPQ_DB` 数据库绑定 |
| 等待节点首次上报 | 查看节点 `journalctl -u cfsm-ipq`；确认安装命令在正确节点执行 |
| 401 上传失败 | 凭证可能已重新生成，需要重新安装并粘贴当前凭证 |
| 403 / Cloudflare 验证页 | WAF / Access 需允许节点访问接入 Worker 的 `/api/ip-quality/upload`；接口自身仍校验专用凭证 |
| 无效检测输出 | 节点可能无法访问检测数据源，检查其出口网络；先保留上次报告 |

## 开发者构建

在 Node.js 环境安装 esbuild 后运行 `node build.mjs`。项目验证脚本也可通过 `CFSM_SOURCE` 指向一个已安装 esbuild / miniflare 的本地 CFSM 源码目录。

`release/worker.js` 是控制台部署文件，`release/SHA256SUMS` 可核对文件完整性。不要把未打包的根目录 `worker.js` 单独粘贴进控制台，它依赖同目录安装脚本。

当前已完成本地 D1、权限隔离和浏览器测试；Cloudflare 生产部署及真实节点的首次检测，需要上述安装步骤后验证。
