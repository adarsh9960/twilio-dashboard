#!/bin/bash
ssh -o BatchMode=yes instatool <<'EOF'
# Install Node.js 20 via nodesource
curl -fsSL https://deb.nodesource.com/setup_20.x -o /tmp/nodesource_setup.sh
chmod +x /tmp/nodesource_setup.sh
/tmp/nodesource_setup.sh
EOF
