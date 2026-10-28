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
    linkedIds.add(l.source);
    linkedIds.add(l.target);
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
  const usedPorts = [...new Set(links.map((l) => String(l.target_port)))].sort(
    (a, b) => Number(a) - Number(b)
  );
  usedPorts.forEach((p) => {
    const item = document.createElement("div");
    item.className = "legend-item";
    const sw = document.createElement("span");
    sw.className = "swatch";
    sw.style.background = portColors[p] || "#666";
    item.append(
      sw,
      document.createTextNode(`${p}${portNames[p] ? " · " + portNames[p] : ""}`)
    );
    portLegend.appendChild(item);
  });

  const svgEl = document.getElementById("map-svg");
  const canvas = svgEl.parentElement;
  const width = Math.max(canvas.clientWidth || 1200, 320);
  const height = Math.max(canvas.clientHeight || 800, 320);
  const selectedNodes = new Set();
  let zoomBehavior;
  let fittedOnce = false;

  const STORAGE_KEY = "cmap-node-positions-v3";
  let activeProject = "";
  const saved = (() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch {
      return {};
    }
  })();

  const projectNames = [
    ...new Set(nodes.map((n) => n.project).filter(Boolean)),
  ].sort();
  const projectCenters = {};
  projectNames.forEach((p, i) => {
    const angle = (i / Math.max(projectNames.length, 1)) * Math.PI * 2;
    projectCenters[p] = {
      x: width / 2 + Math.cos(angle) * Math.min(width, height) * 0.32,
      y: height / 2 + Math.sin(angle) * Math.min(width, height) * 0.28,
    };
  });
  projectCenters._none = { x: width / 2, y: height / 2 };
  projectCenters.external = {
    x: width / 2,
    y: height * 0.12,
  };

  // Стартовые координаты без жёсткой фиксации
  nodes.forEach((n, i) => {
    if (saved[n.id] && Number.isFinite(saved[n.id].x) && Number.isFinite(saved[n.id].y)) {
      n.x = saved[n.id].x;
      n.y = saved[n.id].y;
    } else {
      const key = n.state === "external" ? "external" : n.project || "_none";
      const c = projectCenters[key] || projectCenters._none;
      const angle = (i / nodes.length) * Math.PI * 2;
      n.x = c.x + Math.cos(angle) * 40;
      n.y = c.y + Math.sin(angle) * 40;
    }
  });

  const svg = d3.select(svgEl).attr("viewBox", `0 0 ${width} ${height}`);
  const g = svg.append("g");

  zoomBehavior = d3
    .zoom()
    .scaleExtent([0.15, 4])
    .on("zoom", (event) => {
      g.attr("transform", event.transform);
    });
  svg.call(zoomBehavior);

  function clusterStrength() {
    return document.getElementById("flt-cluster").checked ? 0.45 : 0.03;
  }

  const simulation = d3
    .forceSimulation(nodes)
    .force(
      "link",
      d3
        .forceLink(links)
        .id((d) => d.id)
        .distance(140)
        .strength(0.55)
    )
    .force("charge", d3.forceManyBody().strength(-420))
    .force("collide", d3.forceCollide().radius(48))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force(
      "x",
      d3
        .forceX((d) => {
          const key = d.state === "external" ? "external" : d.project || "_none";
          return (projectCenters[key] || projectCenters._none).x;
        })
        .strength(clusterStrength)
    )
    .force(
      "y",
      d3
        .forceY((d) => {
          const key = d.state === "external" ? "external" : d.project || "_none";
          return (projectCenters[key] || projectCenters._none).y;
        })
        .strength(clusterStrength)
    )
    .alphaDecay(0.028);

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
    .style("cursor", "pointer")
    .call(drag(simulation))
    .on("click", (event, d) => {
      event.stopPropagation();
      if (selectedNodes.has(d)) selectedNodes.delete(d);
      else {
        selectedNodes.clear();
        selectedNodes.add(d);
      }
      highlightConnections();
      showDrawer(d);
    });

  node.append("title").text((d) => d.name);

  node
    .append("circle")
    .attr("class", "node-circle")
    .attr("r", (d) => (d.state === "external" ? 18 : 22))
    .attr("fill", nodeColor)
    .attr("stroke", (d) => (d.state === "external" ? "#6aa8ff" : "#2a3444"))
    .attr("stroke-width", (d) => (d.state === "external" ? 2.5 : 1.5))
    .attr("stroke-dasharray", (d) => (d.state === "external" ? "4 3" : null));

  const label = node.append("g").attr("class", "node-label").attr("transform", "translate(0,34)");
  label
    .append("rect")
    .attr("rx", 6)
    .attr("fill", "rgba(14,18,24,0.88)")
    .attr("stroke", "#2a3444");
  label
    .append("text")
    .attr("text-anchor", "middle")
    .attr("dy", "0.35em")
    .style("fill", "#e7edf6")
    .style("font-size", "12px")
    .style("font-weight", "600")
    .text((d) => truncate(d.name, 20));

  label.each(function () {
    const text = this.querySelector("text");
    const rect = this.querySelector("rect");
    const box = text.getBBox();
    rect.setAttribute("x", box.x - 6);
    rect.setAttribute("y", box.y - 3);
    rect.setAttribute("width", box.width + 12);
    rect.setAttribute("height", box.height + 6);
  });

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

    if (!fittedOnce && simulation.alpha() < 0.12) {
      fittedOnce = true;
      fitToScreen(false);
      persistPositions();
    }
  });

  simulation.on("end", () => {
    if (!fittedOnce) {
      fittedOnce = true;
      fitToScreen(false);
    }
    persistPositions();
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
      if (Number.isFinite(n.x) && Number.isFinite(n.y)) out[n.id] = { x: n.x, y: n.y };
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
  }

  function fitToScreen(animate = true) {
    const shown = nodes.filter((n) => {
      const el = node.filter((d) => d.id === n.id).node();
      return el && el.style.display !== "none";
    });
    const pool = shown.length ? shown : nodes;
    const xs = pool.map((n) => n.x).filter(Number.isFinite);
    const ys = pool.map((n) => n.y).filter(Number.isFinite);
    if (!xs.length) return;
    const minX = Math.min(...xs) - 40;
    const maxX = Math.max(...xs) + 40;
    const minY = Math.min(...ys) - 40;
    const maxY = Math.max(...ys) + 40;
    const bw = Math.max(maxX - minX, 1);
    const bh = Math.max(maxY - minY, 1);
    const pad = 56;
    const scale = Math.min((width - pad) / bw, (height - pad) / bh, 2.2) * 0.92;
    const tx = width / 2 - (scale * (minX + maxX)) / 2;
    const ty = height / 2 - (scale * (minY + maxY)) / 2;
    const t = d3.zoomIdentity.translate(tx, ty).scale(scale);
    const sel = animate ? svg.transition().duration(450) : svg;
    sel.call(zoomBehavior.transform, t);
  }

  function focusNode(d) {
    const scale = 1.35;
    const t = d3.zoomIdentity
      .translate(width / 2, height / 2)
      .scale(scale)
      .translate(-d.x, -d.y);
    svg.transition().duration(400).call(zoomBehavior.transform, t);
  }

  function showDrawer(d) {
    const empty = document.getElementById("drawer-empty");
    const body = document.getElementById("drawer-body");
    empty.hidden = true;
    body.hidden = false;
    const ports =
      (d.ports || [])
        .map((p) => {
          if (p.public) return `${p.public}→${p.private}/${p.type || "tcp"}`;
          return `${p.private}/${p.type || "tcp"}`;
        })
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
    const linkedOnly = document.getElementById("flt-linked-only").checked;
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
      if (linkedOnly && !linkedIds.has(d.id)) ok = false;
      if (activeProject && d.project !== activeProject && d.state !== "external") ok = false;
      if (
        prefix &&
        !(d.name || "").toLowerCase().includes(prefix) &&
        !(d.project || "").toLowerCase().includes(prefix)
      )
        ok = false;
      if (q && !(d.name || "").toLowerCase().includes(q)) ok = false;
      if (ok) visible.add(d.id);
    });

    node.style("display", (d) => (visible.has(d.id) ? null : "none"));
    link.style("display", (d) =>
      visible.has(d.source.id) && visible.has(d.target.id) ? null : "none"
    );

    const visibleNodes = nodes.filter((d) => visible.has(d.id));
    const stats = document.getElementById("map-stats");
    if (stats) {
      stats.textContent = `На карте: ${visibleNodes.length} узлов · ${links.filter((l) => visible.has(l.source.id) && visible.has(l.target.id)).length} связей`;
    }

    if (q) {
      const matches = visibleNodes.filter((d) => d.name.toLowerCase().includes(q));
      node
        .selectAll("circle")
        .attr("stroke", (d) =>
          matches.includes(d) ? "#ff5a5a" : d.state === "external" ? "#6aa8ff" : "#2a3444"
        )
        .attr("stroke-width", (d) => (matches.includes(d) ? 3 : d.state === "external" ? 2.5 : 1.5));
      if (matches.length === 1) {
        focusNode(matches[0]);
        showDrawer(matches[0]);
      } else if (matches.length > 1) {
        fitToNodes(matches, true);
      }
    } else {
      node
        .selectAll("circle")
        .attr("stroke", (d) => (d.state === "external" ? "#6aa8ff" : "#2a3444"))
        .attr("stroke-width", (d) => (d.state === "external" ? 2.5 : 1.5));
    }
  }

  function updateClusterForce() {
    simulation.force("x").strength(clusterStrength);
    simulation.force("y").strength(clusterStrength);
    fittedOnce = false;
    simulation.alpha(0.8).restart();
  }

  function fitToNodes(subset, animate = true) {
    const xs = subset.map((n) => n.x).filter(Number.isFinite);
    const ys = subset.map((n) => n.y).filter(Number.isFinite);
    if (!xs.length) return;
    const minX = Math.min(...xs) - 60;
    const maxX = Math.max(...xs) + 60;
    const minY = Math.min(...ys) - 60;
    const maxY = Math.max(...ys) + 60;
    const bw = Math.max(maxX - minX, 80);
    const bh = Math.max(maxY - minY, 80);
    const scale = Math.min((width - 80) / bw, (height - 80) / bh, 2.5) * 0.85;
    const tx = width / 2 - (scale * (minX + maxX)) / 2;
    const ty = height / 2 - (scale * (minY + maxY)) / 2;
    const t = d3.zoomIdentity.translate(tx, ty).scale(scale);
    const sel = animate ? svg.transition().duration(350) : svg;
    sel.call(zoomBehavior.transform, t);
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
        event.subject.fx = event.subject.x;
        event.subject.fy = event.subject.y;
        persistPositions();
      });
  }

  const chips = document.getElementById("project-chips");
  function setProjectFilter(project) {
    activeProject = project;
    [...chips.querySelectorAll(".project-chip")].forEach((el) => {
      const isAll = el.textContent === "все";
      el.classList.toggle("active", isAll ? !project : el.textContent === project);
    });
    applyFilters();
    fittedOnce = false;
    simulation.alpha(0.7).restart();
  }
  const allChip = document.createElement("button");
  allChip.type = "button";
  allChip.className = "project-chip active";
  allChip.textContent = "все";
  allChip.onclick = () => setProjectFilter("");
  chips.appendChild(allChip);
  projectNames.forEach((p) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "project-chip";
    btn.textContent = p;
    btn.onclick = () => setProjectFilter(p);
    chips.appendChild(btn);
  });

  document.getElementById("search-box").addEventListener("input", applyFilters);
  document.getElementById("flt-running").addEventListener("change", applyFilters);
  document.getElementById("flt-stopped").addEventListener("change", applyFilters);
  document.getElementById("flt-external").addEventListener("change", applyFilters);
  document.getElementById("flt-linked-only").addEventListener("change", () => {
    applyFilters();
    fittedOnce = false;
    fitToScreen(true);
  });
  document.getElementById("flt-cluster").addEventListener("change", updateClusterForce);
  document.getElementById("flt-prefix").addEventListener("input", applyFilters);
  document.getElementById("btn-fit").addEventListener("click", () => fitToScreen(true));
  document.getElementById("btn-zoom-in").addEventListener("click", () => {
    svg.transition().duration(200).call(zoomBehavior.scaleBy, 1.25);
  });
  document.getElementById("btn-zoom-out").addEventListener("click", () => {
    svg.transition().duration(200).call(zoomBehavior.scaleBy, 0.8);
  });
  document.getElementById("btn-reset").addEventListener("click", () => {
    nodes.forEach((n) => {
      n.fx = null;
      n.fy = null;
    });
    localStorage.removeItem(STORAGE_KEY);
    fittedOnce = false;
    simulation.alpha(1).restart();
    resetHighlight(true);
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") resetHighlight(true);
  });
  window.addEventListener("resize", () => fitToScreen(false));

  applyFilters();
}

drawMap();
