# CMAP

Container Mapping and Analysis Platform — карта Docker-контейнеров и связей по лейблу `connect_to`.

| | |
|---|---|
| Веб | `https://cmap.main.tx0.ru` |
| Инструкция | [INSTRUCTION.md](INSTRUCTION.md) |
| Репозиторий | `https://gitlab.main.tx0.ru/lebedev/cmap` |

## Возможности

- **Контейнеры** — список по хостам, поиск, фильтр running/stopped; имя ведёт на `/map?node=…`
- **Карта** — D3-граф, кластер по compose `project`, фильтры, Fit/zoom, покрытие без `connect_to`, auto-refresh ~20с
- **Хосты** — `localhost` через docker.sock; удаление localhost запрещено

## Лейбл `connect_to`

Формат: `service:port` (несколько через запятую).

Резолв цели (по порядку): точное имя контейнера → `com.docker.compose.service` в том же project → уникальный service → fuzzy по имени.

```yaml
services:
  app:
    image: my-image
    labels:
      connect_to: "db:5432,redis:6379"
```

```bash
docker run -d --name my-app --label connect_to=db:5432 my-image
```

## Удалённые Docker-хосты

Для LAN предпочтительнее TLS или доступ через SSH/docker context. Открытый TCP `2375` без TLS — риск; используйте только в доверенной сети и за firewall.

## Запуск

См. [INSTRUCTION.md](INSTRUCTION.md). Healthcheck: `GET /healthz`.
