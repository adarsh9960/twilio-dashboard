#!/bin/bash
# Actual Computer Node.js setup via official binary tarball
set -euo pipefail

echo "=== Installing Node.js 20 x64 via official binary tarball ==="
echo "User: $(whoami)"
echo "Sudo test:"; sudo -n true && echo "  passwordless sudo: OK" || echo "  passwordless sudo: NONE"

INSTALL_DIR="/opt/nodejs"
mkdir -p "$INSTALL_DIR"

echo "Downloading Node.js 20 x64..."
curl -fsSL https://nodejs.org/dist/v20.19.4/node-v20.19.4-linux-x64.tar.xz -o /tmp/node.tar.xz

echo "Extracting to $INSTALL_DIR..."
sudo chown ubuntu:ubuntu "$INSTALL_DIR" 2>/dev/null || true
sudo rm -rf "$INSTALL_DIR"
sudo mkdir -p "$INSTALL_DIR"
sudo tar -xJf /tmp/node.tar.xz -C "$INSTALL_DIR" --strip-components=1

echo "Linking /usr/local/bin/node and npm..."
sudo ln -sf "$INSTALL_DIR/bin/node" /usr/local/bin/node
sudo ln -sf "$INSTALL_DIR/bin/npm" /usr/local/bin/npm
sudo ln -sf "$INSTALL_DIR/bin/npx" /usr/local/bin/npx

echo ""
echo "=== Verification ==="
node --version
npm --version
npm config get prefix

echo ""
echo "=== Done ==="
