#!/usr/bin/env bash
# Shared helpers for the run scripts. Not meant to be executed directly.

# Repo root, no matter which directory the script was invoked from.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Must match container_name in docker/compose.yml.
CONTAINER_NAME=media-player

die() {
  printf '\n  Error: %s\n\n' "$1" >&2
  exit 1
}

# Yes/no prompt, defaulting to no. Returns 0 for yes.
# ASSUME_YES=1 answers yes; the absence of a terminal answers no.
confirm() {
  local prompt="$1" answer
  if [ "${ASSUME_YES:-0}" -eq 1 ]; then return 0; fi
  if [ ! -t 0 ]; then return 1; fi
  printf '%s [y/N] ' "$prompt"
  read -r answer || return 1
  case "$answer" in [yY] | [yY][eE][sS]) return 0 ;; *) return 1 ;; esac
}

require_node() {
  command -v node >/dev/null 2>&1 ||
    die "Node.js is not installed. Get it from https://nodejs.org (version 18 or newer)."

  local major
  major="$(node -p 'process.versions.node.split(".")[0]')"
  [ "$major" -ge 18 ] ||
    die "Node 18 or newer is required, but $(node -v) is installed."
}

# Reads .env into the environment. Values already set in the shell win, so
# `PORT=9000 ./scripts/run` works as an override.
load_env() {
  if [ -f "$ROOT_DIR/.env" ]; then
    # Sourcing .env assigns unconditionally and would overwrite anything already
    # set in this shell, so remember those values and put them back afterwards.
    # Without this, `PORT=8080 ./1_run` silently uses the port from .env instead.
    local pre_media="${MEDIA_DIR:-}" pre_port="${PORT:-}"
    local pre_web="${WEB_DEV_PORT:-}" pre_mode="${RUN_MODE:-}"
    local pre_oskey="${OPENSUBTITLES_API_KEY:-}" pre_sdkey="${SUBDL_API_KEY:-}"
    local pre_langs="${SUBTITLE_LANGUAGES:-}" pre_provs="${SUBTITLE_PROVIDERS:-}"
    local pre_subscene="${SUBSCENE_URL:-}"

    set -a
    # shellcheck disable=SC1091  # path is computed at runtime
    . "$ROOT_DIR/.env"
    set +a

    # Explicit ifs, not `[ -n x ] && y`: under set -e a false test at statement
    # level aborts the script.
    if [ -n "$pre_media" ]; then MEDIA_DIR="$pre_media"; fi
    if [ -n "$pre_port" ]; then PORT="$pre_port"; fi
    if [ -n "$pre_web" ]; then WEB_DEV_PORT="$pre_web"; fi
    if [ -n "$pre_mode" ]; then RUN_MODE="$pre_mode"; fi
    if [ -n "$pre_oskey" ]; then OPENSUBTITLES_API_KEY="$pre_oskey"; fi
    if [ -n "$pre_sdkey" ]; then SUBDL_API_KEY="$pre_sdkey"; fi
    if [ -n "$pre_langs" ]; then SUBTITLE_LANGUAGES="$pre_langs"; fi
    if [ -n "$pre_provs" ]; then SUBTITLE_PROVIDERS="$pre_provs"; fi
    if [ -n "$pre_subscene" ]; then SUBSCENE_URL="$pre_subscene"; fi
  fi

  export PORT="${PORT:-5000}"

  [ -n "${MEDIA_DIR:-}" ] || die "MEDIA_DIR is not set.
  Create your config file and point it at the folder holding your videos:

      cp .env.example .env

  then edit .env and set MEDIA_DIR."

  [ -d "$MEDIA_DIR" ] || die "MEDIA_DIR points at a folder that does not exist:
      $MEDIA_DIR

  Edit .env and set MEDIA_DIR to a real folder."

  export MEDIA_DIR
}

# Is something already listening on this port? Tested by attempting the very
# bind the server will attempt, so there are no false positives from parsing
# `ss` output - and no dependency beyond the Node we already require.
# Exit codes from the probe: 0 free, 2 in use, 1 anything else (a permission
# error, say), which we treat as free and let the server report itself.
port_in_use() {
  local rc=0
  node -e '
    const s = require("net").createServer();
    s.once("error", (e) => process.exit(e.code === "EADDRINUSE" ? 2 : 1));
    s.once("listening", () => s.close(() => process.exit(0)));
    s.listen(Number(process.argv[1]), "0.0.0.0");
  ' "$1" 2>/dev/null || rc=$?
  [ "$rc" -eq 2 ]
}

# First free port above $1, so the error message can name one that will work.
next_free_port() {
  local port="$1" limit=$(( $1 + 10 ))
  while [ "$port" -lt "$limit" ]; do
    port=$((port + 1))
    if ! port_in_use "$port"; then
      printf '%s' "$port"
      return 0
    fi
  done
  printf '%s' "$(( $1 + 1 ))"
}

# Name whoever is holding the port. Docker first: a published port is held by
# docker-proxy running as root, so `ss` shows no owner for it unless we are root.
port_holder() {
  local port="$1" pid name

  if command -v docker >/dev/null 2>&1; then
    name="$(docker ps --filter "publish=$port" --format '{{.Names}}' 2>/dev/null | head -1 || true)"
    if [ -n "$name" ]; then
      printf 'docker\t%s' "$name"
      return 0
    fi
  fi

  if command -v lsof >/dev/null 2>&1; then
    pid="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | head -1 || true)"
  elif command -v ss >/dev/null 2>&1; then
    pid="$(ss -ltnp 2>/dev/null | grep -m1 "[:.]${port}[[:space:]]" |
      grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2 || true)"
  fi

  if [ -n "${pid:-}" ]; then
    # `ps -o comm=` reports the thread name, which Node sets to "MainThread".
    # The first token of the command line is what a person would recognise.
    name="$(ps -p "$pid" -o args= 2>/dev/null | awk '{print $1}' || true)"
    if [ -n "$name" ]; then name="$(basename "$name")"; fi
    printf 'process\t%s\t%s' "${name:-unknown}" "$pid"
    return 0
  fi

  printf 'unknown\t\t'
}

# Fail with an explanation instead of letting Node throw a raw EADDRINUSE.
require_free_port() {
  local port="$1" kind who pid free
  if ! port_in_use "$port"; then return 0; fi

  IFS=$'\t' read -r kind who pid <<< "$(port_holder "$port")"
  free="$(next_free_port "$port")"

  if [ "$kind" = "docker" ] && [ "$who" = "$CONTAINER_NAME" ]; then
    die "media-player is already running in Docker on port $port.

  Stop it, then start it with Node:

      ./x_stop
      ./1_run --node

  Or leave it running and use a different port:

      ./1_run --node --port $free"
  fi

  case "$kind" in
    docker) who="the Docker container \"$who\"" ;;
    process) who="\"$who\" (pid $pid)" ;;
    *) who="another program" ;;
  esac

  die "Port $port is already in use by $who.

  Stop it, or run the media player on a different port:

      ./1_run --node --port $free

  To make that the default, set PORT=$free in .env"
}

ensure_deps() {
  if [ ! -d "$ROOT_DIR/node_modules" ]; then
    printf '  Installing dependencies (first run only, this takes a minute)...\n\n'
    (cd "$ROOT_DIR" && npm install) || die "npm install failed."
    printf '\n'
  fi
}

# True when the frontend has never been built, or when a source file changed
# since the last build.
needs_build() {
  [ -f "$ROOT_DIR/web/dist/index.html" ] || return 0
  [ -n "$(find "$ROOT_DIR/web/src" "$ROOT_DIR/web/index.html" "$ROOT_DIR/web/vite.config.ts" \
    -newer "$ROOT_DIR/web/dist/index.html" -print -quit 2>/dev/null)" ]
}

build_web() {
  printf '  Building the frontend...\n\n'
  (cd "$ROOT_DIR" && npm run build --workspace web) || die "Frontend build failed."
  printf '\n'
}

# Best-effort LAN address. Only needed for the Docker path: a container sees
# its own private IP, not the address your TV needs to dial.
detect_lan_ip() {
  if command -v ip >/dev/null 2>&1; then
    ip -4 route get 1.1.1.1 2>/dev/null |
      awk '{for (i = 1; i <= NF; i++) if ($i == "src") { print $(i + 1); exit }}'
  elif command -v ipconfig >/dev/null 2>&1; then
    # macOS: Wi-Fi is usually en0, wired en1.
    ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null
  fi
}
