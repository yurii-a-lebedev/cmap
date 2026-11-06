"""Лёгкий i18n: Accept-Language / cookie / ?lang= → ru|en."""

from __future__ import annotations

from flask import request

SUPPORTED = ("en", "ru")
DEFAULT = "en"
COOKIE = "cmap_lang"

MESSAGES = {
    "en": {
        "nav.containers": "Containers",
        "nav.map": "Map",
        "nav.hosts": "Hosts",
        "title.containers": "CMAP — containers",
        "title.map": "CMAP — map",
        "title.hosts": "CMAP — hosts",
        "containers.heading": "Containers",
        "containers.sub": "Docker host status and container list",
        "containers.refresh": "Refresh",
        "containers.total": "Total",
        "containers.host_ok": "host OK",
        "containers.no_running": "no running",
        "containers.host_down": "host down",
        "containers.empty": "empty",
        "containers.search_ph": "Search by name or image…",
        "containers.state_all": "All states",
        "containers.state_running": "Running only",
        "containers.state_stopped": "Stopped only",
        "containers.expand": "Expand / collapse",
        "containers.error": "error",
        "containers.col.name": "Name",
        "containers.col.state": "State",
        "containers.col.ports": "Ports",
        "containers.col.status": "Status",
        "containers.col.image": "Image",
        "containers.col.project": "Project",
        "legend.red": "Host unreachable",
        "legend.blue": "No containers on host",
        "legend.yellow": "No running containers on host",
        "legend.green": "Host up with running containers",
        "map.filters": "Filters",
        "map.node": "Node",
        "map.close_panel": "Close panel",
        "map.close": "Close",
        "map.search": "Search",
        "map.search_ph": "Container name… ↵",
        "map.search_hint": "Enter — select · Esc — reset · / — focus search",
        "map.running": "Running",
        "map.stopped": "Stopped",
        "map.external": "External",
        "map.linked_only": "Linked only",
        "map.cluster": "Cluster by project",
        "map.prefix_ph": "Prefix / project…",
        "map.projects": "Projects",
        "map.view": "View",
        "map.fit": "Fit",
        "map.zoom_in": "Zoom in",
        "map.zoom_out": "Zoom out",
        "map.reset": "Reset",
        "map.refresh": "Refresh",
        "map.coverage": "Without connect_to",
        "map.legend": "Legend",
        "map.port_legend": "Link ports",
        "map.tools": "Map controls",
        "map.drawer_empty": "Select a node on the map (click), then open this panel. Double-click a node to open it right away. Esc — close.",
        "map.clear_selection": "Clear selection",
        "map.node_card": "Node card",
        "map.node_named": "Node: {name}",
        "map.updated": "updated {time}",
        "map.coverage_summary": "{with_label}/{total} labeled · missing: {missing}",
        "map.stats": "On map: {nodes} nodes · {links} links",
        "map.all_projects": "all",
        "map.field.name": "Name",
        "map.field.state": "State",
        "map.field.status": "Status",
        "map.field.host": "Host",
        "map.field.image": "Image",
        "map.field.project": "Project",
        "map.field.ports": "Ports",
        "hosts.heading": "Docker hosts",
        "hosts.sub": "localhost uses docker.sock. Remote hosts use the Docker API (port).",
        "hosts.add_heading": "Add host",
        "hosts.host": "Host",
        "hosts.host_ph": "e.g. 192.168.1.10",
        "hosts.port": "API port",
        "hosts.add": "Add host",
        "hosts.visible_name": "Display name",
        "hosts.save_name": "Save name",
        "hosts.delete": "Delete",
        "hosts.protected": "protected",
        "hosts.need_host": "Enter a host",
        "hosts.add_failed": "Could not add host",
        "hosts.save_failed": "Could not save name",
        "hosts.delete_failed": "Could not delete",
        "api.bad_port": "Invalid port",
        "api.host_required": "Host is required",
        "api.port_range": "Port must be 1–65535",
        "api.host_exists": "Host already exists",
        "api.host_added": "Host added",
        "api.host_not_found": "Host not found",
        "api.localhost_protected": "localhost cannot be deleted",
        "api.host_deleted": "Host deleted",
        "api.name_updated": "Name updated",
        "err.host_connect": "Could not connect to host: {detail}",
        "err.host_http": "Error: {status}, {reason}",
        "lang.label": "Language",
    },
    "ru": {
        "nav.containers": "Контейнеры",
        "nav.map": "Карта",
        "nav.hosts": "Хосты",
        "title.containers": "CMAP — контейнеры",
        "title.map": "CMAP — карта",
        "title.hosts": "CMAP — хосты",
        "containers.heading": "Контейнеры",
        "containers.sub": "Статус Docker-хостов и список контейнеров",
        "containers.refresh": "Обновить",
        "containers.total": "Всего",
        "containers.host_ok": "хост OK",
        "containers.no_running": "без running",
        "containers.host_down": "хост down",
        "containers.empty": "пусто",
        "containers.search_ph": "Поиск по имени или образу…",
        "containers.state_all": "Все состояния",
        "containers.state_running": "Только running",
        "containers.state_stopped": "Только stopped",
        "containers.expand": "Развернуть / свернуть",
        "containers.error": "ошибка",
        "containers.col.name": "Имя",
        "containers.col.state": "Состояние",
        "containers.col.ports": "Порты",
        "containers.col.status": "Статус",
        "containers.col.image": "Образ",
        "containers.col.project": "Проект",
        "legend.red": "Хост не доступен",
        "legend.blue": "На хосте нет контейнеров",
        "legend.yellow": "На хосте нет запущенных контейнеров",
        "legend.green": "Хост доступен и на нем есть запущенные контейнеры",
        "map.filters": "Фильтры",
        "map.node": "Узел",
        "map.close_panel": "Закрыть панель",
        "map.close": "Закрыть",
        "map.search": "Поиск",
        "map.search_ph": "Имя контейнера… ↵",
        "map.search_hint": "Enter — выбрать · Esc — сброс · / — фокус в поиск",
        "map.running": "Запущенные",
        "map.stopped": "Остановленные",
        "map.external": "Внешние",
        "map.linked_only": "Только со связями",
        "map.cluster": "Кластер по проекту",
        "map.prefix_ph": "Префикс / проект…",
        "map.projects": "Проекты",
        "map.view": "Вид",
        "map.fit": "Вписать",
        "map.zoom_in": "Приблизить",
        "map.zoom_out": "Отдалить",
        "map.reset": "Сброс",
        "map.refresh": "Обновить",
        "map.coverage": "Без connect_to",
        "map.legend": "Легенда",
        "map.port_legend": "Порты связей",
        "map.tools": "Управление картой",
        "map.drawer_empty": "Выберите узел на карте (клик), затем откройте эту панель. Двойной клик по узлу — сразу открыть. Esc — закрыть.",
        "map.clear_selection": "Сбросить выделение",
        "map.node_card": "Карточка узла",
        "map.node_named": "Узел: {name}",
        "map.updated": "обновлено {time}",
        "map.coverage_summary": "{with_label}/{total} с лейблом · без: {missing}",
        "map.stats": "На карте: {nodes} узлов · {links} связей",
        "map.all_projects": "все",
        "map.field.name": "Имя",
        "map.field.state": "Состояние",
        "map.field.status": "Статус",
        "map.field.host": "Хост",
        "map.field.image": "Образ",
        "map.field.project": "Проект",
        "map.field.ports": "Порты",
        "hosts.heading": "Хосты Docker",
        "hosts.sub": "localhost ходит через docker.sock. Удалённые — по Docker API (порт).",
        "hosts.add_heading": "Добавить хост",
        "hosts.host": "Хост",
        "hosts.host_ph": "например 192.168.1.10",
        "hosts.port": "Порт API",
        "hosts.add": "Добавить хост",
        "hosts.visible_name": "Отображаемое имя",
        "hosts.save_name": "Сохранить имя",
        "hosts.delete": "Удалить",
        "hosts.protected": "защищён",
        "hosts.need_host": "Укажите хост",
        "hosts.add_failed": "Не удалось добавить хост",
        "hosts.save_failed": "Не удалось сохранить имя",
        "hosts.delete_failed": "Не удалось удалить",
        "api.bad_port": "Некорректный порт",
        "api.host_required": "Хост обязателен",
        "api.port_range": "Порт должен быть 1–65535",
        "api.host_exists": "Такой хост уже есть",
        "api.host_added": "Хост добавлен",
        "api.host_not_found": "Хост не найден",
        "api.localhost_protected": "localhost нельзя удалить",
        "api.host_deleted": "Хост удален",
        "api.name_updated": "Имя обновлено",
        "err.host_connect": "Не удалось подключиться к хосту: {detail}",
        "err.host_http": "Ошибка: {status}, {reason}",
        "lang.label": "Язык",
    },
}


def normalize_lang(raw: str | None) -> str | None:
    if not raw:
        return None
    code = raw.strip().lower().replace("_", "-")
    if not code:
        return None
    primary = code.split("-", 1)[0]
    if primary in SUPPORTED:
        return primary
    return None


def detect_lang() -> str:
    q = normalize_lang(request.args.get("lang"))
    if q:
        return q
    cookie = normalize_lang(request.cookies.get(COOKIE))
    if cookie:
        return cookie
    # Accept-Language: ru-RU,ru;q=0.9,en;q=0.8
    header = request.accept_languages
    if header:
        best = header.best_match(SUPPORTED)
        if best:
            return best
    return DEFAULT


def translate(key: str, lang: str | None = None, **kwargs) -> str:
    lang = lang or detect_lang()
    catalog = MESSAGES.get(lang) or MESSAGES[DEFAULT]
    text = catalog.get(key) or MESSAGES[DEFAULT].get(key) or key
    if kwargs:
        try:
            return text.format(**kwargs)
        except (KeyError, ValueError):
            return text
    return text


def catalog_for(lang: str | None = None) -> dict:
    lang = lang or detect_lang()
    return dict(MESSAGES.get(lang) or MESSAGES[DEFAULT])


def init_i18n(app):
    @app.context_processor
    def inject_i18n():
        lang = detect_lang()

        def _(key, **kwargs):
            return translate(key, lang=lang, **kwargs)

        return {
            "_": _,
            "lang": lang,
            "i18n_catalog": catalog_for(lang),
            "supported_langs": SUPPORTED,
        }
