#!/usr/bin/env bash
set -euo pipefail
umask 077
config="${CFSM_IPQ_CONFIG:-/etc/cfsm-ipq/config.json}"
state="${CFSM_IPQ_STATE:-/var/lib/cfsm-ipq}"
engine="${CFSM_IPQ_ENGINE:-/usr/local/lib/cfsm-ipq/ipquality.sh}"
mkdir -p "$state"
exec 9>"$state/run.lock"
flock -n 9 || exit 0
url=$(jq -er '.url' "$config"); node=$(jq -er '.node' "$config"); token=$(jq -er '.token' "$config")
[[ "$url" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ && "$token" =~ ^[a-f0-9]{64}$ ]] || { echo 'Invalid collector configuration.' >&2; exit 1; }
work=$(mktemp -d "$state/run.XXXXXX")
trap 'rm -rf -- "$work"' EXIT
# Keep the credential out of command-line arguments and logs.
printf 'Authorization: Bearer %s\nContent-Type: application/json\n' "$token" > "$work/headers"
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
