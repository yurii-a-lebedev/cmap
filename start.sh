#!/bin/sh
set -e
cd "$(dirname "$0")"
docker compose up -d --build
sleep 3
docker logs cmap --tail 50
