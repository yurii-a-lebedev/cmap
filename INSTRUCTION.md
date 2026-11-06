# CMAP — деплой за Traefik

Обзор продукта и локальный запуск: [README.md](README.md).

## Переменные

Файл `.env` в каталоге приложения (не в git, CI его не затирает):

```bash
CMAP_HOST=cmap.example.com
CMAP_CHECK_IP=127.0.0.1
# совместимость со старым именем:
# DOMAIN=cmap.example.com
```

`CMAP_HOST` (или `DOMAIN`) подставляется в Traefik `Host()` в `docker-compose.yml`.

## Запуск

```bash
mkdir -p instance
docker compose up -d --build
docker compose ps
docker logs cmap --tail 50
```

Без Traefik: `docker compose -f docker-compose.standalone.yml up -d --build`.

```bash
curl -sk -o /dev/null -w "%{http_code}\n" \
  --resolve "${CMAP_HOST}:443:${CMAP_CHECK_IP}" \
  "https://${CMAP_HOST}/healthz"
```

## CI

Runner с тегом `main`: rsync → каталог приложения → `docker compose up -d --build`.  
Исключены из sync: `.env`, `instance/`, `.git/`.

## UI / i18n

- Язык: `Accept-Language` → cookie `cmap_lang` → `?lang=ru|en`
- Общая шапка: `app/templates/partials/topbar.html`
- Строки: `app/i18n.py` (+ клиент через `window.CMAP_I18N`)

## Безопасность

- allowlist / VPN на входе
- docker.sock **read-only**
- не публиковать `instance/hosts.db` и `.env`
