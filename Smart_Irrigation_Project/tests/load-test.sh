#!/usr/bin/env bash

# Simple HTTP load test for the mock status endpoint.
# Usage (from project root, on macOS/Linux/WSL):
#   bash tests/load-test.sh

URL="${1:-http://localhost:4000/mock-api/status}"
ITERATIONS=300
SLEEP=0.2

echo "Running load test against ${URL} for ${ITERATIONS} requests..."

start_ns=$(date +%s%N 2>/dev/null || echo 0)

min_ms=999999
max_ms=0
total_ms=0

for i in $(seq 1 ${ITERATIONS}); do
  t0=$(date +%s%N 2>/dev/null || echo 0)
  curl -s "${URL}" >/dev/null
  t1=$(date +%s%N 2>/dev/null || echo 0)

  if [ "$t0" != "0" ] && [ "$t1" != "0" ]; then
    dt_ns=$((t1 - t0))
    dt_ms=$((dt_ns / 1000000))
    [ $dt_ms -lt $min_ms ] && min_ms=$dt_ms
    [ $dt_ms -gt $max_ms ] && max_ms=$dt_ms
    total_ms=$((total_ms + dt_ms))
  fi

  sleep ${SLEEP}
done

end_ns=$(date +%s%N 2>/dev/null || echo 0)

if [ "$start_ns" != "0" ] && [ "$end_ns" != "0" ]; then
  elapsed_ms=$(((end_ns - start_ns) / 1000000))
  echo "Total elapsed: ${elapsed_ms} ms"
fi

avg_ms=$((total_ms / ITERATIONS))

echo "Requests: ${ITERATIONS}"
echo "Min response: ${min_ms} ms"
echo "Max response: ${max_ms} ms"
echo "Avg response: ${avg_ms} ms"


