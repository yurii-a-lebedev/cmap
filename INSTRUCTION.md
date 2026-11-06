# CMAP — деплой за Traefik

Карта Docker-контейнеров и связей по лейблу `connect_to`.  
Общее описание и локальный запуск: [README.md](README.md).

## Переменные окружения

В каталоге приложения создайте `.env` (не коммитится):

```bash
CMAP_HOST=cmap.example.com
CMAP_CHECK_IP=127.0.0.1
```

`CMAP_HOST` подставляется в Traefik `Host()` правила в `docker-compose.yml`.  
`CMAP_CHECK_IP` — адрес для CI healthcheck через `--resolve`.

## Запуск

```bash
mkdir -p instance
docker compose up -d --build
docker compose ps
docker logs cmap --tail 50
```

Без Traefik: `docker compose -f docker-compose.standalone.yml up -d --build`.

Проверка:

```bash
curl -sk -o /dev/null -w "%{http_code}\n" \
  --resolve "${CMAP_HOST}:443:${CMAP_CHECK_IP}" \
  "https://${CMAP_HOST}/healthz"
```

## CI

Runner с тегом `main`: rsync → каталог приложения, затем `docker compose up -d --build`.  
`.env` и `instance/` sync не трогает.

## Безопасность

- Ограничьте доступ middleware allowlist / VPN
- docker.sock монтируется **read-only**
- Не публикуйте `instance/hosts.db` и `.env`
