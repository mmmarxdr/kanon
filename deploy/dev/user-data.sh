#!/usr/bin/env bash
# EC2 user-data: bootstrap a fresh Ubuntu 24.04 (arm64) box to run the Kanon
# dev stack. Installs Docker + compose plugin, adds swap (build headroom on a
# 2 GB t4g.small), and prepares /opt/kanon. The repo checkout + `.env` + first
# `docker compose up` are done manually over SSH (see README.md) because the
# repo is private and secrets must not live in user-data.
set -euxo pipefail

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl git

# ── Docker (official repo) ─────────────────────────────────────────────────
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
usermod -aG docker ubuntu

# ── Swap (2 GB) — tsc + vite build can exceed 2 GB RAM on t4g.small ─────────
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# ── App directory ──────────────────────────────────────────────────────────
install -d -o ubuntu -g ubuntu /opt/kanon

echo "user-data complete. Next (over SSH, see deploy/dev/README.md):"
echo "  1. clone the repo into /opt/kanon"
echo "  2. cd /opt/kanon/deploy/dev && cp env.template .env && edit .env"
echo "  3. docker compose up -d --build"
