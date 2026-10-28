# CMAP — инструкция по запуску

Карта Docker-контейнеров и связей по лейблу `connect_to`. TLS через Traefik. Доступ только из офисных/локальных сетей (`internal-allowlist`).

| | |
|---|---|
| Веб | `https://cmap.main.tx0.ru` |
| Конфиг | `/data/config/cmap/` |
| БД хостов | `/data/config/cmap/instance/hosts.db` |
| Репозиторий | `https://gitlab.main.tx0.ru/lebedev/cmap` |

Связи на карте задаются лейблом контейнера: `connect_to=service:port` (несколько через запятую).

## Запуск

```bash
cd /data/config/cmap
docker compose up -d --build
docker compose ps
docker logs cmap --tail 50
```

Проверка:

```bash
curl -sk -o /dev/null -w "%{http_code}\n" \
  --resolve cmap.main.tx0.ru:443:192.168.100.200 \
  https://cmap.main.tx0.ru/
```

Ожидается `200` из сети allowlist. Снаружи — отказ Traefik.

## Деплой

CI (тег раннера `main`): sync в `/data/config/cmap`, затем `docker compose up -d --build`.  
`.env` и `instance/` sync не трогает.

## Хосты Docker

Локальный хост в UI: `localhost` (через `/var/run/docker.sock`, read-only).  
Удалённые Docker API по голому HTTP не рекомендуются — только при необходимости и в доверенной сети.
