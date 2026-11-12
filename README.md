# CMAP

**Container Mapping and Analysis Platform** — карта Docker-контейнеров и связей по лейблу `connect_to`.

## Возможности

- **Контейнеры** — список по хостам, поиск, фильтр running/stopped; имя открывает узел на карте (`/map?node=…`)
- **Карта** — D3-граф, кластер по compose `project`, фильтры и карточка узла по запросу, Fit/zoom, маршрут между двумя узлами (два клика + линейка пути сверху), покрытие без `connect_to`, soft-refresh ~20с
- **Хосты** — `localhost` через docker.sock (RO); удалённые Docker API по желанию
- **Язык** — `ru` / `en` по `Accept-Language`; кнопка языка в шапке переключает (cookie `cmap_lang`, также `?lang=`)

## Быстрый старт

Нужны Docker и доступ к `/var/run/docker.sock`.

```bash
git clone <repo-url> cmap
cd cmap
mkdir -p instance
docker compose -f docker-compose.standalone.yml up -d --build
open http://127.0.0.1:5000
```

```bash
curl -s http://127.0.0.1:5000/healthz
```

Данные хостов — в `instance/hosts.db` (не в git).

Локально без Docker:

```bash
cd app
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
mkdir -p ../instance
FLASK_APP=main:app flask run -p 5000
```

## Структура

```
app/
  main.py          # Flask API + страницы
  i18n.py          # каталоги ru/en, детект языка
  config.py
  static/          # CSS, graph.js, i18n.js, logo
  templates/       # страницы + partials/topbar.html
docker-compose.yml              # за Traefik (хост из .env)
docker-compose.standalone.yml   # локально на :5000
```

Шапка общая: бренд · (на карте: Фильтры/Узел) · навигация · компактный переключатель языка.

## Лейбл `connect_to`

Формат: `service:port` (несколько через запятую).

Резолв: имя контейнера → `com.docker.compose.service` (+ project) → уникальный service → fuzzy. Иначе — external-узел.

```yaml
services:
  app:
    image: my-image
    labels:
      connect_to: "db:5432,redis:6379,traefik:443"
```

## Удалённые хосты

Предпочтительны TLS / SSH docker context. TCP `2375` без TLS — только в доверенной сети.

## Деплой за Traefik

См. [`INSTRUCTION.md`](INSTRUCTION.md). В `.env`: `CMAP_HOST`, `CMAP_CHECK_IP` (в git — плейсхолдеры).

## Лицензия

[MIT](LICENSE) (текст на русском).
