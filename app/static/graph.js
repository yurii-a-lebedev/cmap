const POLL_MS = 20000;
const STORAGE_KEY = "cmap-node-positions-v5";
let mapController = null;

/** Только структура графа — без state, иначе poll каждые 20с ломает раскладку. */
function structureKey(data) {
  const nodePart = (data.nodes || [])
    .map((n) => `${n.id}:${n.connect_to || ""}`)
    .sort()
    .join("|");
  const linkPart = (data.links || [])
    .map((l) => `${l.source}->${l.target}:${l.target_port}`)
    .sort()
    .join("|");
  return `${nodePart}#${linkPart}`;
}

function loadSavedPositions() {
  try {
    const raw =
      localStorage.getItem(STORAGE_KEY) ||
      localStorage.getItem("cmap-node-positions-v4") ||
      localStorage.getItem("cmap-node-positions-v3") ||
      "{}";
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function savePositions(nodes) {
  const out = {};
  nodes.forEach((n) => {
    if (Number.isFinite(n.x) && Number.isFinite(n.y)) out[n.id] = { x: n.x, y: n.y };
  });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
}

function formatUpdated(ts) {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  if (Number.isNaN(d.getTime())) return "";
  return `обновлено ${d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
}

function clearMapUi() {
  const svg = document.getElementById("map-svg");
  if (svg) svg.innerHTML = "";
  const datalist = document.getElementById("node-names");
  if (datalist) datalist.innerHTML = "";
  const chips = document.getElementById("project-chips");
  if (chips) chips.innerHTML = "";
  const portLegend = document.getElementById("port-legend");
  if (portLegend) portLegend.innerHTML = "";
  const coverage = document.getElementById("coverage-list");
  if (coverage) coverage.innerHTML = "";
}

async function fetchMapData(fresh = false) {
  const url = fresh ? "/containers_map?fresh=1" : "/containers_map";
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`containers_map ${res.status}`);
  return res.json();
}

async function drawMap(options = {}) {
  const { fresh = false, preserveNode = null } = options;
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

  if (mapController) {
    mapController.persist?.();
    mapController.destroy();
    mapController = null;
  }
  clearMapUi();

  const data = await fetchMapData(fresh);
  let nodes = data.nodes.slice();
  const links = data.links;
  const coverage = data.coverage || { without_connect_to: [], with_connect_to: 0, total: nodes.length };
  const topo = structureKey(data);

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
        compose_service: "",
        connect_to: "",
        ports: [],
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

  const covSummary = document.getElementById("coverage-summary");
  const covList = document.getElementById("coverage-list");
  if (covSummary) {
    const missing = (coverage.without_connect_to || []).length;
    covSummary.textContent = `${coverage.with_connect_to || 0}/${coverage.total || nodes.length} с лейблом · без: ${missing}`;
  }

  const updatedEl = document.getElementById("map-updated");
  if (updatedEl) updatedEl.textContent = formatUpdated(data.fetched_at);

  const svgEl = document.getElementById("map-svg");
  const canvas = svgEl.parentElement;
  const mapApp = document.querySelector(".map-app");
  const backdrop = document.getElementById("map-backdrop");
  let width = Math.max(canvas.clientWidth || 1200, 320);
  let height = Math.max(canvas.clientHeight || 800, 320);
  const selectedNodes = new Set();
  let zoomBehavior;
  let fittedOnce = false;
  let layoutReady = false;
  let destroyed = false;
  // Снимок фильтров до временного раскрытия при фокусе на узле
  let filterSnapshot = null;

  function isCompactMap() {
    return window.matchMedia("(max-width: 960px)").matches;
  }
  function syncPanelState() {
    if (!mapApp) return;
    mapApp.classList.toggle(
      "panel-open",
      mapApp.classList.contains("filters-open") || mapApp.classList.contains("drawer-open")
    );
    if (backdrop) {
      backdrop.hidden = !mapApp.classList.contains("panel-open");
    }
    const filtBtn = document.getElementById("btn-toggle-filters");
    if (filtBtn) {
      filtBtn.setAttribute(
        "aria-expanded",
        mapApp.classList.contains("filters-open") ? "true" : "false"
      );
    }
  }
  function openFilters() {
    if (!mapApp) return;
    mapApp.classList.add("filters-open");
    mapApp.classList.remove("drawer-open");
    syncPanelState();
  }
  function openDrawerPanel() {
    if (!mapApp || !isCompactMap()) return;
    mapApp.classList.add("drawer-open");
    mapApp.classList.remove("filters-open");
    syncPanelState();
  }
  function closePanels() {
    if (!mapApp) return;
    mapApp.classList.remove("filters-open", "drawer-open", "panel-open");
    syncPanelState();
  }

  let activeProject = "";
  const saved = loadSavedPositions();

  const projectNames = [
    ...new Set(nodes.map((n) => n.project).filter(Boolean)),
  ].sort();
  const projectCenters = {};
  const spread = Math.min(width, height) * 0.42;
  projectNames.forEach((p, i) => {
    const angle = (i / Math.max(projectNames.length, 1)) * Math.PI * 2;
    projectCenters[p] = {
      x: width / 2 + Math.cos(angle) * spread,
      y: height / 2 + Math.sin(angle) * spread * 0.88,
    };
  });
  projectCenters._none = { x: width / 2, y: height / 2 };
  projectCenters.external = {
    x: width / 2,
    y: height * 0.1,
  };

  let restoredCount = 0;
  nodes.forEach((n, i) => {
    if (saved[n.id] && Number.isFinite(saved[n.id].x) && Number.isFinite(saved[n.id].y)) {
      n.x = saved[n.id].x;
      n.y = saved[n.id].y;
      restoredCount += 1;
    } else {
      const key = n.state === "external" ? "external" : n.project || "_none";
      const c = projectCenters[key] || projectCenters._none;
      const angle = (i / Math.max(nodes.length, 1)) * Math.PI * 2;
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

  // Osmos-like: слабые пружины, сильное отталкивание, вязкая среда
  function clusterStrength() {
    return document.getElementById("flt-cluster").checked ? 0.12 : 0.015;
  }

  const simulation = d3
    .forceSimulation(nodes)
    .force(
      "link",
      d3
        .forceLink(links)
        .id((d) => d.id)
        .distance(260)
        .strength(0.12)
    )
    .force(
      "charge",
      d3
        .forceManyBody()
        .strength(-920)
        .distanceMin(40)
        .distanceMax(720)
    )
    .force("collide", d3.forceCollide().radius(72).strength(0.45).iterations(2))
    .force("centerX", d3.forceX(width / 2).strength(0.018))
    .force("centerY", d3.forceY(height / 2).strength(0.018))
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
    .velocityDecay(0.55)
    .alphaDecay(0.012)
    .alphaMin(0.0008);

  // Если раскладка уже сохранена — не взрывать граф с alpha=1
  if (restoredCount >= Math.max(3, nodes.length * 0.35)) {
    simulation.alpha(0.04);
  }

  const link = g
    .append("g")
    .selectAll("line")
    .data(links)
    .join("line")
    .attr("class", "link-line")
    .attr("stroke", (d) => portColors[parseInt(d.target_port, 10)] || "#9aa6b5")
    .attr("stroke-width", 1.25)
    .attr("stroke-opacity", 0.55);

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
        .attr("fill", "#ffffff")
        .attr("stroke", portColors[parseInt(d.target_port, 10)] || "#9aa6b5");
      d3.select(this)
        .append("text")
        .attr("text-anchor", "middle")
        .attr("dy", "0.35em")
        .style("font-size", "11px")
        .style("fill", "#1c2430")
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
    .attr("fill", "#9aa6b5");
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
      if (selectedNodes.has(d) && selectedNodes.size === 1) {
        resetHighlight(true);
        return;
      }
      selectedNodes.clear();
      selectedNodes.add(d);
      highlightConnections();
      showDrawer(d);
      setNodeQuery(d.name);
    });

  node.append("title").text((d) => d.name);

  node
    .append("circle")
    .attr("class", "node-circle")
    .attr("r", (d) => (d.state === "external" ? 18 : 22))
    .attr("fill", nodeColor)
    .attr("stroke", (d) => (d.state === "external" ? "#2f6fed" : "#c8d0dc"))
    .attr("stroke-width", (d) => (d.state === "external" ? 2 : 1.25))
    .attr("stroke-dasharray", (d) => (d.state === "external" ? "4 3" : null));

  const label = node.append("g").attr("class", "node-label").attr("transform", "translate(0,34)");
  label
    .append("rect")
    .attr("rx", 7)
    .attr("fill", "rgba(255,255,255,0.92)")
    .attr("stroke", "#dde3ec");
  label
    .append("text")
    .attr("text-anchor", "middle")
    .attr("dy", "0.35em")
    .style("fill", "#1c2430")
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
    if (destroyed) return;
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

  function unpinLayout() {
    nodes.forEach((n) => {
      n.fx = null;
      n.fy = null;
    });
  }

  function reheat(alpha = 0.2) {
    unpinLayout();
    simulation.alpha(Math.min(alpha, 0.35)).restart();
  }

  simulation.on("end", () => {
    if (destroyed) return;
    // Не фиксируем fx/fy — иначе граф «замирает» и не расправляется
    persistPositions();
    layoutReady = true;
    if (!fittedOnce) {
      fittedOnce = true;
      fitToScreen(true);
      focusFromQuery(preserveNode);
    }
  });

  function nodeColor(d) {
    if (d.state === "running") return "#5ecf8a";
    if (d.state === "created") return "#e6a23c";
    if (d.state === "exited" || d.state === "stopped" || d.state === "dead") return "#667384";
    if (d.state === "external") return "#dbe7ff";
    return "#c5ced9";
  }

  function truncate(s, n) {
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }

  function persistPositions() {
    savePositions(nodes);
  }

  function fitToScreen(animate = true) {
    const shown = nodes.filter((n) => {
      const el = node.filter((d) => d.id === n.id).node();
      return el && getComputedStyle(el).display !== "none";
    });
    const pool = shown.length ? shown : nodes;
    fitToNodes(pool, animate);
  }

  function focusNode(d) {
    const scale = 1.25;
    const t = d3.zoomIdentity
      .translate(width / 2, height / 2)
      .scale(scale)
      .translate(-d.x, -d.y);
    svg.transition().duration(500).ease(d3.easeCubicOut).call(zoomBehavior.transform, t);
  }

  function beginSelectionFocus(d, { zoom = true } = {}) {
    const linkedEl = document.getElementById("flt-linked-only");
    const searchEl = document.getElementById("search-box");
    if (!filterSnapshot) {
      filterSnapshot = {
        linkedOnly: linkedEl.checked,
        search: searchEl.value,
      };
    }
    // Временно показать узел и соседей, не ломая исходные чекбоксы навсегда
    if (linkedEl.checked && !linkedIds.has(d.id)) {
      linkedEl.checked = false;
    }
    selectedNodes.clear();
    selectedNodes.add(d);
    applyFilters();
    highlightConnections();
    showDrawer(d);
    if (zoom) focusNode(d);
    setNodeQuery(d.name);
  }

  function selectAndShow(d) {
    beginSelectionFocus(d, { zoom: true });
  }

  function setNodeQuery(name) {
    const url = new URL(window.location.href);
    if (name) url.searchParams.set("node", name);
    else url.searchParams.delete("node");
    window.history.replaceState({}, "", url);
  }

  function focusFromQuery(forcedName) {
    const params = new URLSearchParams(window.location.search);
    const q = (forcedName || params.get("node") || "").trim().toLowerCase();
    if (!q) return;
    const match =
      nodes.find((n) => n.name.toLowerCase() === q) ||
      nodes.find((n) => n.name.toLowerCase().includes(q));
    if (match) selectAndShow(match);
  }

  function selectionNeighborhood() {
    const ids = new Set();
    selectedNodes.forEach((sel) => {
      ids.add(sel.id);
      links.forEach((link) => {
        const s = link.source.id ?? link.source;
        const t = link.target.id ?? link.target;
        if (s === sel.id) ids.add(t);
        if (t === sel.id) ids.add(s);
      });
    });
    return ids;
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
      <div><dt>compose service</dt><dd>${escapeHtml(d.compose_service || "—")}</dd></div>
      <div><dt>Порты</dt><dd>${escapeHtml(ports)}</dd></div>
      <div><dt>connect_to</dt><dd>${escapeHtml(d.connect_to || "—")}</dd></div>
    `;
    openDrawerPanel();
  }

  function clearDrawer() {
    document.getElementById("drawer-empty").hidden = false;
    document.getElementById("drawer-body").hidden = true;
    closePanels();
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  function highlightConnections() {
    if (!selectedNodes.size) {
      node.selectAll("circle").attr("opacity", 1);
      link
        .attr("stroke", (d) => portColors[parseInt(d.target_port, 10)] || "#666")
        .attr("opacity", 1);
      linkLabels.style("visibility", "hidden");
      return;
    }

    const connectedLinks = new Set();
    const connectedNodes = new Set();
    selectedNodes.forEach((selected) => {
      connectedNodes.add(selected);
      links.forEach((link) => {
        if (link.source.id === selected.id || link.target.id === selected.id) {
          connectedLinks.add(link);
          connectedNodes.add(link.source);
          connectedNodes.add(link.target);
        }
      });
    });

    link
      .attr("stroke", (d) =>
        connectedLinks.has(d) ? portColors[parseInt(d.target_port, 10)] || "#666" : "#c8d0dc"
      )
      .attr("opacity", (d) => (connectedLinks.has(d) ? 1 : 0.12));
    linkLabels.style("visibility", (d) => (connectedLinks.has(d) ? "visible" : "hidden"));
    node
      .selectAll("circle")
      .attr("opacity", (d) => (connectedNodes.has(d) ? 1 : 0.15));
  }

  function resetHighlight(clearSearch = true) {
    selectedNodes.clear();
    node
      .selectAll("circle")
      .attr("opacity", 1)
      .attr("fill", nodeColor)
      .attr("stroke", (d) => (d.state === "external" ? "#2f6fed" : "#c8d0dc"))
      .attr("stroke-width", (d) => (d.state === "external" ? 2 : 1.25));
    link
      .attr("stroke", (d) => portColors[parseInt(d.target_port, 10)] || "#666")
      .attr("opacity", 1);
    linkLabels.style("visibility", "hidden");
    clearDrawer();

    if (filterSnapshot) {
      document.getElementById("flt-linked-only").checked = filterSnapshot.linkedOnly;
      if (clearSearch) {
        document.getElementById("search-box").value = filterSnapshot.search || "";
      }
      filterSnapshot = null;
    } else if (clearSearch) {
      document.getElementById("search-box").value = "";
    }
    if (clearSearch) setNodeQuery("");

    applyFilters({ refit: clearSearch });
    if (clearSearch && layoutReady) fitToScreen(true);
  }

  function applyFilters({ refit = false } = {}) {
    const q = document.getElementById("search-box").value.trim().toLowerCase();
    const showRunning = document.getElementById("flt-running").checked;
    const showStopped = document.getElementById("flt-stopped").checked;
    const showExternal = document.getElementById("flt-external").checked;
    const linkedOnly = document.getElementById("flt-linked-only").checked;
    const prefix = document.getElementById("flt-prefix").value.trim().toLowerCase();
    const keepIds = selectedNodes.size ? selectionNeighborhood() : null;

    const visible = new Set();
    nodes.forEach((d) => {
      if (keepIds && keepIds.has(d.id)) {
        visible.add(d.id);
        return;
      }
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
      // Поиск подсвечивает, но не прячет остальных — иначе ломается подсветка связей
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

    if (q && !selectedNodes.size) {
      const matches = visibleNodes.filter((d) => d.name.toLowerCase().includes(q));
      node
        .selectAll("circle")
        .attr("stroke", (d) =>
          matches.includes(d) ? "#c94444" : d.state === "external" ? "#2f6fed" : "#c8d0dc"
        )
        .attr("stroke-width", (d) => (matches.includes(d) ? 3 : d.state === "external" ? 2 : 1.25));
      if (matches.length === 1) {
        beginSelectionFocus(matches[0], { zoom: true });
      } else if (matches.length > 1 && refit) {
        fitToNodes(matches, true);
      }
    } else if (!selectedNodes.size) {
      node
        .selectAll("circle")
        .attr("stroke", (d) => (d.state === "external" ? "#2f6fed" : "#c8d0dc"))
        .attr("stroke-width", (d) => (d.state === "external" ? 2 : 1.25));
      if (refit && layoutReady && visibleNodes.length) {
        fitToNodes(visibleNodes, true);
      }
    } else {
      highlightConnections();
    }
  }

  function updateClusterForce() {
    simulation.force("x").strength(clusterStrength);
    simulation.force("y").strength(clusterStrength);
    fittedOnce = false;
    reheat(0.22);
  }

  function fitToNodes(subset, animate = true) {
    const xs = subset.map((n) => n.x).filter(Number.isFinite);
    const ys = subset.map((n) => n.y).filter(Number.isFinite);
    if (!xs.length) return;
    const minX = Math.min(...xs) - 70;
    const maxX = Math.max(...xs) + 70;
    const minY = Math.min(...ys) - 70;
    const maxY = Math.max(...ys) + 70;
    const bw = Math.max(maxX - minX, 100);
    const bh = Math.max(maxY - minY, 100);
    const scale = Math.min((width - 80) / bw, (height - 80) / bh, 2.2) * 0.88;
    const tx = width / 2 - (scale * (minX + maxX)) / 2;
    const ty = height / 2 - (scale * (minY + maxY)) / 2;
    const t = d3.zoomIdentity.translate(tx, ty).scale(scale);
    svg.interrupt();
    const sel = animate ? svg.transition().duration(550).ease(d3.easeCubicOut) : svg;
    sel.call(zoomBehavior.transform, t);
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  function drag(sim) {
    return d3
      .drag()
      .on("start", (event) => {
        if (!event.active) sim.alphaTarget(0.06).restart();
        event.subject.fx = event.subject.x;
        event.subject.fy = event.subject.y;
      })
      .on("drag", (event) => {
        event.subject.fx = event.x;
        event.subject.fy = event.y;
      })
      .on("end", (event) => {
        event.subject.fx = null;
        event.subject.fy = null;
        if (!event.active) sim.alphaTarget(0);
        // Мягкий «выдох» после отпускания — без рывка
        sim.alpha(Math.max(sim.alpha(), 0.08)).restart();
        persistPositions();
      });
  }

  if (covList) {
    (coverage.without_connect_to || []).forEach((item) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "coverage-item";
      btn.innerHTML = `${escapeHtml(item.name)}${
        item.project ? `<small>${escapeHtml(item.project)}</small>` : ""
      }`;
      btn.addEventListener("click", () => {
        const n = nodes.find((x) => x.id === item.id || x.name === item.name);
        if (!n) return;
        selectAndShow(n);
      });
      covList.appendChild(btn);
    });
  }

  const chips = document.getElementById("project-chips");
  function setProjectFilter(project) {
    activeProject = project;
    [...chips.querySelectorAll(".project-chip")].forEach((el) => {
      const isAll = el.textContent === "все";
      el.classList.toggle("active", isAll ? !project : el.textContent === project);
    });
    applyFilters({ refit: true });
    fittedOnce = false;
    reheat(0.2);
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

  const debouncedSearch = debounce(() => applyFilters({ refit: true }), 200);
  const debouncedPrefix = debounce(() => applyFilters({ refit: true }), 200);

  function resizeMap() {
    const nextW = Math.max(canvas.clientWidth || 320, 280);
    const nextH = Math.max(canvas.clientHeight || 320, 280);
    if (Math.abs(nextW - width) < 2 && Math.abs(nextH - height) < 2) {
      fitToScreen(false);
      return;
    }
    width = nextW;
    height = nextH;
    svg.attr("viewBox", `0 0 ${width} ${height}`);
    simulation.force("centerX", d3.forceX(width / 2).strength(0.018));
    simulation.force("centerY", d3.forceY(height / 2).strength(0.018));
    const rSpread = Math.min(width, height) * 0.42;
    Object.keys(projectCenters).forEach((key, i, arr) => {
      if (key === "_none") {
        projectCenters[key] = { x: width / 2, y: height / 2 };
      } else if (key === "external") {
        projectCenters[key] = { x: width / 2, y: height * 0.1 };
      } else {
        const angle = (i / Math.max(arr.length, 1)) * Math.PI * 2;
        projectCenters[key] = {
          x: width / 2 + Math.cos(angle) * rSpread,
          y: height / 2 + Math.sin(angle) * rSpread * 0.88,
        };
      }
    });
    fitToScreen(false);
  }
  const debouncedResize = debounce(resizeMap, 180);

  const listeners = [];
  function on(el, ev, fn) {
    if (!el) return;
    el.addEventListener(ev, fn);
    listeners.push([el, ev, fn]);
  }

  on(document.getElementById("search-box"), "input", debouncedSearch);
  on(document.getElementById("flt-running"), "change", () => applyFilters());
  on(document.getElementById("flt-stopped"), "change", () => applyFilters());
  on(document.getElementById("flt-external"), "change", () => applyFilters());
  on(document.getElementById("flt-linked-only"), "change", () => applyFilters({ refit: true }));
  on(document.getElementById("flt-cluster"), "change", updateClusterForce);
  on(document.getElementById("flt-prefix"), "input", debouncedPrefix);
  on(document.getElementById("btn-fit"), "click", () => fitToScreen(true));
  on(document.getElementById("btn-zoom-in"), "click", () => {
    svg.interrupt();
    svg.transition().duration(220).ease(d3.easeCubicOut).call(zoomBehavior.scaleBy, 1.2);
  });
  on(document.getElementById("btn-zoom-out"), "click", () => {
    svg.interrupt();
    svg.transition().duration(220).ease(d3.easeCubicOut).call(zoomBehavior.scaleBy, 0.84);
  });
  on(document.getElementById("btn-reset"), "click", () => {
    localStorage.removeItem(STORAGE_KEY);
    fittedOnce = false;
    reheat(0.3);
    resetHighlight(true);
  });
  on(document.getElementById("btn-refresh"), "click", () => {
    persistPositions();
    softPoll({ forceFresh: true, allowRebuild: true });
  });

  const filtToggle = document.getElementById("btn-toggle-filters");
  on(filtToggle, "click", () => {
    if (!mapApp) return;
    if (mapApp.classList.contains("filters-open")) closePanels();
    else openFilters();
  });
  document.querySelectorAll("[data-close-panel]").forEach((btn) => {
    on(btn, "click", () => closePanels());
  });
  on(backdrop, "click", () => closePanels());

  function onKey(e) {
    if (e.key === "Escape") {
      // Сначала полный сброс выделения (иначе на mobile Esc только закрывал панель)
      if (selectedNodes.size) {
        resetHighlight(true);
        return;
      }
      if (mapApp && mapApp.classList.contains("panel-open")) {
        closePanels();
      }
    }
  }
  on(window, "keydown", onKey);
  on(window, "resize", debouncedResize);
  if (window.visualViewport) {
    on(window.visualViewport, "resize", debouncedResize);
  }

  applyFilters();

  function applyLiveUpdate(data) {
    const byId = new Map((data.nodes || []).map((n) => [n.id, n]));
    nodes.forEach((n) => {
      if (n.state === "external") return;
      const u = byId.get(n.id);
      if (!u) return;
      n.state = u.state;
      n.status = u.status;
      n.image = u.image;
      n.connect_to = u.connect_to;
      n.ports = u.ports;
      n.project = u.project;
      n.compose_service = u.compose_service;
      n.host = u.host;
    });
    node.selectAll("circle").attr("fill", nodeColor);
    node.select("title").text((d) => d.name);

    const cov = data.coverage || {};
    const covSummary = document.getElementById("coverage-summary");
    if (covSummary) {
      const missing = (cov.without_connect_to || []).length;
      covSummary.textContent = `${cov.with_connect_to || 0}/${cov.total || nodes.length} с лейблом · без: ${missing}`;
    }
    const updatedEl = document.getElementById("map-updated");
    if (updatedEl) updatedEl.textContent = formatUpdated(data.fetched_at);
    applyFilters();
  }

  mapController = {
    structureKey: topo,
    persist: persistPositions,
    applyLiveUpdate,
    destroy() {
      destroyed = true;
      persistPositions();
      simulation.stop();
      listeners.forEach(([el, ev, fn]) => el.removeEventListener(ev, fn));
    },
  };
}

async function softPoll({ forceFresh = false, allowRebuild = false } = {}) {
  try {
    if (mapController?.persist) mapController.persist();
    const data = await fetchMapData(forceFresh);
    const updatedEl = document.getElementById("map-updated");
    if (updatedEl) updatedEl.textContent = formatUpdated(data.fetched_at);
    if (!mapController) return;

    const next = structureKey(data);
    if (next === mapController.structureKey) {
      mapController.applyLiveUpdate?.(data);
      return;
    }
    // Структура изменилась — пересобираем, позиции уже в localStorage
    if (!allowRebuild && !forceFresh) {
      // На обычном poll тоже пересоберём, но со сохранённой раскладкой
    }
    const keep = new URLSearchParams(window.location.search).get("node");
    await drawMap({ fresh: forceFresh, preserveNode: keep });
  } catch (e) {
    console.warn("cmap poll failed", e);
  }
}

drawMap().then(() => {
  setInterval(() => softPoll(), POLL_MS);
  window.addEventListener("beforeunload", () => mapController?.persist?.());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") mapController?.persist?.();
  });
});
