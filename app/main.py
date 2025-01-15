import requests
import http.client
import json
from flask import Flask, render_template, request, jsonify, abort
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import inspect
import socket

# Инициализация приложения Flask
app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///hosts.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# Инициализация SQLAlchemy
db = SQLAlchemy(app)

# Модель базы данных для хранения информации о хостах
class Host(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    host = db.Column(db.String(120), nullable=False)
    port = db.Column(db.Integer, nullable=False)

# Проверка существования таблицы через инспектор
def table_exists(table_name):
    inspector = inspect(db.engine)
    return table_name in inspector.get_table_names()

# Создание базы данных при первом запуске
with app.app_context():
    if not table_exists("host"):
        db.create_all()

# Флаги включения/выключения маршрутов
ENABLE_ROUTES = {
    "routes": False,
    "manage_hosts": True,
    "index": True,
    "hosts": True,
    "containers_map": True,
    "map": True,
}

# Функция для получения данных о Docker-контейнерах
def get_docker_containers(remote_host, port):
    if remote_host == "localhost":
        # Используем локальный сокет Docker
        socket_path = "/var/run/docker.sock"
        try:
            conn = http.client.HTTPConnection("localhost")
            conn.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            conn.sock.connect(socket_path)
            conn.request("GET", "/containers/json?all=true")
            response = conn.getresponse()
            if response.status != 200:
                return f"Ошибка: {response.status}, {response.reason}"
            return json.loads(response.read().decode())
        except Exception as e:
            return f"Не удалось подключиться к хосту: {e}"
    else:
        # Используем стандартный Docker API
        url = f"http://{remote_host}:{port}/containers/json?all=true"
        try:
            response = requests.get(url, timeout=5)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            return f"Не удалось подключиться к хосту: {e}"

# Список доступных маршрутов
if ENABLE_ROUTES.get("routes"):
    @app.route("/routes", methods=["GET"])
    def list_routes():
        import urllib
        output = []
        for rule in app.url_map.iter_rules():
            methods = ','.join(rule.methods)
            url = urllib.parse.unquote(f"{rule}")
            output.append(f"{url} [{methods}]")
        return "<br>".join(output)

# Страница управления хостами
if ENABLE_ROUTES.get("manage_hosts"):
    @app.route("/manage_hosts", methods=["GET"])
    def manage_hosts_page():
        return render_template("manage_hosts.html")

# Главная страница отображения контейнеров
if ENABLE_ROUTES.get("index"):
    @app.route("/", methods=["GET"])
    def index():
        results = {}
        total_running = 0
        total_stopped = 0

        # Получение списка хостов из базы данных
        hosts = Host.query.all()
        for entry in hosts:
            host = entry.host
            port = entry.port
            containers = get_docker_containers(host, port)

            running_containers = []
            stopped_containers = []

            if isinstance(containers, list):
                for container in containers:
                    ports = container.get('Ports', [])
                    container_data = {
                        "name": container['Names'][0].strip('/'),
                        "host_port": ports[0].get('PublicPort', "N/A") if ports else "N/A",
                        "container_port": ports[0].get('PrivatePort', "N/A") if ports else "N/A",
                        "uptime": container['Status'],
                        "image": container['Image']
                    }
                    if container['State'] == 'running':
                        running_containers.append(container_data)
                        total_running += 1
                    else:
                        stopped_containers.append(container_data)
                        total_stopped += 1
            else:
                results[host] = {"error": containers, "color": "red"}
                continue

            if running_containers:
                color = "green"
            elif not running_containers and stopped_containers:
                color = "yellow"
            elif not running_containers and not stopped_containers:
                color = "blue"
            else:
                color = "blue"

            results[host] = {
                "running": running_containers,
                "stopped": stopped_containers,
                "color": color
            }

        color_legend = {
            "red": "Хост не доступен",
            "blue": "На хосте нет контейнеров",
            "yellow": "На хосте нет запущенных контейнеров",
            "green": "Хост доступен и на нем есть запущенные контейнеры"
        }

        return render_template("index.html", results=results, total_running=total_running, total_stopped=total_stopped, color_legend=color_legend)

# API для управления хостами
if ENABLE_ROUTES.get("hosts"):
    @app.route("/hosts", methods=["GET", "POST", "DELETE"])
    def manage_hosts():
        if request.method == "GET":
            hosts = Host.query.all()
            return jsonify([{"id": host.id, "host": host.host, "port": host.port} for host in hosts])

        if request.method == "POST":
            data = request.json
            new_host = Host(host=data['host'], port=data['port'])
            db.session.add(new_host)
            db.session.commit()
            return jsonify({"message": "Хост добавлен", "host": data['host'], "port": data['port']}), 201

        if request.method == "DELETE":
            data = request.json
            host = Host.query.get(data['id'])
            if host:
                db.session.delete(host)
                db.session.commit()
                return jsonify({"message": "Хост удален"}), 200
            return jsonify({"message": "Хост не найден"}), 404

# Эндпоинт для карты контейнеров
if ENABLE_ROUTES.get("containers_map"):
    @app.route("/containers_map", methods=["GET"])
    def containers_map():
        results = {"nodes": [], "links": []}
        hosts = Host.query.all()
        container_ids = {}

        # Сбор информации о контейнерах
        for entry in hosts:
            host = entry.host
            port = entry.port
            containers = get_docker_containers(host, port)

            if isinstance(containers, list):
                for container in containers:
                    container_id = container['Id'][:12]
                    container_name = container['Names'][0].strip('/')
                    container_state = container['State']
                    container_labels = container.get('Labels', {})

                    # Добавляем узел контейнера с информацией о хосте
                    results["nodes"].append({
                        "id": container_id,
                        "name": container_name,
                        "state": container_state,
                        "host": host,  # Имя хоста
                        "labels": container_labels
                    })
                    container_ids[container_name] = container_id

                    # Обработка connect_to с несколькими целями
                    connect_to = container_labels.get('connect_to', '')
                    connections = connect_to.split(',')
                    for connection in connections:
                        if ':' in connection:
                            service, port = connection.split(':')
                            results["links"].append({
                                "source": container_id,
                                "target_service": service.strip(),
                                "target_port": port.strip()
                            })

        # Добавляем связи, проверяя существующие узлы
        for link in results["links"]:
            target_id = container_ids.get(link["target_service"])
            if target_id:
                link["target"] = target_id
            else:
                link["target"] = f"external:{link['target_service']}"

        # Удаляем временные поля
        results["links"] = [
            {k: v for k, v in link.items() if k not in ["target_service", "target_port"]}
            for link in results["links"]
        ]

        return jsonify(results)

if ENABLE_ROUTES.get("map"):
    @app.route("/map", methods=["GET"])
    def container_map_page():
        return render_template("map.html")

# Точка входа
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)

