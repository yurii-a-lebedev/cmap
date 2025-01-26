async function drawMap() {
    const portColors = {
        80: "#4A90E2", // Светло-синий - HTTP
        443: "#7ED321", // Светло-зеленый - HTTPS
        5432: "#BD10E0", // Светло-фиолетовый - PostgreSQL
        3306: "#50E3C2", // Светло-бирюзовый - MySQL
        6379: "#F8E71C", // Светло-желтый - Redis
        27017: "#F5A623", // Светло-оранжевый - MongoDB
        22: "#9B9B9B", // Светло-серый - SSH
        25: "#FF9AA2", // Светло-розовый - SMTP
        21: "#8FCBFF", // Небесно-голубой - FTP
        8080: "#4A4A90", // Средне-синий - HTTP альтернативный
        3389: "#50AFFF", // Светло-лазурный - RDP
        8443: "#0F6600", // Зеленый темно-светлый - HTTPS альтернативный
        53: "#A3FF00", // Лимонно-зеленый - DNS
        110: "#FFD9B2", // Светло-персиковый - POP3
        143: "#A0522D", // Светло-коричневый - IMAP
        6667: "#D880E0", // Светло-пурпурный - IRC
        5060: "#FAD200", // Светло-золотистый - SIP
        5061: "#FAD200", // Светло-золотистый - SIP (защищенный порт)
        6432: "#E27D60" // Светло-розово-оранжевый - PG-Balancer
    };

    const data = await fetch('/containers_map').then(res => res.json());
    let nodes = data.nodes;
    const links = data.links;

    const width = 7000; // Увеличенная виртуальная ширина карты
    const height = 7000; // Увеличенная виртуальная высота карты

    let selectedNodes = new Set(); // Набор для хранения выбранных узлов

    // Убедимся, что поле поиска добавлено корректно
    const searchContainer = d3.select("body").append("div")
        .attr("class", "search-container")
        .style("display", "flex")
        .style("align-items", "center")
        .style("gap", "10px")
        .style("position", "absolute")
        .style("top", "30px")
        .style("left", "30px")
        .style("z-index", "1000")
        .style("background-color", "#fff")
        .style("padding", "5px")
        .style("border-radius", "5px")
        .style("box-shadow", "0 2px 5px rgba(0, 0, 0, 0.2)");

    const searchBox = searchContainer.append("input")
        .attr("type", "text")
        .attr("placeholder", "Поиск контейнера ...")
        .attr("id", "search-box")
        .style("padding", "8px")
        .style("border", "1px solid #ccc")
        .style("border-radius", "5px")
        .style("width", "200px")
        .on("input", function () {
            const query = this.value.toLowerCase();
            highlightSearch(query);
        });

    searchContainer.append("button")
        .attr("id", "reset-button")
        .style("background", "none")
        .style("border", "none")
        .style("cursor", "pointer")
        .style("padding", "5px")
        .style("height", "32px")
        .style("width", "32px")
        .style("display", "flex")
        .style("align-items", "center")
        .style("justify-content", "center")
        .html("<svg xmlns='http://www.w3.org/2000/svg' height='32' viewBox='0 0 24 24' width='32' fill='#666'><path d='M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z'/></svg>")
        .on("click", () => {
            resetHighlight();
            searchBox.property("value", "");
        });

    // Подсчет количества связей для каждого узла
    const linkCounts = {};
    links.forEach(link => {
        linkCounts[link.source] = (linkCounts[link.source] || 0) + 1;
        linkCounts[link.target] = (linkCounts[link.target] || 0) + 1;
    });

    // Добавляем внешние узлы для сервисов, которых нет в nodes
    links.forEach(link => {
        if (!nodes.find(node => node.id === link.target)) {
            nodes.push({
                id: link.target,
                name: link.target.replace("external:", ""), // Убираем "external:"
                state: "external", // Отмечаем как внешний сервис
            });
        }
    });

    const svg = d3.select("svg")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .call(d3.zoom().on("zoom", (event) => {
            g.attr("transform", event.transform);
        }))
        .on("click", () => {
            resetHighlight();
            searchBox.property("value", "");
        })
        .append("g");

    const g = svg.append("g");

    const simulation = d3.forceSimulation(nodes)
        .force("link", d3.forceLink(links).id(d => d.id).distance(2000)) // Увеличено с 1000 до 2000
        .force("charge", d3.forceManyBody().strength(-2500))
        .force("collide", d3.forceCollide().radius(150))
        .force("center", d3.forceCenter(width / 2, height / 2));

    // Создание связей (линий)
    const link = g.append("g")
        .selectAll("line")
        .data(links)
        .join("line")
        .attr("class", "link")
        .attr("stroke", d => {
            const port = parseInt(d.target_port, 10);
            return portColors[port] || "#666"; // Цвет по порту или серый, если порт не указан
        })
        .attr("stroke-width", 2);

    // Создание маркера для стрелок
    const defs = svg.append("defs");

    defs.append("marker")
        .attr("id", "arrow")
        .attr("viewBox", "0 -5 10 10")
        .attr("refX", 110)
        .attr("refY", 0)
        .attr("markerWidth", 6)
        .attr("markerHeight", 6)
        .attr("orient", "auto")
        .append("path")
        .attr("d", "M0,-5L10,0L0,5")
        .attr("fill", "#666");

    link.attr("marker-end", "url(#arrow)");

    // Создание узлов (кружочков)
    const node = g.append("g")
        .selectAll("g")
        .data(nodes)
        .join("g")
        .attr("class", "node")
        .call(drag(simulation))
        .on("click", (event, d) => {
            event.stopPropagation(); // Предотвращение сброса при клике на узел
            if (selectedNodes.has(d)) {
                selectedNodes.delete(d); // Если узел уже выбран, снять выделение
            } else {
                selectedNodes.add(d); // В противном случае добавить узел в выбранные
            }
            highlightConnections();
        });

    // Добавление кружков
    node.append("circle")
        .attr("r", 100)
        .attr("fill", d => {
            if (d.state === "running") return "#5cb85c";
            if (d.state === "created") return "#f0ad4e";
            if (d.state === "stopped") return "#4d4d4d";
            if (d.state === "external") return "#87CEEB";
            return "#cccccc";
        })
        .attr("stroke", "#333")
        .attr("stroke-width", 2);

    // Добавление текста: первая строка — имя
    node.append("text")
        .attr("text-anchor", "middle")
        .attr("dy", d => (d.state === "external" ? "0.3em" : "-1em"))
        .style("fill", "#000")
        .style("font-size", "18px")
        .style("font-weight", "bold")
        .text(d => d.name);

    // Добавление текста: вторая строка — хост (не для внешних сервисов)
    node.append("text")
        .filter(d => d.state !== "external")
        .attr("text-anchor", "middle")
        .attr("dy", "1.5em")
        .style("fill", "#000")
        .style("font-size", "16px")
        .text(d => d.host);

    // Обновление позиций элементов при каждой итерации симуляции
    simulation.on("tick", () => {
        link
            .attr("x1", d => d.source.x)
            .attr("y1", d => d.source.y)
            .attr("x2", d => d.target.x)
            .attr("y2", d => d.target.y);

        node
            .attr("transform", d => `translate(${d.x},${d.y})`);
    });

    // Функция для выделения связей и связанных узлов
    function highlightConnections() {
        const connectedLinks = new Set();
        const connectedNodes = new Set();

        // Определяем связанные связи и узлы
        selectedNodes.forEach(selected => {
            links.forEach(link => {
                if (link.source.id === selected.id) {
                    connectedLinks.add(link);
                    connectedNodes.add(link.target);
                }
                if (link.target.id === selected.id) {
                    connectedLinks.add(link);
                    connectedNodes.add(link.source);
                }
            });
        });

        // Подсветка связей
        link.attr("stroke", d => {
            if (connectedLinks.has(d)) {
                return portColors[parseInt(d.target_port, 10)] || "#000";
            }
            return "#666";
        }).attr("opacity", d => (connectedLinks.has(d)) ? 1 : 0.2);

        // Подсветка узлов
        node.selectAll("circle")
            .attr("opacity", d => (connectedNodes.has(d) || selectedNodes.has(d)) ? 1 : 0.2);

        // Возврат карты в исходное состояние, если все выделения сняты
        if (selectedNodes.size === 0) {
            resetHighlight();
        }
    }

    // Функция для сброса выделения и поиска
    function resetHighlight() {
        selectedNodes.clear();

        node.selectAll("circle").attr("opacity", 1).attr("fill", d => {
            if (d.state === "running") return "#5cb85c";
            if (d.state === "created") return "#f0ad4e";
            if (d.state === "stopped") return "#4d4d4d";
            if (d.state === "external") return "#87CEEB";
            return "#cccccc";
        }).attr("stroke", "#333").attr("stroke-width", 2);

        link.attr("stroke", d => portColors[parseInt(d.target_port, 10)] || "#666").attr("opacity", 1);
        svg.transition().duration(750).call(
            d3.zoom().transform, d3.zoomIdentity.translate(width / 2, height / 2).scale(1)
        );
    }

    // Функция для подсветки узлов по поисковому запросу
    function highlightSearch(query) {
        node.selectAll("circle")
            .attr("fill", d => d.name.toLowerCase().includes(query) ? "#FF0000" : d.state === "running" ? "#5cb85c" :
                d.state === "created" ? "#f0ad4e" : d.state === "stopped" ? "#4d4d4d" :
                d.state === "external" ? "#87CEEB" : "#cccccc")
            .attr("stroke", "#333")
            .attr("stroke-width", 2);
    }

    // Функции перетаскивания
    function drag(simulation) {
        function dragstarted(event) {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            event.subject.fx = event.subject.x;
            event.subject.fy = event.subject.y;
        }

        function dragged(event) {
            event.subject.fx = event.x;
            event.subject.fy = event.y;
        }

        function dragended(event) {
            if (!event.active) simulation.alphaTarget(0);
            event.subject.fx = null;
            event.subject.fy = null;
        }

        return d3.drag()
            .on("start", dragstarted)
            .on("drag", dragged)
            .on("end", dragended);
    }
}

drawMap();
