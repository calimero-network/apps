#!/bin/sh
# Stop what up.sh started, and nothing else: each pid recorded under
# .state/run/pids/, and only while that pid is still running the program up.sh
# started under it (a pid the OS has since handed to something else is left
# alone). Keeps .state/run for the logs; up.sh clears it on the next start.
HERE=$(cd "$(dirname "$0")" && pwd)
PIDS="${HERE}/.state/run/pids"
[ -d "${PIDS}" ] || { echo "conformance rig: nothing recorded"; exit 0; }
for f in "${PIDS}"/*.pid; do
    [ -f "$f" ] || continue
    pid=$(cat "$f")
    cmd=$(ps -p "${pid}" -o command= 2>/dev/null || true)
    case "${cmd}" in
        *merod*conf-owner*|*merod*conf-relay*|*mero-auth*conformance*|*mero-auth*/.state/run/*|*traefik*/.state/run/*|*mock-cloud.py*)
            kill "${pid}" 2>/dev/null && echo "stopped $(basename "$f" .pid) (${pid})"
            ;;
        "") ;;
        *) echo "left ${pid} alone: it is no longer what this rig started (${cmd})" ;;
    esac
    rm -f "$f"
done
# merod takes a moment to release its RocksDB lock and ports.
sleep 2
echo "conformance rig stopped"
