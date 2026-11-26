#!/usr/bin/env bash
# Isolated FORMA instance for verification: start | doctor | stop | creds.
# Usage (from anywhere): bash .claude/skills/verify-forma/scripts/forma.sh start [--fake-tripo] [port]
# --fake-tripo also starts tools/fake-tripo.mjs (on port+1000) and points the server at it, so previews work for free.
# State lives in .verify/run-<port>/ (deleted by stop); evidence goes in .verify/evidence/ (never deleted).
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
SKILL="$REPO/.claude/skills/verify-forma"
CMD="${1:-doctor}"
shift || true
FAKE=0
if [ "${1:-}" = "--fake-tripo" ]; then FAKE=1; shift; fi
PORT="${1:-${FORMA_VERIFY_PORT:-4180}}"
RUN="$REPO/.verify/run-$PORT"
BASE="http://127.0.0.1:$PORT"
CODE="F-0000C0DE"

if [ "$PORT" = "4173" ]; then
  echo "Refusing port 4173: that is the user's own dev server (npm start). Pick another port." >&2
  exit 2
fi

alive() { [ -f "$RUN/pid" ] && kill -0 "$(cat "$RUN/pid")" 2>/dev/null; }
FAKE_PORT=$((PORT + 1000))

case "$CMD" in
  start)
    if alive; then echo "Already running on $BASE (pid $(cat "$RUN/pid")). Run doctor or stop first."; exit 0; fi
    if curl -s -o /dev/null --max-time 2 "$BASE/"; then
      echo "Port $PORT is answering but is not ours. Choose another port." >&2; exit 1
    fi
    rm -rf "$RUN"
    mkdir -p "$RUN/pedidos" "$REPO/.verify/evidence"
    # Seed data: one order the user-facing journeys can find (tracking, admin panel).
    tr -d '\r\n' < "$SKILL/fixtures/order.json" > "$RUN/pedidos/pedidos.jsonl"
    echo >> "$RUN/pedidos/pedidos.jsonl"
    cp "$REPO/assets/models/sample-figure.glb" "$RUN/pedidos/$CODE.glb"
    # fotos-prueba/ is gitignored: the photo is optional seed data.
    [ -f "$REPO/fotos-prueba/corgi-800.jpg" ] && cp "$REPO/fotos-prueba/corgi-800.jpg" "$RUN/pedidos/$CODE-foto-1.jpg"
    ADMIN_PASS="verify-$(node -e "console.log(require('crypto').randomBytes(9).toString('hex'))")"
    printf 'user=verify-admin\npassword=%s\n' "$ADMIN_PASS" > "$RUN/admin.txt"
    git -C "$REPO" rev-parse --short HEAD > "$RUN/rev" 2>/dev/null || echo unknown > "$RUN/rev"
    # Default: no Tripo key at all. With --fake-tripo: the free simulator and a fake key ("simulada").
    TRIPO_KEY=" "; TRIPO_BASE=" "
    if [ "$FAKE" = 1 ]; then
      if curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$FAKE_PORT/"; then
        echo "Port $FAKE_PORT (fake Tripo) is already answering. Choose another port." >&2; exit 1
      fi
      ( cd "$REPO"; DEMORA_MS="${DEMORA_MS:-6000}" nohup node tools/fake-tripo.mjs "$FAKE_PORT" > "$RUN/fake-tripo.log" 2>&1 & echo $! > "$RUN/fake.pid" )
      for _ in $(seq 1 20); do grep -q "Tripo simulado en" "$RUN/fake-tripo.log" 2>/dev/null && break; sleep 0.25; done
      TRIPO_KEY="simulada"; TRIPO_BASE="http://127.0.0.1:$FAKE_PORT/v3"
      echo fake > "$RUN/mode"
    fi
    # A single space keeps .env from filling these in (lib/config.mjs skips set vars) and trims to empty:
    # no Tripo key = no paid previews; no SMTP password = no real emails.
    (
      cd "$REPO"
      PORT="$PORT" HOST=127.0.0.1 ORDERS_DIR="$RUN/pedidos" \
      TRIPO_API_KEY="$TRIPO_KEY" TRIPO_API_BASE="$TRIPO_BASE" SMTP_PASS=" " TRUST_PROXY=" " COOKIE_SECURE=" " \
      ADMIN_USER=verify-admin ADMIN_PASSWORD="$ADMIN_PASS" \
      nohup node server.mjs > "$RUN/server.log" 2>&1 &
      echo $! > "$RUN/pid"
    )
    for _ in $(seq 1 40); do
      if grep -q "FORMA disponible en" "$RUN/server.log" 2>/dev/null && curl -sf --max-time 2 "$BASE/api/health" > /dev/null; then
        echo "Ready: $BASE (pid $(cat "$RUN/pid")). Log: $RUN/server.log"
        exit 0
      fi
      alive || { echo "Server exited during startup:" >&2; cat "$RUN/server.log" >&2; exit 1; }
      sleep 0.5
    done
    echo "Timed out waiting for $BASE. Log:" >&2; cat "$RUN/server.log" >&2; exit 1
    ;;

  doctor)
    ok=1
    check() { if eval "$2"; then echo "ok   $1"; else echo "FAIL $1"; ok=0; fi; }
    check "pid file and process alive" alive
    check "server log says ready" "grep -q 'FORMA disponible en http://127.0.0.1:$PORT' '$RUN/server.log' 2>/dev/null"
    health="$(curl -s --max-time 3 "$BASE/api/health" || true)"
    if [ -f "$RUN/mode" ]; then
      check "fake Tripo alive on port $FAKE_PORT" "[ -f '$RUN/fake.pid' ] && kill -0 \$(cat '$RUN/fake.pid') 2>/dev/null"
      check "/api/health answers ready:true (key 'simulada' → fake Tripo, never the real one)" "[ '$health' = '{\"ready\":true}' ]"
    else
      check "/api/health answers ready:false (our keyless instance, not a paid one)" "[ '$health' = '{\"ready\":false}' ]"
    fi
    check "home page serves FORMA" "curl -s --max-time 3 '$BASE/' | grep -q 'FORMA'"
    check "running build matches git HEAD ($(cat "$RUN/rev" 2>/dev/null))" "[ \"\$(git -C '$REPO' rev-parse --short HEAD)\" = \"\$(cat '$RUN/rev' 2>/dev/null)\" ]"
    pw="$(sed -n 's/^password=//p' "$RUN/admin.txt" 2>/dev/null || true)"
    login="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 -H 'content-type: application/json' \
      -d "{\"user\":\"verify-admin\",\"password\":\"$pw\"}" "$BASE/api/admin/login" || true)"
    check "admin test login returns 200" "[ '$login' = '200' ]"
    check "seed order present" "grep -q '$CODE' '$RUN/pedidos/pedidos.jsonl' 2>/dev/null"
    [ $ok = 1 ] && echo "Instance at $BASE is worth driving." || { echo "Instance is NOT healthy; stop and start again."; exit 1; }
    ;;

  creds)
    cat "$RUN/admin.txt"
    ;;

  stop)
    if alive; then
      pid="$(cat "$RUN/pid")"
      kill "$pid" 2>/dev/null || true
      for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.25; done
      echo "Stopped pid $pid."
    else
      echo "No live instance recorded for port $PORT."
    fi
    if [ -f "$RUN/fake.pid" ] && kill -0 "$(cat "$RUN/fake.pid")" 2>/dev/null; then
      kill "$(cat "$RUN/fake.pid")" 2>/dev/null || true
      echo "Stopped fake Tripo (pid $(cat "$RUN/fake.pid"))."
    fi
    # The server keeps preview photos in the OS temp dir keyed by port (lib/config.mjs PHOTO_TMP).
    tmp="$(node -e "console.log(require('os').tmpdir())")/forma-photos-$PORT"
    rm -rf "$RUN" "$tmp"
    echo "Removed $RUN. Evidence kept in $REPO/.verify/evidence/"
    ;;

  *)
    echo "Usage: forma.sh start [--fake-tripo] [port] | doctor|creds|stop [port]" >&2; exit 2
    ;;
esac
