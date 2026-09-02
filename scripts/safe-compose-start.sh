#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
lock_path=/run/lock/vps-heavy-operation.lock
sample_seconds=5
max_load_one=10
max_steal=40
min_idle=20
max_busy=80
max_iowait=35
min_available_mib=4096

usage() {
  printf 'Usage: %s check | build app | start app | recreate app\n' "${0##*/}" >&2
  exit 64
}

float_ge() { awk -v left="$1" -v right="$2" 'BEGIN { exit !(left >= right) }'; }
float_le() { awk -v left="$1" -v right="$2" 'BEGIN { exit !(left <= right) }'; }

sample_cpu() {
  LC_ALL=C mpstat 1 "$sample_seconds" |
    awk '$1 == "Average:" && $2 == "all" { printf "%s %s %s %s %s", $3, $5, $6, $9, $12 }'
}

active_docker_mutation() {
  local process_dir process_name token
  for process_dir in /proc/[0-9]*; do
    IFS= read -r process_name 2>/dev/null <"${process_dir}/comm" || continue
    case "$process_name" in docker|docker-compose) ;; *) continue ;; esac
    while IFS= read -r -d '' token; do
      case "$token" in
        build|up|create|start|restart|unpause|run|stop|down|rm|pull) return 0 ;;
      esac
    done 2>/dev/null <"${process_dir}/cmdline" || true
  done
  return 1
}

active_heavy_work() {
  pgrep -x docker-buildx >/dev/null 2>&1 ||
    pgrep -x buildctl >/dev/null 2>&1 ||
    pgrep -x ffmpeg >/dev/null 2>&1 ||
    pgrep -f '[n]pm (ci|run (verify|test|build))' >/dev/null 2>&1 ||
    pgrep -f '[v]itest( |$)' >/dev/null 2>&1 ||
    pgrep -f '[r]ife( |$)' >/dev/null 2>&1 ||
    active_docker_mutation
}

check_critical_health() {
  local url code
  local -a urls=(
    https://livaigo.fr/api/health
    https://start.jimtrebes.fr/api/health
    https://time.jimtrebes.fr/api/health
    https://finance.jimtrebes.fr/api/health
  )
  for url in "${urls[@]}"; do
    code="$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 10 "$url" 2>/dev/null || true)"
    if [[ "$code" != "200" ]]; then
      printf 'priority healthcheck failed: %s returned %s\n' "$url" "${code:-network-error}" >&2
      return 1
    fi
  done
}

active_public_container_ids() {
  docker ps --quiet --filter label=traefik.enable=true
}

check_container_fleet_health() {
  local names name state health status=0
  local -a public_ids=()

  names="$(docker ps --filter status=restarting --format '{{.Names}}' | paste -sd, -)"
  [[ -z "$names" ]] || { printf 'restarting containers: %s\n' "$names" >&2; status=1; }
  names="$(docker ps --filter health=unhealthy --format '{{.Names}}' | paste -sd, -)"
  [[ -z "$names" ]] || { printf 'unhealthy containers: %s\n' "$names" >&2; status=1; }
  names="$(docker ps --filter health=starting --format '{{.Names}}' | paste -sd, -)"
  [[ -z "$names" ]] || { printf 'containers still starting: %s\n' "$names" >&2; status=1; }

  mapfile -t public_ids < <(active_public_container_ids)
  ((${#public_ids[@]} > 0)) || { printf 'no active Traefik service found\n' >&2; return 1; }
  while IFS='|' read -r name state health; do
    name="${name#/}"
    if [[ "$state" != running || "$health" != healthy ]]; then
      printf 'public service %s is %s/%s\n' "$name" "$state" "$health" >&2
      status=1
    fi
  done < <(docker inspect --format \
    '{{.Name}}|{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}missing-healthcheck{{end}}' \
    "${public_ids[@]}")
  return "$status"
}

active_public_hosts() {
  local -a public_ids=()
  mapfile -t public_ids < <(active_public_container_ids)
  ((${#public_ids[@]} > 0)) || return 0
  docker inspect --format \
    '{{range $key, $value := .Config.Labels}}{{printf "%s=%s\n" $key $value}}{{end}}' \
    "${public_ids[@]}" |
    awk -F= '$1 ~ /^traefik\.http\.routers\..*\.rule$/ {
      rule=substr($0,index($0,"=")+1)
      while (match(rule,/Host\(`[^`]+`\)/)) {
        print substr(rule,RSTART+6,RLENGTH-8)
        rule=substr(rule,RSTART+RLENGTH)
      }
    }' | sort -u
}

check_active_public_ingress() {
  local host code pid status=0
  local -a hosts=() pids=()
  mapfile -t hosts < <(active_public_hosts)
  ((${#hosts[@]} > 0)) || { printf 'no active Traefik hostname found\n' >&2; return 1; }
  for host in "${hosts[@]}"; do
    (
      code="$(curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 3 --max-time 8 \
        "https://${host}/" 2>/dev/null || true)"
      [[ "$code" =~ ^[1-4][0-9][0-9]$ ]] || {
        printf 'https://%s/ returned %s\n' "$host" "${code:-network-error}" >&2
        exit 1
      }
    ) &
    pids+=("$!")
  done
  for pid in "${pids[@]}"; do wait "$pid" || status=1; done
  return "$status"
}

check_global_service_health() {
  local public_container_count public_host_count status=0
  check_critical_health || status=1
  check_container_fleet_health || status=1
  check_active_public_ingress || status=1
  if ((status == 0)); then
    public_container_count="$(active_public_container_ids | wc -l)"
    public_host_count="$(active_public_hosts | wc -l)"
    printf 'fleet health passed: critical_urls=4 public_containers=%s public_hosts=%s\n' \
      "$public_container_count" "$public_host_count"
  fi
  return "$status"
}

preflight() {
  local sample user_cpu system_cpu iowait_cpu steal_cpu idle_cpu load_one available_mib busy_cpu
  local pressure_count=0
  local -a failures=() pressure_signals=()
  docker compose config --quiet || failures+=("Compose configuration is invalid")
  systemctl is-active --quiet docker-resource-guard.service || failures+=("docker-resource-guard.service is not active")
  systemctl is-active --quiet vps-cpu-watch.timer || failures+=("vps-cpu-watch.timer is not active")
  active_heavy_work && failures+=("a build, test suite, FFmpeg, RIFE, or Docker mutation is already active")
  check_global_service_health || failures+=("the active application fleet or public ingress is degraded")

  sample="$(sample_cpu || true)"
  if [[ -z "$sample" ]]; then
    failures+=("CPU sample is unavailable")
    user_cpu=0 system_cpu=0 iowait_cpu=0 steal_cpu=100 idle_cpu=0
  else
    read -r user_cpu system_cpu iowait_cpu steal_cpu idle_cpu <<<"$sample"
  fi
  load_one="$(awk '{print $1}' /proc/loadavg)"
  available_mib="$(awk '/^MemAvailable:/ {printf "%d", $2 / 1024}' /proc/meminfo)"
  busy_cpu="$(awk -v user="$user_cpu" -v syscpu="$system_cpu" 'BEGIN {printf "%.2f", user + syscpu}')"

  if float_ge "$load_one" "$max_load_one"; then pressure_signals+=("load>=${max_load_one}"); ((pressure_count += 1)); fi
  if float_ge "$steal_cpu" 60; then failures+=("CPU steal must stay below 60%")
  elif float_ge "$steal_cpu" "$max_steal"; then pressure_signals+=("steal>=${max_steal}%"); ((pressure_count += 1)); fi
  if float_le "$idle_cpu" 10; then failures+=("CPU idle must stay above 10%")
  elif float_le "$idle_cpu" "$min_idle"; then pressure_signals+=("idle<=${min_idle}%"); ((pressure_count += 1)); fi
  if float_ge "$busy_cpu" 90; then failures+=("user + system CPU must stay below 90%")
  elif float_ge "$busy_cpu" "$max_busy"; then pressure_signals+=("user+system>=${max_busy}%"); ((pressure_count += 1)); fi
  if float_ge "$iowait_cpu" 50; then failures+=("CPU iowait must stay below 50%")
  elif float_ge "$iowait_cpu" "$max_iowait"; then pressure_signals+=("iowait>=${max_iowait}%"); ((pressure_count += 1)); fi
  if ((pressure_count >= 2)); then
    failures+=("multiple CPU pressure signals: ${pressure_signals[*]}")
  fi
  ((available_mib >= min_available_mib)) || failures+=("available memory must stay above ${min_available_mib} MiB")

  if ((${#failures[@]} > 0)); then
    printf 'GEV_ACTIVATION_BLOCKED\n' >&2
    printf 'metrics: load=%s user=%s system=%s steal=%s idle=%s available_mib=%s\n' \
      "$load_one" "$user_cpu" "$system_cpu" "$steal_cpu" "$idle_cpu" "$available_mib" >&2
    printf 'reason: %s\n' "${failures[@]}" >&2
    return 75
  fi
  printf 'GEV_ACTIVATION_READY load=%s user=%s system=%s steal=%s idle=%s available_mib=%s\n' \
    "$load_one" "$user_cpu" "$system_cpu" "$steal_cpu" "$idle_cpu" "$available_mib"
}

container_health() {
  local container_id
  container_id="$(docker compose ps -q app)"
  [[ -n "$container_id" ]] || return 1
  docker inspect --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container_id"
}

wait_for_health() {
  local state health attempt
  for attempt in {1..24}; do
    read -r state health < <(container_health || printf 'missing missing\n')
    if [[ "$state" == running && "$health" == healthy ]]; then
      printf 'service app is running/healthy\n'
      return 0
    fi
    if [[ "$state" == exited || "$health" == unhealthy ]]; then
      printf 'service app failed with state %s/%s\n' "$state" "$health" >&2
      return 1
    fi
    sleep 5
  done
  printf 'service app did not become healthy within 120 seconds\n' >&2
  return 1
}

severe_post_start_load() {
  local sample user_cpu system_cpu iowait_cpu steal_cpu idle_cpu busy_cpu
  sample="$(sample_cpu || true)"
  [[ -n "$sample" ]] || return 0
  read -r user_cpu system_cpu iowait_cpu steal_cpu idle_cpu <<<"$sample"
  busy_cpu="$(awk -v user="$user_cpu" -v syscpu="$system_cpu" 'BEGIN {printf "%.2f", user + syscpu}')"
  float_ge "$steal_cpu" 60 || float_ge "$busy_cpu" 90 || float_ge "$iowait_cpu" 50 || \
    float_le "$idle_cpu" 10
}

post_start_guard() {
  local severe=0 iteration
  for iteration in 1 2 3; do
    if severe_post_start_load; then ((severe += 1)); else severe=0; fi
  done
  if ((severe == 3)); then
    printf 'GEV_POST_START_ROLLBACK reason=persistent-host-load\n' >&2
    docker compose stop -t 15 app
    return 76
  fi
  if ! check_global_service_health; then
    printf 'GEV_POST_START_ROLLBACK reason=global-service-healthcheck\n' >&2
    docker compose stop -t 15 app
    return 76
  fi
}

activate_service() {
  local mode="$1" state health
  read -r state health < <(container_health || printf 'missing missing\n')
  if [[ "$mode" == start && "$state" == running ]]; then
    printf 'service app is already running/%s; no activation performed\n' "$health"
    return 0
  fi
  preflight
  local -a up_args=(up -d --no-build --no-deps)
  [[ "$mode" == recreate ]] && up_args+=(--force-recreate)
  if ! docker compose "${up_args[@]}" app; then
    docker compose stop -t 15 app || true
    return 1
  fi
  if ! wait_for_health; then
    docker compose stop -t 15 app || true
    return 1
  fi
  post_start_guard
  printf 'GEV_ACTIVATION_PASS mode=%s service=app\n' "$mode"
}

build_service() {
  preflight
  DOCKER_BUILDKIT=0 nice -n 10 docker compose build app
  printf 'GEV_BUILD_PASS service=app\n'
}

cd "$project_root"
action="${1:-}"
case "$action" in
  check)
    (($# == 1)) || usage
    preflight
    ;;
  build|start|recreate)
    (($# == 2)) && [[ "$2" == app ]] || usage
    mkdir -p "$(dirname "$lock_path")"
    exec 9>"$lock_path"
    flock -n 9 || { printf 'GEV_ACTIVATION_BLOCKED\nreason: another guarded VPS activation is in progress\n' >&2; exit 75; }
    if [[ "$action" == build ]]; then build_service; else activate_service "$action"; fi
    ;;
  *) usage ;;
esac
