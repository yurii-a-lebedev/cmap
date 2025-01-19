async function drawMap() {
    const data = await fetch('/containers_map').then(res => res.json());
    let nodes = data.nodes;
    const links = data.links;

    const width = 7000; // Увеличенная виртуальная ширина карты
    const height = 7000; // Увеличенная виртуальная высота карты

    let selectedNodes = new Set(); // Набор для хранения выбранных узлов

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
        .on("click", () => resetHighlight()) // Сброс выделения при клике в пустую область
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
        .attr("stroke", "#666")
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
                return d.source.id === selectedNodes.values().next().value.id ? "#0000ff" : "#ff0000"; // Синий для исходящих, красный для входящих
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

    // Функция для сброса выделения
    function resetHighlight() {
        selectedNodes.clear();

        node.selectAll("circle").attr("opacity", 1);
        link.attr("stroke", "#666").attr("opacity", 1);
        svg.transition().duration(750).call(
            d3.zoom().transform, d3.zoomIdentity.translate(width / 2, height / 2).scale(1)
        );
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
