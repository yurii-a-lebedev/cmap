async function drawMap() {
  const portColors = {
    80: "#4A90E2",
    443: "#5ecf8a",
    5432: "#BD10E0",
    3306: "#50E3C2",
    6379: "#F8E71C",
    27017: "#F5A623",
    22: "#9B9B9B",
    25: "#FF9AA2",
    21: "#8FCBFF",
    8080: "#7B8CDE",
    3389: "#50AFFF",
    8443: "#3D9A5F",
    53: "#A3FF00",
    110: "#FFD9B2",
    143: "#C48A5A",
    6432: "#E27D60",
  };

  const portNames = {
    80: "HTTP",
    443: "HTTPS",
    5432: "Postgres",
    3306: "MySQL",
    6379: "Redis",
    27017: "Mongo",
    22: "SSH",
    8080: "HTTP alt",
    8443: "HTTPS alt",
    53: "DNS",
  };

  const data = await fetch("/containers_map").then((res) => res.json());
  let nodes = data.nodes.slice();
  const links = data.links;

  const linkedIds = new Set();
  links.forEach((l) => {
    linkedIds.add(typeof l.source === "object" ? l.source.id : l.source);
    linkedIds.add(typeof l.target === "object" ? l.target.id : l.target);
  });

  links.forEach((link) => {
    if (!nodes.find((n) => n.id === link.target)) {
      nodes.push({
        id: link.target,
        name: String(link.target).replace(/^external:/, ""),
        state: "external",
        host: "external",
        image: "",
        status: "external service",
        project: "",
        connect_to: "",
        ports: [],
        labels: {},
      });
    }
  });

  const datalist = document.getElementById("node-names");
  nodes.forEach((n) => {
    const opt = document.createElement("option");
    opt.value = n.name;
    datalist.appendChild(opt);
  });

  const portLegend = document.getElementById("port-legend");
  const usedPorts = [...new Set(links.map((l) => String(l.target_port)))].sort();
  usedPorts.forEach((p) => {
    const item = document.createElement("div");
    item.className = "legend-item";
    const sw = document.createElement("span");
    sw.className = "swatch";
    sw.style.background = portColors[p] || "#666";
    item.append(sw, document.createTextNode(`${p}${portNames[p] ? " · " + portNames[p] : ""}`));
    portLegend.appendChild(item);
  });

  const svgEl = document.getElementById("map-svg");
  const canvas = svgEl.parentElement;
  const width = canvas.clientWidth || 1200;
  const height = canvas.clientHeight || 800;
  const selectedNodes = new Set();
  let zoomBehavior;
  let currentTransform = d3.zoomIdentity;

  const STORAGE_KEY = "cmap-node-positions-v1";
  const saved = (() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch {
      return {};
    }
  })();
  nodes.forEach((n) => {
    if (saved[n.id]) {
      n.x = saved[n.id].x;
      n.y = saved[n.id].y;
      n.fx = saved[n.id].x;
      n.fy = saved[n.id].y;
    }
  });

  const svg = d3.select(svgEl).attr("viewBox", `0 0 ${width} ${height}`);
  const g = svg.append("g");

  zoomBehavior = d3
    .zoom()
    .scaleExtent([0.15, 4])
    .on("zoom", (event) => {
      currentTransform = event.transform;
      g.attr("transform", event.transform);
    });
  svg.call(zoomBehavior);

  const simulation = d3
    .forceSimulation(nodes)
    .force(
      "link",
      d3
        .forceLink(links)
        .id((d) => d.id)
        .distance(140)
        .strength(0.6)
    )
    .force("charge", d3.forceManyBody().strength(-420))
    .force("collide", d3.forceCollide().radius(42))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force("x", d3.forceX(width / 2).strength(0.05))
    .force("y", d3.forceY(height / 2).strength(0.05));

  const link = g
    .append("g")
    .selectAll("line")
    .data(links)
    .join("line")
    .attr("class", "link-line")
    .attr("stroke", (d) => portColors[parseInt(d.target_port, 10)] || "#666")
    .attr("stroke-width", 1.6);

  const linkLabels = g
    .append("g")
    .selectAll("g")
    .data(links)
    .join("g")
    .attr("class", "link-label-group")
    .style("visibility", "hidden")
    .each(function (d) {
      d3.select(this)
        .append("rect")
        .attr("x", -18)
        .attr("y", -10)
        .attr("width", 36)
        .attr("height", 20)
        .attr("rx", 6)
        .attr("fill", "#161c26")
        .attr("stroke", portColors[parseInt(d.target_port, 10)] || "#666");
      d3.select(this)
        .append("text")
        .attr("text-anchor", "middle")
        .attr("dy", "0.35em")
        .style("font-size", "11px")
        .style("fill", "#e7edf6")
        .text(d.target_port);
    });

  const defs = svg.append("defs");
  defs
    .append("marker")
    .attr("id", "arrow")
    .attr("viewBox", "0 -5 10 10")
    .attr("refX", 28)
    .attr("refY", 0)
    .attr("markerWidth", 6)
    .attr("markerHeight", 6)
    .attr("orient", "auto")
    .append("path")
    .attr("d", "M0,-5L10,0L0,5")
    .attr("fill", "#8b97a8");
  link.attr("marker-end", "url(#arrow)");

  const node = g
    .append("g")
    .selectAll("g")
    .data(nodes)
    .join("g")
    .attr("class", "node")
    .call(drag(simulation))
    .on("click", (event, d) => {
      event.stopPropagation();
      if (selectedNodes.has(d)) selectedNodes.delete(d);
      else selectedNodes.add(d);
      highlightConnections();
      showDrawer(d);
    });

  node
    .append("circle")
    .attr("class", "node-circle")
    .attr("r", (d) => (d.state === "external" ? 18 : 22))
    .attr("fill", nodeColor)
    .attr("stroke", (d) => (d.state === "external" ? "#6aa8ff" : "#2a3444"))
    .attr("stroke-width", (d) => (d.state === "external" ? 2.5 : 1.5))
    .attr("stroke-dasharray", (d) => (d.state === "external" ? "4 3" : null));

  node
    .append("text")
    .attr("text-anchor", "middle")
    .attr("dy", 36)
    .style("fill", "#e7edf6")
    .style("font-size", "11px")
    .style("font-weight", "600")
    .text((d) => truncate(d.name, 18));

  simulation.on("tick", () => {
    link
      .attr("x1", (d) => d.source.x)
      .attr("y1", (d) => d.source.y)
      .attr("x2", (d) => d.target.x)
      .attr("y2", (d) => d.target.y);
    linkLabels.attr(
      "transform",
      (d) => `translate(${(d.source.x + d.target.x) / 2},${(d.source.y + d.target.y) / 2})`
    );
    node.attr("transform", (d) => `translate(${d.x},${d.y})`);
  });

  simulation.on("end", () => {
    persistPositions();
    fitToScreen(false);
  });

  function nodeColor(d) {
    if (d.state === "running") return "#5ecf8a";
    if (d.state === "created") return "#e6a23c";
    if (d.state === "exited" || d.state === "stopped" || d.state === "dead") return "#667384";
    if (d.state === "external") return "#1c2a44";
    return "#3a4556";
  }

  function truncate(s, n) {
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }

  function persistPositions() {
    const out = {};
    nodes.forEach((n) => {
      out[n.id] = { x: n.x, y: n.y };
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
  }

  function fitToScreen(animate = true) {
    const xs = nodes.map((n) => n.x).filter(Number.isFinite);
    const ys = nodes.map((n) => n.y).filter(Number.isFinite);
    if (!xs.length) return;
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const bw = Math.max(maxX - minX, 1);
    const bh = Math.max(maxY - minY, 1);
    const pad = 80;
    const scale = Math.min((width - pad) / bw, (height - pad) / bh, 1.8) * 0.9;
    const tx = width / 2 - (scale * (minX + maxX)) / 2;
    const ty = height / 2 - (scale * (minY + maxY)) / 2;
    const t = d3.zoomIdentity.translate(tx, ty).scale(scale);
    const sel = animate ? svg.transition().duration(500) : svg;
    sel.call(zoomBehavior.transform, t);
  }

  function focusNode(d) {
    const scale = Math.max(currentTransform.k, 1.2);
    const t = d3.zoomIdentity
      .translate(width / 2, height / 2)
      .scale(scale)
      .translate(-d.x, -d.y);
    svg.transition().duration(450).call(zoomBehavior.transform, t);
  }

  function showDrawer(d) {
    const empty = document.getElementById("drawer-empty");
    const body = document.getElementById("drawer-body");
    empty.hidden = true;
    body.hidden = false;
    const ports =
      (d.ports || [])
        .map((p) => `${p.public || "—"}→${p.private}/${p.type || "tcp"}`)
        .join(", ") || "—";
    body.innerHTML = `
      <div><dt>Имя</dt><dd>${escapeHtml(d.name)}</dd></div>
      <div><dt>Состояние</dt><dd>${escapeHtml(d.state || "—")}</dd></div>
      <div><dt>Статус</dt><dd>${escapeHtml(d.status || "—")}</dd></div>
      <div><dt>Хост</dt><dd>${escapeHtml(d.host || "—")}</dd></div>
      <div><dt>Образ</dt><dd>${escapeHtml(d.image || "—")}</dd></div>
      <div><dt>Проект</dt><dd>${escapeHtml(d.project || "—")}</dd></div>
      <div><dt>Порты</dt><dd>${escapeHtml(ports)}</dd></div>
      <div><dt>connect_to</dt><dd>${escapeHtml(d.connect_to || "—")}</dd></div>
    `;
  }

  function clearDrawer() {
    document.getElementById("drawer-empty").hidden = false;
    document.getElementById("drawer-body").hidden = true;
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  function highlightConnections() {
    const connectedLinks = new Set();
    const connectedNodes = new Set();
    selectedNodes.forEach((selected) => {
      links.forEach((link) => {
        if (link.source.id === selected.id || link.target.id === selected.id) {
          connectedLinks.add(link);
          connectedNodes.add(link.source);
          connectedNodes.add(link.target);
        }
      });
    });

    if (!selectedNodes.size) {
      resetHighlight(false);
      return;
    }

    link
      .attr("stroke", (d) =>
        connectedLinks.has(d) ? portColors[parseInt(d.target_port, 10)] || "#fff" : "#333"
      )
      .attr("opacity", (d) => (connectedLinks.has(d) ? 1 : 0.12));
    linkLabels.style("visibility", (d) => (connectedLinks.has(d) ? "visible" : "hidden"));
    node
      .selectAll("circle")
      .attr("opacity", (d) => (connectedNodes.has(d) || selectedNodes.has(d) ? 1 : 0.15));
  }

  function resetHighlight(clearSearch = true) {
    selectedNodes.clear();
    node.selectAll("circle").attr("opacity", 1).attr("fill", nodeColor);
    link
      .attr("stroke", (d) => portColors[parseInt(d.target_port, 10)] || "#666")
      .attr("opacity", 1);
    linkLabels.style("visibility", "hidden");
    clearDrawer();
    if (clearSearch) document.getElementById("search-box").value = "";
    applyFilters();
  }

  function applyFilters() {
    const q = document.getElementById("search-box").value.trim().toLowerCase();
    const showRunning = document.getElementById("flt-running").checked;
    const showStopped = document.getElementById("flt-stopped").checked;
    const showExternal = document.getElementById("flt-external").checked;
    const onlyOrphan = document.getElementById("flt-orphan").checked;
    const prefix = document.getElementById("flt-prefix").value.trim().toLowerCase();

    const visible = new Set();
    nodes.forEach((d) => {
      const isExt = d.state === "external";
      const isRun = d.state === "running";
      const isStop = !isExt && !isRun;
      let ok = true;
      if (isExt && !showExternal) ok = false;
      if (isRun && !showRunning) ok = false;
      if (isStop && !showStopped) ok = false;
      if (onlyOrphan && linkedIds.has(d.id) && !String(d.id).startsWith("external:")) ok = false;
      if (prefix && !(d.name || "").toLowerCase().includes(prefix) && !(d.project || "").toLowerCase().includes(prefix))
        ok = false;
      if (q && !(d.name || "").toLowerCase().includes(q)) ok = false;
      if (ok) visible.add(d.id);
    });

    node.style("display", (d) => (visible.has(d.id) ? null : "none"));
    link.style("display", (d) =>
      visible.has(d.source.id) && visible.has(d.target.id) ? null : "none"
    );

    if (q) {
      const matches = nodes.filter((d) => visible.has(d.id) && d.name.toLowerCase().includes(q));
      node.selectAll("circle").attr("stroke", (d) =>
        matches.includes(d) ? "#ff5a5a" : d.state === "external" ? "#6aa8ff" : "#2a3444"
      );
      if (matches.length === 1) focusNode(matches[0]);
    } else {
      node.selectAll("circle").attr("stroke", (d) => (d.state === "external" ? "#6aa8ff" : "#2a3444"));
    }
  }

  function drag(sim) {
    return d3
      .drag()
      .on("start", (event) => {
        if (!event.active) sim.alphaTarget(0.2).restart();
        event.subject.fx = event.subject.x;
        event.subject.fy = event.subject.y;
      })
      .on("drag", (event) => {
        event.subject.fx = event.x;
        event.subject.fy = event.y;
      })
      .on("end", (event) => {
        if (!event.active) sim.alphaTarget(0);
        persistPositions();
      });
  }

  document.getElementById("search-box").addEventListener("input", applyFilters);
  document.getElementById("flt-running").addEventListener("change", applyFilters);
  document.getElementById("flt-stopped").addEventListener("change", applyFilters);
  document.getElementById("flt-external").addEventListener("change", applyFilters);
  document.getElementById("flt-orphan").addEventListener("change", applyFilters);
  document.getElementById("flt-prefix").addEventListener("input", applyFilters);
  document.getElementById("btn-fit").addEventListener("click", () => fitToScreen(true));
  document.getElementById("btn-zoom-in").addEventListener("click", () => {
    svg.transition().duration(200).call(zoomBehavior.scaleBy, 1.25);
  });
  document.getElementById("btn-zoom-out").addEventListener("click", () => {
    svg.transition().duration(200).call(zoomBehavior.scaleBy, 0.8);
  });
  document.getElementById("btn-reset").addEventListener("click", () => resetHighlight(true));
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") resetHighlight(true);
  });

  // Не сбрасывать по клику на пустой фон без modifier — только через Reset/Esc
  setTimeout(() => fitToScreen(false), 800);
}

drawMap();
