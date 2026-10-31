#!/bin/bash
ssh -o BatchMode=yes instatool <<'EOF'
echo "=== OS ==="
cat /etc/os-release 2>/dev/null | head -5
echo "--- apt ---"
command -v apt-get >/dev/null && apt-get --version 2>/dev/null | head -1
echo "--- curl/wget ---"
command -v curl >/dev/null && echo "curl: yes" || echo "curl: no"
command -v wget >/dev/null && echo "wget: yes" || echo "wget: no"
echo "--- network test ---"
curl -sI https://registry.npmjs.org/ 2>&1 | head -3
echo "--- node latest (nodesource) ---"
curl -s https://deb.nodesource.com/setup_20.x 2>&1 | head -3
echo "(network check done)"
EOF
