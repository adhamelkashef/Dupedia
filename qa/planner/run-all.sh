#!/bin/sh
# Site Planner safety net. From the repository root: sh qa/planner/run-all.sh
cd "$(dirname "$0")/../.." || exit 1
s=0
for t in golden edit2d scene3d terrain structures elements checks3d commercial present3d library3d unit commission rules; do
  r=$(node "qa/planner/$t.test.js" 2>&1); c=$?
  echo "$t: $(echo "$r" | tail -1)"
  [ $c -eq 0 ] || { echo "$r" | grep -A12 '^FAIL'; s=1; }
done
[ $s -eq 0 ] && echo "ALL PASSED" || echo "SOMETHING FAILED"
exit $s
