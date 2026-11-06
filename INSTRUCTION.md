# CMAP — инструкция по запуску (tx0)

Карта Docker-контейнеров и связей по лейблу `connect_to`. TLS через Traefik. Доступ только из офисных/локальных сетей (`internal-allowlist`).

Общее описание и standalone-запуск: [README.md](README.md).

| | |
|---|---|
| Веб | `https://cmap.main.tx0.ru` |
| Конфиг | `/data/config/cmap/` |
| БД хостов | `/data/config/cmap/instance/hosts.db` (не в git) |
| Репозиторий | `https://gitlab.main.tx0.ru/lebedev/cmap` |

Связи на карте: лейбл `connect_to=service:port` (несколько через запятую).

## UI

- **Контейнеры** — список, поиск, фильтр running/stopped; клик по имени → `/map?node=…`
- **Карта** — кластер по compose `project`, Fit/zoom/Refresh, блок «без connect_to», poll ~20с; шторка узла по кнопке «Узел» / dblclick
- **Хосты** — `localhost` через docker.sock, удаление localhost запрещено

Связи резолвятся по имени контейнера, compose service (+ project) и fuzzy-имени.

## Запуск (продакшен за Traefik)

```bash
cd /data/config/cmap
docker compose up -d --build
docker compose ps
docker logs cmap --tail 50
```

Без Traefik (локально): `docker compose -f docker-compose.standalone.yml up -d --build`.

Проверка (из сети allowlist):

```bash
curl -sk -o /dev/null -w "%{http_code}\n" \
  --resolve cmap.main.tx0.ru:443:192.168.100.200 \
  https://cmap.main.tx0.ru/healthz
```

## Деплой

CI (тег раннера `main`): sync → `/data/config/cmap`, затем `docker compose up -d --build`.  
`.env` и `instance/` sync не трогает. Права каталога: `gitlab-runner`.

## Безопасность

- Traefik middleware `internal-allowlist@file`
- docker.sock смонтирован **read-only**
- Снаружи LAN без VPN ответа не будет (это ожидаемо)
