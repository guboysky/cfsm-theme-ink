// integrations/ip-quality/install.sh
var install_default = `#!/usr/bin/env bash
set -euo pipefail
umask 077
url=''; node=''
while [[ $# -gt 0 ]]; do
  case "$1" in
    --url) url="\${2:?Missing URL}"; shift 2 ;;
    --node) node="\${2:?Missing node ID}"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done
[[ $(id -u) -eq 0 ]] || { echo 'Run this installer with sudo.' >&2; exit 1; }
[[ "$url" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ && -n "$node" && \${#node} -le 128 ]] || { echo 'Invalid HTTPS origin or node ID.' >&2; exit 1; }
command -v systemctl >/dev/null && [[ -d /run/systemd/system ]] || { echo 'This installer requires systemd (Debian/Ubuntu/RHEL). OpenRC is not supported yet.' >&2; exit 1; }
if ! command -v jq >/dev/null || ! command -v bc >/dev/null || ! command -v dig >/dev/null || ! command -v nc >/dev/null || ! command -v flock >/dev/null; then
  if command -v apt-get >/dev/null; then apt-get update; apt-get install -y ca-certificates curl jq bc netcat-openbsd dnsutils iproute2 coreutils util-linux
  elif command -v dnf >/dev/null; then dnf install -y ca-certificates curl jq bc nmap-ncat bind-utils iproute coreutils util-linux
  else echo 'Install curl jq bc nc dig ip timeout flock sha256sum first.' >&2; exit 1
  fi
fi
for cmd in curl jq bc nc dig ip timeout flock sha256sum useradd; do command -v "$cmd" >/dev/null || { echo "Missing dependency: $cmd" >&2; exit 1; }; done
printf 'Paste the report credential from the node details (input hidden): '
IFS= read -rs token < /dev/tty; printf '\\n'
[[ "$token" =~ ^[a-f0-9]{64}$ ]] || { echo 'Invalid credential.' >&2; exit 1; }
work=$(mktemp -d); trap 'rm -rf -- "$work"' EXIT
engine_commit='87397e2c3196ec796f5477c83343c2354df601ea'
engine_sha='b30df5a3c2204276c54e99dcc5080b46f8a627667730aee7de63b109b8ecaecf'
curl --fail --silent --show-error --location --proto '=https' --connect-timeout 15 --max-time 180 "https://raw.githubusercontent.com/xykt/IPQuality/$engine_commit/ip.sh" -o "$work/ipquality.sh"
printf '%s  %s\\n' "$engine_sha" "$work/ipquality.sh" | sha256sum --check --status || { echo 'Collector checksum mismatch.' >&2; exit 1; }
curl --fail --silent --show-error --proto '=https' --connect-timeout 15 --max-time 60 "$url/ip-quality/collector.sh" -o "$work/collector.sh"
bash -n "$work/collector.sh"
id cfsm-ipq >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin cfsm-ipq
systemctl stop cfsm-ipq.service 2>/dev/null || true
install -d -m 0750 -o root -g cfsm-ipq /etc/cfsm-ipq
install -d -m 0755 /usr/local/lib/cfsm-ipq
install -d -m 0700 -o cfsm-ipq -g cfsm-ipq /var/lib/cfsm-ipq
install -m 0755 "$work/ipquality.sh" /usr/local/lib/cfsm-ipq/ipquality.sh
install -m 0755 "$work/collector.sh" /usr/local/lib/cfsm-ipq/collector.sh
jq -n --arg url "$url" --arg node "$node" --arg token "$token" '{url:$url,node:$node,token:$token}' > /etc/cfsm-ipq/config.json
chown root:cfsm-ipq /etc/cfsm-ipq/config.json; chmod 0640 /etc/cfsm-ipq/config.json
unset token
cat > /etc/systemd/system/cfsm-ipq.service <<'UNIT'
[Unit]
Description=CFSM daily IP quality collector
After=network-online.target
Wants=network-online.target
[Service]
Type=oneshot
User=cfsm-ipq
Group=cfsm-ipq
WorkingDirectory=/var/lib/cfsm-ipq
ExecStart=/usr/local/lib/cfsm-ipq/collector.sh
TimeoutStartSec=30min
KillMode=control-group
UMask=0077
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/var/lib/cfsm-ipq
UNIT
cat > /etc/systemd/system/cfsm-ipq.timer <<'TIMER'
[Unit]
Description=Daily CFSM IP quality check
[Timer]
OnCalendar=*-*-* 03:00:00
RandomizedDelaySec=2h
Persistent=true
[Install]
WantedBy=timers.target
TIMER
systemctl daemon-reload
systemctl enable --now cfsm-ipq.timer
systemctl start --no-block cfsm-ipq.service
printf 'Installed. The first check is running; later checks run daily.\\nStatus: journalctl -u cfsm-ipq -n 30 --no-pager\\nRun again: sudo systemctl start cfsm-ipq.service\\n'
`;

// integrations/ip-quality/collector.sh
var collector_default = `#!/usr/bin/env bash
set -euo pipefail
umask 077
config="\${CFSM_IPQ_CONFIG:-/etc/cfsm-ipq/config.json}"
state="\${CFSM_IPQ_STATE:-/var/lib/cfsm-ipq}"
engine="\${CFSM_IPQ_ENGINE:-/usr/local/lib/cfsm-ipq/ipquality.sh}"
mkdir -p "$state"
exec 9>"$state/run.lock"
flock -n 9 || exit 0
url=$(jq -er '.url' "$config"); node=$(jq -er '.node' "$config"); token=$(jq -er '.token' "$config")
[[ "$url" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ && "$token" =~ ^[a-f0-9]{64}$ ]] || { echo 'Invalid collector configuration.' >&2; exit 1; }
work=$(mktemp -d "$state/run.XXXXXX")
trap 'rm -rf -- "$work"' EXIT
# Keep the credential out of command-line arguments and logs.
printf 'Authorization: Bearer %s\\nContent-Type: application/json\\n' "$token" > "$work/headers"
unset token
encoded_node=$(jq -rn --arg node "$node" '$node|@uri')
upload() {
  curl --fail --silent --show-error --proto '=https' --connect-timeout 15 --max-time 60 --retry 2 --retry-delay 35 --header "@$work/headers" --data-binary "@$1" "$url/api/ip-quality/upload?id=$encoded_node" > /dev/null
}
# Retry saved uploads without rerunning external checks. At most two files exist.
for family in v4 v6; do
  pending="$state/pending-$family.json"
  if [[ -f "$pending" ]]; then
    if upload "$pending"; then rm -f -- "$pending"; sleep 31; else echo "$family: previous upload failed; retained for next run." >&2; exit 1; fi
  fi
done
failed=0
for family in v4 v6; do
  flag=4; target='1.1.1.1'; [[ "$family" == v6 ]] && { flag=6; target='2606:4700:4700::1111'; }
  payload="$work/$family.json"; output="$work/$family-output.json"; code=''
  if ! ip "-$flag" route get "$target" >/dev/null 2>&1; then
    code='no_route'
  else
    result=0
    # No self-update, dependency installation, full-IP output or public report upload.
    timeout --kill-after=10s 12m bash "$engine" "-$flag" -j -p -n -E > "$output" 2> "$work/$family.log" || result=$?
    if [[ "$result" -eq 124 || "$result" -eq 137 ]]; then code='timeout'
    elif [[ "$result" -ne 0 ]]; then code='collector_failed'
    elif ! jq -e 'type=="object" and (.Head.IP|type=="string") and ([.Info,.Score,.Factor,.Media,.Mail]|any(type=="object" and length>0))' "$output" >/dev/null 2>&1; then code='invalid_output'
    fi
  fi
  if [[ -n "$code" ]]; then
    jq -n --arg family "$family" --arg error "$code" '{family:$family,error:$error}' > "$payload"
    echo "$family: $code" >&2
    [[ "$code" == no_route ]] || failed=1
  else
    jq -n --arg family "$family" --slurpfile report "$output" '{family:$family,report:$report[0]}' > "$payload"
  fi
  cp "$payload" "$state/pending-$family.json"
  if upload "$payload"; then rm -f -- "$state/pending-$family.json"; echo "$family: report status uploaded."
  else failed=1; echo "$family: upload failed; saved for the next run." >&2
  fi
done
exit "$failed"
`;

// integrations/ip-quality/worker.js
var MAX_BYTES = 256 * 1024;
var json = (value, status = 200, source) => {
  const headers = new Headers({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  for (const name of ["Access-Control-Allow-Origin", "Access-Control-Allow-Credentials", "Vary"]) if (source?.headers.get(name)) headers.set(name, source.headers.get(name));
  return new Response(JSON.stringify(value), { status, headers });
};
var sha256 = async (value) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map((n) => n.toString(16).padStart(2, "0")).join("");
var randomToken = () => [...crypto.getRandomValues(new Uint8Array(32))].map((n) => n.toString(16).padStart(2, "0")).join("");
var quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
var validId = (value) => typeof value === "string" && value.length > 0 && value.length <= 128 && !/[\x00-\x1f]/.test(value);
var object = (value) => value && typeof value === "object" && !Array.isArray(value);
var schemaReady;
async function init(db) {
  if (!db) throw new Error("IPQ_DB binding is required");
  if (!schemaReady) schemaReady = db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS ipq_credentials (node_id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, created_at INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS ipq_reports (node_id TEXT NOT NULL, day TEXT NOT NULL, family TEXT NOT NULL, received_at INTEGER NOT NULL, report TEXT NOT NULL, PRIMARY KEY(node_id,day,family))"),
    db.prepare("CREATE TABLE IF NOT EXISTS ipq_status (node_id TEXT NOT NULL, family TEXT NOT NULL, attempt_at INTEGER NOT NULL, success_at INTEGER, error TEXT, PRIMARY KEY(node_id,family))")
  ]).catch((error) => {
    schemaReady = null;
    throw error;
  });
  await schemaReady;
}
async function upstream(request, env, path) {
  const url = new URL(path, request.url);
  return env.MONITOR.fetch(new Request(url, { method: "GET", headers: request.headers, redirect: "manual" }));
}
async function access(request, env, node, admin = false) {
  if (admin) {
    const response2 = await upstream(request, env, "/api/config");
    if (!response2.ok) return { denied: response2 };
    const config = await response2.json();
    if (config.authorization !== true) return { denied: json({ error: "Administrator login required" }, 401, response2) };
  }
  const response = await upstream(request, env, "/api/server?id=" + encodeURIComponent(node));
  if (!response.ok) return { denied: response };
  const server = await response.json();
  if (String(server.id) !== node) return { denied: json({ error: "Node not found" }, 404, response) };
  return { response };
}
async function boundedJson(request) {
  if (Number(request.headers.get("Content-Length")) > MAX_BYTES) throw Object.assign(new Error("Report is too large"), { status: 413 });
  const reader = request.body?.getReader();
  if (!reader) throw Object.assign(new Error("JSON body required"), { status: 400 });
  let size = 0;
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      throw Object.assign(new Error("Report is too large"), { status: 413 });
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw Object.assign(new Error("Invalid JSON"), { status: 400 });
  }
}
function cleanReport(input, family, receivedAt) {
  if (!object(input) || !object(input.Head) || typeof input.Head.IP !== "string" || !["Info", "Score", "Factor", "Media", "Mail"].some((key) => object(input[key]) && Object.keys(input[key]).length)) throw Object.assign(new Error("Invalid IPQuality report"), { status: 400 });
  const ip = input.Head.IP;
  if (ip.length > 128 || (family === "v4" ? !/^(\d{1,3}|\*)\.(\d{1,3}|\*)\.(\d{1,3}|\*)\.(\d{1,3}|\*)$/.test(ip) : !/^[0-9a-fA-F:*]+$/.test(ip) || !ip.includes(":"))) throw Object.assign(new Error("Report address family mismatch"), { status: 400 });
  const masked = family === "v4" ? ip.split(".").slice(0, 2).join(".") + ".*.*" : ip.split(":").slice(0, 2).join(":") + ":*:*";
  const captured = Date.parse(String(input.Head.Time || ""));
  if (!Number.isFinite(captured) || captured > receivedAt + 3e5 || captured < receivedAt - 30 * 864e5) throw Object.assign(new Error("Report time is invalid or outside the 30-day archive window"), { status: 400 });
  const report = { Head: { IP: masked, Time: new Date(captured).toISOString(), Version: String(input.Head.Version || "").slice(0, 80), Family: family } };
  for (const key of ["Info", "Type", "Score", "Factor", "Media", "Mail"]) if (object(input[key])) report[key] = input[key];
  if (report.Info) {
    report.Info = { ...report.Info };
    delete report.Info.Map;
  }
  return report;
}
var ERROR_CODES = /* @__PURE__ */ new Set(["timeout", "collector_failed", "invalid_output", "no_route", "dependency_missing"]);
async function upload(request, env, node) {
  await init(env.IPQ_DB);
  const token = request.headers.get("Authorization")?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (!token) return json({ error: "Invalid report credential" }, 401);
  const credential = await env.IPQ_DB.prepare("SELECT token_hash FROM ipq_credentials WHERE node_id=?").bind(node).first();
  if (!credential || credential.token_hash !== await sha256(token)) return json({ error: "Invalid report credential" }, 401);
  const body = await boundedJson(request);
  if (!["v4", "v6"].includes(body.family)) return json({ error: "family must be v4 or v6" }, 400);
  const now = Date.now(), family = body.family;
  const previous = await env.IPQ_DB.prepare("SELECT attempt_at FROM ipq_status WHERE node_id=? AND family=?").bind(node, family).first();
  if (previous && now - previous.attempt_at < 3e4) return json({ error: "Please wait before uploading again" }, 429);
  if (body.report) {
    const report = cleanReport(body.report, family, now);
    const day = report.Head.Time.slice(0, 10), captured = Date.parse(report.Head.Time);
    await env.IPQ_DB.batch([
      env.IPQ_DB.prepare("INSERT INTO ipq_reports VALUES (?,?,?,?,?) ON CONFLICT(node_id,day,family) DO UPDATE SET received_at=excluded.received_at,report=excluded.report").bind(node, day, family, now, JSON.stringify(report)),
      env.IPQ_DB.prepare("INSERT INTO ipq_status VALUES (?,?,?,?,NULL) ON CONFLICT(node_id,family) DO UPDATE SET attempt_at=excluded.attempt_at,success_at=excluded.success_at,error=NULL").bind(node, family, now, captured),
      env.IPQ_DB.prepare("DELETE FROM ipq_reports WHERE node_id=? AND day<?").bind(node, new Date(now - 30 * 864e5).toISOString().slice(0, 10))
    ]);
  } else {
    const code = ERROR_CODES.has(body.error) ? body.error : "collector_failed";
    await env.IPQ_DB.prepare("INSERT INTO ipq_status VALUES (?,?,?,NULL,?) ON CONFLICT(node_id,family) DO UPDATE SET attempt_at=excluded.attempt_at,error=excluded.error").bind(node, family, now, code).run();
  }
  return json({ ok: true });
}
async function handle(request, env) {
  const url = new URL(request.url), path = url.pathname;
  if (!env.MONITOR) return json({ error: "Bind the existing CFSM Worker as MONITOR" }, 503);
  if (request.method === "GET" && ["/ip-quality/install.sh", "/ip-quality/collector.sh"].includes(path)) return new Response(path.endsWith("/install.sh") ? install_default : collector_default, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=300" } });
  if (path === "/api/ip-quality" || path.startsWith("/api/ip-quality/")) {
    if (request.method === "OPTIONS") return env.MONITOR.fetch(request);
    const node = url.searchParams.get("id");
    if (!validId(node)) return json({ error: "Valid node id required" }, 400);
    if (path === "/api/ip-quality/upload" && request.method === "POST") return upload(request, env, node);
    const setup = path === "/api/ip-quality/setup" && request.method === "POST";
    if (!setup && !(path === "/api/ip-quality" && request.method === "GET")) return json({ error: "Not found" }, 404);
    if (setup && (request.headers.get("Origin") && request.headers.get("Origin") !== url.origin || request.headers.get("Sec-Fetch-Site") === "cross-site")) return json({ error: "Use the gateway page to configure automatic checks" }, 403);
    const gate = await access(request, env, node, setup);
    if (gate.denied) return gate.denied;
    await init(env.IPQ_DB);
    if (setup) {
      const token = randomToken();
      await env.IPQ_DB.prepare("INSERT INTO ipq_credentials VALUES (?,?,?) ON CONFLICT(node_id) DO UPDATE SET token_hash=excluded.token_hash,created_at=excluded.created_at").bind(node, await sha256(token), Date.now()).run();
      const base = url.origin;
      const install = `bash "$ipq_file" --url ${quote(base)} --node ${quote(node)}`;
      return json({ token, command: `ipq_file=$(mktemp) && curl -fsSL ${quote(base + "/ip-quality/install.sh")} -o "$ipq_file" && if [ "$(id -u)" = 0 ]; then ${install}; else sudo ${install}; fi` }, 200, gate.response);
    }
    const day = url.searchParams.get("date");
    if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) return json({ error: "Invalid archive date" }, 400, gate.response);
    const cutoff = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    if (day && day < cutoff) return json({ error: "Archive is outside the retention window" }, 400, gate.response);
    const db = env.IPQ_DB;
    const [{ results: archives }, { results: states }, credential] = await Promise.all([
      db.prepare("SELECT day,family,received_at FROM ipq_reports WHERE node_id=? AND day>=? ORDER BY day DESC,family LIMIT 64").bind(node, cutoff).all(),
      db.prepare("SELECT family,attempt_at,success_at,error FROM ipq_status WHERE node_id=?").bind(node).all(),
      db.prepare("SELECT created_at FROM ipq_credentials WHERE node_id=?").bind(node).first()
    ]);
    const query = day ? db.prepare("SELECT report FROM ipq_reports WHERE node_id=? AND day=? ORDER BY family").bind(node, day) : db.prepare("SELECT report FROM ipq_reports r WHERE node_id=? AND day>=? AND day=(SELECT MAX(day) FROM ipq_reports WHERE node_id=r.node_id AND family=r.family) ORDER BY family").bind(node, cutoff);
    const { results } = await query.all();
    return json({ reports: results.map((row) => JSON.parse(row.report)), archives, states, configured: !!credential }, 200, gate.response);
  }
  const response = await env.MONITOR.fetch(request);
  if (path === "/api/config" && request.method === "GET" && response.ok) {
    const value = await response.clone().json();
    return json({ ...value, ip_quality_enabled: !!env.IPQ_DB }, 200, response);
  }
  return response;
}
var worker_default = { async fetch(request, env) {
  try {
    return await handle(request, env);
  } catch (error) {
    console.error("IP quality extension:", error.message);
    return json({ error: error.status ? error.message : "IP quality service unavailable; check Worker bindings" }, error.status || 503);
  }
} };
export {
  worker_default as default
};
