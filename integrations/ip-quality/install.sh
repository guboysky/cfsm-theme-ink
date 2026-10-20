#!/usr/bin/env bash
set -euo pipefail
umask 077
url=''; node=''
while [[ $# -gt 0 ]]; do
  case "$1" in
    --url) url="${2:?Missing URL}"; shift 2 ;;
    --node) node="${2:?Missing node ID}"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done
[[ $(id -u) -eq 0 ]] || { echo 'Run this installer with sudo.' >&2; exit 1; }
[[ "$url" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ && -n "$node" && ${#node} -le 128 ]] || { echo 'Invalid HTTPS origin or node ID.' >&2; exit 1; }
command -v systemctl >/dev/null && [[ -d /run/systemd/system ]] || { echo 'This installer requires systemd (Debian/Ubuntu/RHEL). OpenRC is not supported yet.' >&2; exit 1; }
if ! command -v jq >/dev/null || ! command -v bc >/dev/null || ! command -v dig >/dev/null || ! command -v nc >/dev/null || ! command -v flock >/dev/null; then
  if command -v apt-get >/dev/null; then apt-get update; apt-get install -y ca-certificates curl jq bc netcat-openbsd dnsutils iproute2 coreutils util-linux
  elif command -v dnf >/dev/null; then dnf install -y ca-certificates curl jq bc nmap-ncat bind-utils iproute coreutils util-linux
  else echo 'Install curl jq bc nc dig ip timeout flock sha256sum first.' >&2; exit 1
  fi
fi
for cmd in curl jq bc nc dig ip timeout flock sha256sum useradd; do command -v "$cmd" >/dev/null || { echo "Missing dependency: $cmd" >&2; exit 1; }; done
printf 'Paste the report credential from the node details (input hidden): '
IFS= read -rs token < /dev/tty; printf '\n'
[[ "$token" =~ ^[a-f0-9]{64}$ ]] || { echo 'Invalid credential.' >&2; exit 1; }
work=$(mktemp -d); trap 'rm -rf -- "$work"' EXIT
engine_commit='87397e2c3196ec796f5477c83343c2354df601ea'
engine_sha='b30df5a3c2204276c54e99dcc5080b46f8a627667730aee7de63b109b8ecaecf'
curl --fail --silent --show-error --location --proto '=https' --connect-timeout 15 --max-time 180 "https://raw.githubusercontent.com/xykt/IPQuality/$engine_commit/ip.sh" -o "$work/ipquality.sh"
printf '%s  %s\n' "$engine_sha" "$work/ipquality.sh" | sha256sum --check --status || { echo 'Collector checksum mismatch.' >&2; exit 1; }
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
printf 'Installed. The first check is running; later checks run daily.\nStatus: journalctl -u cfsm-ipq -n 30 --no-pager\nRun again: sudo systemctl start cfsm-ipq.service\n'
