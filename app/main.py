import http.client
import json
import re
import socket
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
from flask import Flask, jsonify, render_template, request
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import inspect

from app.config import Config
from app.i18n import COOKIE, init_i18n, normalize_lang, translate

app = Flask(__name__)
app.config.from_object(Config)
init_i18n(app)


@app.after_request
def persist_lang_cookie(response):
    raw = request.args.get("lang")
    lang = normalize_lang(raw) if raw else None
    if lang:
        response.set_cookie(COOKIE, lang, max_age=365 * 24 * 3600, samesite="Lax")
    return response

db = SQLAlchemy(app)

CACHE_TTL_SEC = 15
_cache_lock = threading.Lock()
_inventory_cache = {"expires": 0.0, "payload": None}


class Host(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    host = db.Column(db.String(120), nullable=False)
    port = db.Column(db.Integer, nullable=False)
    visible_name = db.Column(db.String(120), nullable=True)


def table_exists(table_name):
    inspector = inspect(db.engine)
    return table_name in inspector.get_table_names()


with app.app_context():
    if not table_exists("host"):
        db.create_all()


ENABLE_ROUTES = {
    "routes": False,
    "manage_hosts": True,
    "index": True,
    "hosts": True,
    "containers_map": True,
    "map": True,
}


def get_docker_containers(remote_host, port):
    if remote_host == "localhost":
        socket_path = "/var/run/docker.sock"
        try:
            conn = http.client.HTTPConnection("localhost")
            conn.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            conn.sock.connect(socket_path)
            conn.request("GET", "/containers/json?all=true")
            response = conn.getresponse()
            if response.status != 200:
                return f"Error: {response.status}, {response.reason}"
            return json.loads(response.read().decode())
        except Exception as e:
            return f"Could not connect to host: {e}"

    url = f"http://{remote_host}:{port}/containers/json?all=true"
    try:
        response = requests.get(url, timeout=5)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        return f"Could not connect to host: {e}"


def _normalize_ports(raw_ports):
    ports = []
    for p in raw_ports or []:
        priv = p.get("PrivatePort")
        if not priv:
            continue
        ports.append(
            {
                "public": p.get("PublicPort"),
                "private": priv,
                "type": p.get("Type", "tcp"),
            }
        )
    return ports


def invalidate_inventory_cache():
    with _cache_lock:
        _inventory_cache["expires"] = 0.0
        _inventory_cache["payload"] = None


def collect_inventory(force_fresh=False):
    """Параллельный опрос Docker-хостов с TTL-кэшем."""
    now = time.monotonic()
    if not force_fresh:
        with _cache_lock:
            cached = _inventory_cache["payload"]
            if cached is not None and now < _inventory_cache["expires"]:
                return cached

    with app.app_context():
        hosts = Host.query.all()
        host_rows = [
            {
                "id": h.id,
                "host": h.host,
                "port": h.port,
                "visible_name": h.visible_name,
            }
            for h in hosts
        ]

    fetched = []
    if host_rows:
        with ThreadPoolExecutor(max_workers=min(8, max(1, len(host_rows)))) as pool:
            futures = {
                pool.submit(
                    get_docker_containers, row["host"], row["port"]
                ): row
                for row in host_rows
            }
            for fut in as_completed(futures):
                row = futures[fut]
                try:
                    containers = fut.result()
                except Exception as e:
                    containers = f"Could not connect to host: {e}"
                fetched.append(
                    {
                        "host": row["host"],
                        "port": row["port"],
                        "visible_name": row["visible_name"] or row["host"],
                        "containers": containers,
                    }
                )

    fetched.sort(key=lambda x: (0 if x["host"] == "localhost" else 1, x["visible_name"]))

    nodes = []
    for entry in fetched:
        containers = entry["containers"]
        if not isinstance(containers, list):
            continue
        for container in containers:
            labels = container.get("Labels", {}) or {}
            names = container.get("Names") or ["/unknown"]
            name = names[0].strip("/")
            connect_to = (labels.get("connect_to") or "").strip()
            nodes.append(
                {
                    "id": container["Id"][:12],
                    "name": name,
                    "state": container.get("State", ""),
                    "status": container.get("Status", ""),
                    "image": container.get("Image", ""),
                    "host": entry["visible_name"],
                    "project": labels.get("com.docker.compose.project", "") or "",
                    "compose_service": labels.get("com.docker.compose.service", "") or "",
                    "connect_to": connect_to,
                    "ports": _normalize_ports(container.get("Ports")),
                    "labels": labels,
                }
            )

    payload = {
        "fetched_at": time.time(),
        "hosts": fetched,
        "nodes": nodes,
    }
    with _cache_lock:
        _inventory_cache["payload"] = payload
        _inventory_cache["expires"] = time.monotonic() + CACHE_TTL_SEC
    return payload


def _name_matches_service(container_name, service):
    n = container_name.lower()
    s = service.lower()
    if n == s:
        return True
    if n.endswith(f"-{s}") or n.endswith(f"_{s}"):
        return True
    # compose-style project-service-N
    if re.search(rf"(?:^|[-_]){re.escape(s)}(?:[-_]\d+)?$", n):
        return True
    return False


def build_map_graph(inventory):
    nodes = [dict(n) for n in inventory["nodes"]]
    nodes_by_name = {n["name"]: n for n in nodes}
    by_service_project = {}
    by_service = {}
    for n in nodes:
        svc = n.get("compose_service") or ""
        if not svc:
            continue
        by_service_project[(n.get("project") or "", svc)] = n
        by_service.setdefault(svc, []).append(n)

    def resolve(service, source_project):
        key = (service or "").strip()
        if not key:
            return None
        if key in nodes_by_name:
            return nodes_by_name[key]
        if source_project:
            hit = by_service_project.get((source_project, key))
            if hit:
                return hit
        cands = by_service.get(key) or []
        if len(cands) == 1:
            return cands[0]
        fuzzy = [n for n in nodes if _name_matches_service(n["name"], key)]
        if len(fuzzy) == 1:
            return fuzzy[0]
        if source_project:
            same_proj = [n for n in fuzzy if n.get("project") == source_project]
            if len(same_proj) == 1:
                return same_proj[0]
        return None

    links = []
    for n in nodes:
        raw = n.get("connect_to") or ""
        if not raw:
            continue
        for part in raw.split(","):
            part = part.strip()
            if ":" not in part:
                continue
            service, tgt_port = part.split(":", 1)
            service = service.strip()
            tgt_port = tgt_port.strip()
            target = resolve(service, n.get("project") or "")
            if target:
                links.append(
                    {
                        "source": n["id"],
                        "target": target["id"],
                        "target_port": tgt_port,
                        "resolved": "internal",
                    }
                )
            else:
                links.append(
                    {
                        "source": n["id"],
                        "target": f"external:{service}",
                        "target_port": tgt_port,
                        "resolved": "external",
                    }
                )

    linked_ids = set()
    for link in links:
        linked_ids.add(link["source"])
        linked_ids.add(link["target"])

    without = [
        {"id": n["id"], "name": n["name"], "project": n.get("project") or "", "host": n.get("host") or ""}
        for n in nodes
        if not (n.get("connect_to") or "").strip()
    ]
    without.sort(key=lambda x: (x["project"], x["name"]))

    return {
        "nodes": nodes,
        "links": links,
        "coverage": {
            "total": len(nodes),
            "with_connect_to": len(nodes) - len(without),
            "without_connect_to": without,
        },
        "fetched_at": inventory.get("fetched_at"),
        "cached": True,
    }


def build_index_results(inventory):
    results = {}
    total_running = 0
    total_stopped = 0

    for entry in inventory["hosts"]:
        visible_name = entry["visible_name"]
        containers = entry["containers"]
        running_containers = []
        stopped_containers = []

        if not isinstance(containers, list):
            results[visible_name] = {"error": containers, "color": "red"}
            continue

        for container in containers:
            ports = container.get("Ports", []) or []
            labels = container.get("Labels", {}) or {}
            names = container.get("Names") or ["/unknown"]
            container_data = {
                "name": names[0].strip("/"),
                "host_port": ports[0].get("PublicPort", "N/A") if ports else "N/A",
                "container_port": ports[0].get("PrivatePort", "N/A") if ports else "N/A",
                "uptime": container.get("Status", ""),
                "image": container.get("Image", ""),
                "state": container.get("State", ""),
                "project": labels.get("com.docker.compose.project", "") or "",
            }
            if container.get("State") == "running":
                running_containers.append(container_data)
                total_running += 1
            else:
                stopped_containers.append(container_data)
                total_stopped += 1

        if running_containers:
            color = "green"
        elif stopped_containers:
            color = "yellow"
        else:
            color = "blue"

        results[visible_name] = {
            "running": running_containers,
            "stopped": stopped_containers,
            "color": color,
        }

    return results, total_running, total_stopped


@app.route("/healthz", methods=["GET"])
def healthz():
    return jsonify({"status": "ok"}), 200


if ENABLE_ROUTES.get("routes"):
    @app.route("/routes", methods=["GET"])
    def list_routes():
        import urllib

        output = []
        for rule in app.url_map.iter_rules():
            methods = ",".join(rule.methods)
            url = urllib.parse.unquote(f"{rule}")
            output.append(f"{url} [{methods}]")
        return "<br>".join(output)


if ENABLE_ROUTES.get("manage_hosts"):
    @app.route("/manage_hosts", methods=["GET"])
    def manage_hosts_page():
        return render_template("manage_hosts.html")


if ENABLE_ROUTES.get("index"):
    @app.route("/", methods=["GET"])
    def index():
        force = request.args.get("fresh") in ("1", "true", "yes")
        inventory = collect_inventory(force_fresh=force)
        results, total_running, total_stopped = build_index_results(inventory)
        color_legend = {
            "red": translate("legend.red"),
            "blue": translate("legend.blue"),
            "yellow": translate("legend.yellow"),
            "green": translate("legend.green"),
        }
        return render_template(
            "index.html",
            results=results,
            total_running=total_running,
            total_stopped=total_stopped,
            color_legend=color_legend,
        )


if ENABLE_ROUTES.get("hosts"):
    @app.route("/hosts", methods=["GET", "POST", "DELETE", "PATCH"])
    def manage_hosts():
        if request.method == "GET":
            hosts = Host.query.all()
            return jsonify(
                [
                    {
                        "id": host.id,
                        "host": host.host,
                        "port": host.port,
                        "visible_name": host.visible_name,
                    }
                    for host in hosts
                ]
            )

        if request.method == "POST":
            data = request.json or {}
            host_name = (data.get("host") or "").strip()
            try:
                port = int(data.get("port"))
            except (TypeError, ValueError):
                return jsonify({"message": translate("api.bad_port")}), 400
            if not host_name:
                return jsonify({"message": translate("api.host_required")}), 400
            if port < 1 or port > 65535:
                return jsonify({"message": translate("api.port_range")}), 400
            if Host.query.filter_by(host=host_name, port=port).first():
                return jsonify({"message": translate("api.host_exists")}), 409
            new_host = Host(host=host_name, port=port)
            db.session.add(new_host)
            db.session.commit()
            invalidate_inventory_cache()
            return jsonify(
                {"message": translate("api.host_added"), "host": host_name, "port": port}
            ), 201

        if request.method == "DELETE":
            data = request.json or {}
            host = Host.query.get(data.get("id"))
            if not host:
                return jsonify({"message": translate("api.host_not_found")}), 404
            if host.host == "localhost":
                return jsonify({"message": translate("api.localhost_protected")}), 400
            db.session.delete(host)
            db.session.commit()
            invalidate_inventory_cache()
            return jsonify({"message": translate("api.host_deleted")}), 200

        if request.method == "PATCH":
            data = request.json or {}
            host = Host.query.get(data.get("id"))
            if not host:
                return jsonify({"message": translate("api.host_not_found")}), 404
            host.visible_name = data.get("visible_name")
            db.session.commit()
            invalidate_inventory_cache()
            return jsonify({"message": translate("api.name_updated")}), 200


if ENABLE_ROUTES.get("containers_map"):
    @app.route("/containers_map", methods=["GET"])
    def containers_map():
        force = request.args.get("fresh") in ("1", "true", "yes")
        inventory = collect_inventory(force_fresh=force)
        graph = build_map_graph(inventory)
        # drop heavy labels from response for clients that don't need them
        for n in graph["nodes"]:
            n.pop("labels", None)
        return jsonify(graph)


if ENABLE_ROUTES.get("map"):
    @app.route("/map", methods=["GET"])
    def container_map_page():
        return render_template("map.html")


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
