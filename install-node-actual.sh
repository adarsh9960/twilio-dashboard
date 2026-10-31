#!/bin/bash
# Actual Computer Node.js setup (Ubuntu) — used for servers without curl-from-heroku
# Requires: sudo (passwordless for ubuntu)
set -euo pipefail

# Install Node.js 20 LTS via NodeSource (verified on Ubuntu 24.04)
echo "=== Installing Node.js 20 LTS via NodeSource ==="

# Use sudo -n for passwordless sudo (Ubuntu 24.04, ubuntu user)
SUDO="sudo -n"

# Download and run the NodeSource setup script (it uses apt, so needs sudo)
$SUDO curl -fsSL https://deb.nodesource.com/setup_20.x -o /tmp/nodesource_setup.sh
$SUDO chmod +x /tmp/nodesource_setup.sh
$SUDO bash /tmp/nodesource_setup.sh 2>&1 | tail -20

echo ""
echo "=== Installing nodejs via apt ==="
$SUDO apt-get install -y nodejs 2>&1 | tail -10

echo ""
echo "=== Verification ==="
node --version
npm --version

echo ""
echo "=== Done. Node.js $(node --version) installed. ==="
