const POLL_MS = 20000;
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

function formatUpdated(ts) {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  if (Number.isNaN(d.getTime())) return "";
  const time = d.toLocaleTimeString(typeof localeTag === "function" ? localeTag() : "en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return typeof t === "function" ? t("map.updated", { time }) : `updated ${time}`;
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
  const strip = document.getElementById("route-strip");
  if (strip) strip.hidden = true;
  const stripInner = document.getElementById("route-strip-inner");
  if (stripInner) stripInner.innerHTML = "";
  const stripLabel = document.getElementById("route-strip-label");
  if (stripLabel) stripLabel.textContent = "";
  document.querySelector(".map-app")?.classList.remove("has-route");
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
    covSummary.textContent = t("map.coverage_summary", {
      with_label: coverage.with_connect_to || 0,
      total: coverage.total || nodes.length,
      missing,
    });
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
  let layoutReady = false;
  // Снимок фильтров до временного раскрытия при фокусе на узле
  let filterSnapshot = null;

  function syncPanelState() {
    if (!mapApp) return;
    const filtersOpen = mapApp.classList.contains("filters-open");
    const drawerOpen = mapApp.classList.contains("drawer-open");
    mapApp.classList.toggle("panel-open", filtersOpen || drawerOpen);
    if (backdrop) {
      backdrop.hidden = !mapApp.classList.contains("panel-open");
    }
    const side = document.getElementById("map-side");
    const drawerEl = document.getElementById("drawer");
    // Закрытые шторки не в фокусе/a11y-дереве
    if (side) side.inert = !filtersOpen;
    if (drawerEl) drawerEl.inert = !drawerOpen;
    const filtBtn = document.getElementById("btn-toggle-filters");
    if (filtBtn) {
      filtBtn.setAttribute("aria-expanded", filtersOpen ? "true" : "false");
    }
    const drawerBtn = document.getElementById("btn-toggle-drawer");
    if (drawerBtn) {
      drawerBtn.setAttribute("aria-expanded", drawerOpen ? "true" : "false");
      drawerBtn.classList.toggle("has-selection", selectedNodes.size > 0);
    }
  }
  function openFilters() {
    if (!mapApp) return;
    mapApp.classList.add("filters-open");
    mapApp.classList.remove("drawer-open");
    syncPanelState();
  }
  function openDrawerPanel() {
    if (!mapApp) return;
    mapApp.classList.add("drawer-open");
    mapApp.classList.remove("filters-open");
    syncPanelState();
  }
  function closePanels() {
    if (!mapApp) return;
    mapApp.classList.remove("filters-open", "drawer-open", "panel-open");
    syncPanelState();
  }
  function updateDrawerButton() {
    const drawerBtn = document.getElementById("btn-toggle-drawer");
    if (!drawerBtn) return;
    drawerBtn.classList.toggle("has-selection", selectedNodes.size > 0);
    const sel = selectedNodes.size ? [...selectedNodes] : [];
    if (!sel.length) drawerBtn.title = t("map.node_card");
    else if (sel.length === 1) drawerBtn.title = t("map.node_named", { name: sel[0].name });
    else drawerBtn.title = t("map.node_named", { name: `${sel.length}` });
  }

  let selectionAnchor = null;
  /** Упорядоченный маршрут (два клика / path) — для линейки и яркой подсветки. */
  let routePath = null;

  /** Кратчайший путь по связям connect_to (без учёта направления). */
  function shortestPath(start, end) {
    if (!start || !end) return null;
    if (start.id === end.id) return [start];
    const adj = new Map();
    nodes.forEach((n) => adj.set(n.id, []));
    links.forEach((l) => {
      const s = l.source;
      const t = l.target;
      if (!adj.has(s.id) || !adj.has(t.id)) return;
      adj.get(s.id).push(t);
      adj.get(t.id).push(s);
    });
    const prev = new Map([[start.id, null]]);
    const queue = [start];
    for (let i = 0; i < queue.length; i++) {
      const cur = queue[i];
      if (cur.id === end.id) break;
      for (const nb of adj.get(cur.id) || []) {
        if (prev.has(nb.id)) continue;
        prev.set(nb.id, cur);
        queue.push(nb);
      }
    }
    if (!prev.has(end.id)) return null;
    const path = [];
    for (let cur = end; cur; cur = prev.get(cur.id)) path.push(cur);
    path.reverse();
    return path;
  }

  function showRouteStats(path) {
    const stats = document.getElementById("map-stats");
    if (!stats || !path || path.length < 2) return;
    stats.textContent = t("map.route", {
      from: path[0].name,
      to: path[path.length - 1].name,
      hops: path.length - 1,
    });
  }

  function clearRouteStrip() {
    routePath = null;
    const strip = document.getElementById("route-strip");
    const inner = document.getElementById("route-strip-inner");
    const label = document.getElementById("route-strip-label");
    if (strip) strip.hidden = true;
    if (inner) inner.innerHTML = "";
    if (label) label.textContent = "";
    if (mapApp) mapApp.classList.remove("has-route");
  }

  function renderRouteStrip(path) {
    const strip = document.getElementById("route-strip");
    const inner = document.getElementById("route-strip-inner");
    const label = document.getElementById("route-strip-label");
    if (!strip || !inner) return;
    if (!path || path.length < 2) {
      clearRouteStrip();
      return;
    }
    routePath = path.slice();
    strip.hidden = false;
    if (mapApp) mapApp.classList.add("has-route");
    if (label) label.textContent = t("map.route_bar");
    inner.innerHTML = "";
    path.forEach((n, i) => {
      if (i) {
        const sep = document.createElement("span");
        sep.className = "route-sep";
        sep.setAttribute("aria-hidden", "true");
        sep.textContent = "→";
        inner.appendChild(sep);
      }
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "route-chip" + (i === 0 || i === path.length - 1 ? " is-end" : "");
      btn.title = n.name;
      const dot = document.createElement("span");
      dot.className = "route-dot";
      dot.style.background = nodeColor(n);
      dot.textContent = String(i + 1);
      const text = document.createElement("span");
      text.className = "route-chip-label";
      text.textContent = innerLabel(n);
      btn.append(dot, text);
      btn.addEventListener("click", () => {
        fillDrawer(n);
        updateDrawerButton();
        openDrawerPanel();
      });
      inner.appendChild(btn);
    });
  }

  function applyPathSelection(path, focusNode) {
    selectedNodes.clear();
    path.forEach((n) => selectedNodes.add(n));
    selectionAnchor = path[0];
    renderRouteStrip(path);
    highlightConnections();
    fillDrawer(focusNode);
    setNodeQuery(focusNode.name);
    updateDrawerButton();
    showRouteStats(path);
    // Подгоняем кадр только для длинного маршрута, не к одному узлу
    if (layoutReady && path.length > 2) fitToNodes(path, true);
  }

  let activeProject = "";

  const projectNames = [
    ...new Set(nodes.map((n) => n.project).filter(Boolean)),
  ].sort();

  const CARD_W = 168;
  const CARD_H = 46;

  // Глубина directed connect_to: корни слева, циклы не углубляют.
  const depthById = new Map();
  const outgoing = new Map();
  const indegree = new Map();
  nodes.forEach((n) => {
    outgoing.set(n.id, []);
    indegree.set(n.id, 0);
  });
  links.forEach((l) => {
    const s = l.source != null && typeof l.source === "object" ? l.source.id : l.source;
    const t = l.target != null && typeof l.target === "object" ? l.target.id : l.target;
    if (!outgoing.has(s) || !indegree.has(t)) return;
    outgoing.get(s).push(t);
    indegree.set(t, indegree.get(t) + 1);
  });

  function deepenFrom(startIds) {
    const queue = startIds.slice();
    for (let qi = 0; qi < queue.length; qi++) {
      const id = queue[qi];
      const nextDepth = depthById.get(id) + 1;
      const tos = outgoing.get(id) || [];
      for (let j = 0; j < tos.length; j++) {
        const to = tos[j];
        if (depthById.has(to)) continue;
        depthById.set(to, nextDepth);
        queue.push(to);
      }
    }
  }

  const roots = [];
  nodes.forEach((n) => {
    if ((indegree.get(n.id) || 0) === 0) {
      depthById.set(n.id, 0);
      roots.push(n.id);
    }
  });
  deepenFrom(roots);
  nodes.forEach((n) => {
    if (depthById.has(n.id)) return;
    depthById.set(n.id, 0);
    deepenFrom([n.id]);
  });

  const degreeById = new Map(nodes.map((n) => [n.id, 0]));
  links.forEach((l) => {
    const s = l.source != null && typeof l.source === "object" ? l.source.id : l.source;
    const t = l.target != null && typeof l.target === "object" ? l.target.id : l.target;
    degreeById.set(s, (degreeById.get(s) || 0) + 1);
    degreeById.set(t, (degreeById.get(t) || 0) + 1);
  });

  function endId(v) {
    return v != null && typeof v === "object" ? v.id : v;
  }
  function isHubLink(l) {
    return (degreeById.get(endId(l.source)) || 0) >= 8 || (degreeById.get(endId(l.target)) || 0) >= 8;
  }
  function linkStroke(d) {
    if (isHubLink(d)) return "#c5ced8";
    return portColors[parseInt(d.target_port, 10)] || "#9aa6b5";
  }
  function linkOpacity(d) {
    const from = d.source;
    const to = d.target;
    if (!from || !to || !Number.isFinite(from.y) || !Number.isFinite(to.y)) return 0.85;
    return edgeIsLocal(from, to) ? 0.9 : 0;
  }

  function anchorNode(n) {
    let best = null;
    let bestDeg = -1;
    links.forEach((l) => {
      const s = endId(l.source);
      const t = endId(l.target);
      const otherId = s === n.id ? t : t === n.id ? s : null;
      if (!otherId) return;
      const other = nodes.find((x) => x.id === otherId);
      if (!other) return;
      const deg = degreeById.get(other.id) || 0;
      if (deg > bestDeg) {
        bestDeg = deg;
        best = other;
      }
    });
    return best;
  }

  function projectKey(n) {
    if (n.state === "external") {
      const a = anchorNode(n);
      if (a && a.state !== "external") return a.project || a.name || "external";
      return "external";
    }
    return n.project || n.name || "";
  }

  function nodeDepth(n) {
    if (n.state === "external") {
      const a = anchorNode(n);
      if (a) return (depthById.get(a.id) || 0) + 1;
    }
    return depthById.get(n.id) || 0;
  }

  /** Плитки проектов в несколько колонок, чтобы карта помещалась и не резала чужие связи. */
  function placeGraph(clustered) {
    const row = CARD_H + 16;
    const gapY = 32;
    const gapX = 56;
    const colW = width < 720 ? 186 : 214;
    const x0 = 28 + CARD_W / 2;
    const usable = Math.max(width - 56, CARD_W + 24);
    if (!clustered) {
      const columns = new Map();
      nodes.forEach((n) => {
        const d = nodeDepth(n);
        if (!columns.has(d)) columns.set(d, []);
        columns.get(d).push(n);
      });
      columns.forEach((group, depth) => {
        group.sort(
          (a, b) =>
            String(projectKey(a)).localeCompare(String(projectKey(b))) ||
            String(a.name).localeCompare(String(b.name))
        );
        group.forEach((n, i) => {
          n.x = x0 + depth * colW;
          n.y = 48 + i * row;
        });
      });
      return;
    }
    const byProject = new Map();
    nodes.forEach((n) => {
      const key = projectKey(n);
      if (!byProject.has(key)) byProject.set(key, []);
      byProject.get(key).push(n);
    });
    const tiles = [...byProject.keys()].sort((a, b) => a.localeCompare(b)).map((key) => {
      const columns = new Map();
      byProject.get(key).forEach((n) => {
        const d = nodeDepth(n);
        if (!columns.has(d)) columns.set(d, []);
        columns.get(d).push(n);
      });
      let rows = 1;
      let maxD = 0;
      columns.forEach((arr, d) => {
        arr.sort((a, b) => String(a.name).localeCompare(String(b.name)));
        rows = Math.max(rows, arr.length);
        maxD = Math.max(maxD, d);
      });
      return { columns, rows, maxD, w: CARD_W + maxD * colW, h: rows * row };
    });
    let cursorX = 0;
    let cursorY = 40;
    let rowMax = 0;
    tiles.forEach((tile) => {
      if (cursorX > 0 && cursorX + tile.w > usable) {
        cursorX = 0;
        cursorY += rowMax + gapY;
        rowMax = 0;
      }
      tile.columns.forEach((arr, depth) => {
        arr.forEach((n, i) => {
          n.x = x0 + cursorX + depth * colW;
          n.y = cursorY + i * row;
        });
      });
      cursorX += tile.w + gapX;
      rowMax = Math.max(rowMax, tile.h);
    });
  }

  placeGraph(document.getElementById("flt-cluster").checked);

  const svg = d3.select(svgEl).attr("viewBox", `0 0 ${width} ${height}`);
  const g = svg.append("g");
  // Прозрачный фон под графом: клик = сброс выделения
  const hitbox = g
    .append("rect")
    .attr("class", "map-hitbox")
    .attr("width", width)
    .attr("height", height)
    .attr("fill", "transparent")
    .style("cursor", "default")
    .on("click", () => resetHighlight(true));

  zoomBehavior = d3
    .zoom()
    .scaleExtent([0.15, 4])
    .filter((event) => {
      // Не начинать pan со wheel+ctrl only; клики по узлам — как обычно
      if (event.type === "wheel") return true;
      return !event.button;
    })
    .on("zoom", (event) => {
      g.attr("transform", event.transform);
    });
  svg.call(zoomBehavior);

  // id связи → объект узла, чтобы дальше везде были source.x / target.y
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  links.forEach((l) => {
    if (typeof l.source !== "object") l.source = nodeById.get(l.source) || l.source;
    if (typeof l.target !== "object") l.target = nodeById.get(l.target) || l.target;
  });

  const link = g
    .append("g")
        .selectAll("path")
        .data(links)
        .join("path")
    .attr("class", "link-line")
    .attr("fill", "none")
    .attr("stroke", linkStroke)
    .attr("stroke-width", 1.35)
    .attr("stroke-opacity", 1)
    .attr("opacity", linkOpacity);

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
  function addArrowMarker(id, fill, refX = 9) {
    defs
      .append("marker")
      .attr("id", id)
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", refX)
      .attr("refY", 0)
      .attr("markerWidth", 7)
      .attr("markerHeight", 7)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", fill);
  }
  addArrowMarker("arrow", "#9aa6b5", 9);
  addArrowMarker("arrow-route", "#e11d48", 9);
  link.attr("marker-end", (d) => (linkOpacity(d) === 0 ? null : "url(#arrow)"));
  /** Направление ребра маршрута: link → {from, to} */
  let routeLinkDir = new Map();

  function edgeEnds(from, to) {
    const ltr = from.x <= to.x;
    return {
      x1: from.x + (ltr ? CARD_W / 2 : -CARD_W / 2),
      y1: from.y,
      x2: to.x + (ltr ? -CARD_W / 2 : CARD_W / 2),
      y2: to.y,
    };
  }
  function edgeIsLocal(from, to) {
    const a = projectKey(from);
    const b = projectKey(to);
    if (a && a === b) return true;
    return Math.abs((from.y || 0) - (to.y || 0)) <= CARD_H + 24;
  }
  function busY() {
    let min = Infinity;
    nodes.forEach((n) => {
      if (Number.isFinite(n.y)) min = Math.min(min, n.y);
    });
    return (Number.isFinite(min) ? min : 0) - CARD_H / 2 - 36;
  }
  function edgePath(from, to) {
    const { x1, y1, x2, y2 } = edgeEnds(from, to);
    const out = x1 <= x2 ? 1 : -1;
    const dx = Math.max(40, Math.abs(x2 - x1) * 0.45);
    if (edgeIsLocal(from, to)) {
      const c1x = x1 + out * dx;
      const c2x = x2 - out * dx;
      return `M${x1},${y1}C${c1x},${y1} ${c2x},${y2} ${x2},${y2}`;
    }
    // Дальняя связь (к traefik и обратно): из бока карточки, плавная дуга над картой, вход в бок.
    const yb = busY();
    const midX = (x1 + x2) / 2;
    const shoulder = 32;
    return `M${x1},${y1}C${x1 + out * shoulder},${y1} ${x1 + out * shoulder},${yb} ${midX},${yb}C${x2 - out * shoulder},${yb} ${x2 - out * shoulder},${y2} ${x2},${y2}`;
  }
  function edgeMid(from, to) {
    const { x1, y1, x2, y2 } = edgeEnds(from, to);
    if (!edgeIsLocal(from, to)) return { x: (x1 + x2) / 2, y: busY() };
    const out = x1 <= x2 ? 1 : -1;
    const dx = Math.max(40, Math.abs(x2 - x1) * 0.45);
    const c1x = x1 + out * dx;
    const c2x = x2 - out * dx;
    return {
      x: 0.125 * x1 + 0.375 * c1x + 0.375 * c2x + 0.125 * x2,
      y: (y1 + y2) / 2,
    };
  }

  const node = g
    .append("g")
        .selectAll("g")
        .data(nodes)
        .join("g")
        .attr("class", "node")
    .style("cursor", "pointer")
        .call(drag())
        .on("click", (event, d) => {
      event.stopPropagation();
      if (selectedNodes.has(d)) {
        if (selectedNodes.size === 1) {
          resetHighlight(true);
          return;
        }
        selectedNodes.delete(d);
        clearRouteStrip();
        if (!selectedNodes.has(selectionAnchor)) {
          selectionAnchor = selectedNodes.size ? [...selectedNodes][0] : null;
        }
        highlightConnections();
        fillDrawer(d);
        setNodeQuery(d.name);
        updateDrawerButton();
        return;
      }

      // Второй узел (в т.ч. на другом конце карты) → кратчайший маршрут
      if (selectionAnchor && selectedNodes.size && selectionAnchor.id !== d.id) {
        const path = shortestPath(selectionAnchor, d);
        if (path && path.length > 1) {
          applyPathSelection(path, d);
          return;
        }
      }

      clearRouteStrip();
      selectedNodes.clear();
      selectedNodes.add(d);
      selectionAnchor = d;
      highlightConnections();
      fillDrawer(d);
      setNodeQuery(d.name);
      updateDrawerButton();
    })
    .on("dblclick", (event, d) => {
      event.stopPropagation();
      if (selectionAnchor && selectionAnchor.id !== d.id) {
        const path = shortestPath(selectionAnchor, d);
        if (path && path.length > 1) {
          applyPathSelection(path, d);
          openDrawerPanel();
          return;
        }
      }
      clearRouteStrip();
      selectedNodes.clear();
      selectedNodes.add(d);
      selectionAnchor = d;
      highlightConnections();
      fillDrawer(d);
      setNodeQuery(d.name);
      updateDrawerButton();
      openDrawerPanel();
    });

  node.append("title").text((d) => d.name);

  node
    .append("rect")
    .attr("class", "node-card")
    .attr("x", -CARD_W / 2)
    .attr("y", -CARD_H / 2)
    .attr("width", CARD_W)
    .attr("height", CARD_H)
    .attr("rx", 10)
    .attr("ry", 10)
    .attr("fill", "#ffffff")
    .attr("stroke", defaultNodeStroke)
    .attr("stroke-width", defaultNodeStrokeWidth)
    .attr("stroke-dasharray", (d) => (d.state === "external" ? "4 3" : null));

  node
    .append("circle")
    .attr("class", "node-dot")
    .attr("cx", -CARD_W / 2 + 18)
    .attr("cy", 0)
    .attr("r", 8)
    .attr("fill", nodeColor)
    .attr("pointer-events", "none");

  node
    .append("text")
    .attr("class", "node-kind")
    .attr("x", -CARD_W / 2 + 34)
    .attr("y", -6)
    .attr("text-anchor", "start")
    .attr("font-size", "10px")
    .attr("fill", "#64748b")
    .attr("pointer-events", "none")
    .text(nodeKindText);

  node
    .append("text")
    .attr("class", "node-name")
    .attr("x", -CARD_W / 2 + 34)
    .attr("y", 12)
    .attr("text-anchor", "start")
    .attr("font-size", "13px")
    .attr("font-weight", 700)
    .attr("fill", nodeNameFill)
    .attr("pointer-events", "none")
    .text((d) => truncate(displayName(d), 16));

  function redrawEdges() {
    function ends(d) {
      const dir = routeLinkDir.get(d);
      if (dir) return { from: dir.from, to: dir.to };
      return { from: d.source, to: d.target };
    }
    link.attr("d", (d) => {
      const { from, to } = ends(d);
      return edgePath(from, to);
    });
    linkLabels.attr("transform", (d) => {
      const { from, to } = ends(d);
      const mid = edgeMid(from, to);
      return `translate(${mid.x},${mid.y})`;
    });
  }

  function paintPositions() {
    redrawEdges();
    node.attr("transform", (d) => `translate(${d.x},${d.y})`);
  }
  paintPositions();

  function serviceKey(d) {
    return String(d.compose_service || d.name || d.project || d.id || "node");
  }

  /** Стабильный цвет сервиса — разнообразие вместо «всё зелёное». */
  function serviceColor(key) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < key.length; i++) {
      h ^= key.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    const hue = h % 360;
    const sat = 58 + (h % 16);
    const light = 40 + ((h >>> 9) % 8); // темнее — белый текст читается
    return `hsl(${hue} ${sat}% ${light}%)`;
  }

  function nodeColor(d) {
    if (d.state === "external") return "#dbe7ff";
    if (d.state === "created") return "#e6a23c";
    if (d.state === "exited" || d.state === "stopped" || d.state === "dead") return "#8b95a5";
    return serviceColor(serviceKey(d));
  }

  function nodeKindText(d) {
    return d.state === "external" ? "external" : d.project || d.state || "service";
  }

  function nodeNameFill(d) {
    if (d.state === "stopped" || d.state === "exited" || d.state === "dead") return "#4b5563";
    return "#1c2430";
  }

  function defaultNodeStroke(d) {
    return d.state === "external" ? "#2f6fed" : "rgba(28,36,48,0.22)";
  }

  function defaultNodeStrokeWidth(d) {
    return d.state === "external" ? 2 : 1.25;
  }

  function displayName(d) {
    const raw = String(d.name || "");
    const proj = (d.project || "").toLowerCase();
    let name = raw;
    if (proj && name.toLowerCase().startsWith(proj + "-")) {
      name = name.slice(proj.length + 1);
    }
    if (proj && name.toLowerCase().startsWith(proj + "_")) {
      name = name.slice(proj.length + 1);
    }
    return name;
  }

  function innerLabel(d) {
    return truncate(displayName(d), 10);
  }

  function truncate(s, n) {
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }

  function fitToScreen(animate = true) {
    const shown = nodes.filter((n) => {
      const el = node.filter((d) => d.id === n.id).node();
      return el && getComputedStyle(el).display !== "none";
    });
    const pool = shown.length ? shown : nodes;
    fitToNodes(pool, animate);
  }

  function beginSelectionFocus(d) {
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
    clearRouteStrip();
    selectedNodes.clear();
    selectedNodes.add(d);
    selectionAnchor = d;
    applyFilters();
    highlightConnections();
    fillDrawer(d);
    updateDrawerButton();
    // Не зумим к одному узлу — камера остаётся как есть
    setNodeQuery(d.name);
  }

  function selectAndShow(d) {
    beginSelectionFocus(d);
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

  function fillDrawer(d) {
    const empty = document.getElementById("drawer-empty");
    const body = document.getElementById("drawer-body");
    const clearBtn = document.getElementById("btn-clear-selection");
    empty.hidden = true;
    body.hidden = false;
    if (clearBtn) clearBtn.hidden = false;
    const ports =
      (d.ports || [])
        .map((p) => {
          if (p.public) return `${p.public}→${p.private}/${p.type || "tcp"}`;
          return `${p.private}/${p.type || "tcp"}`;
        })
        .join(", ") || "—";
    body.innerHTML = `
      <div><dt>${t("map.field.name")}</dt><dd>${escapeHtml(d.name)}</dd></div>
      <div><dt>${t("map.field.state")}</dt><dd>${escapeHtml(d.state || "—")}</dd></div>
      <div><dt>${t("map.field.status")}</dt><dd>${escapeHtml(d.status || "—")}</dd></div>
      <div><dt>${t("map.field.host")}</dt><dd>${escapeHtml(d.host || "—")}</dd></div>
      <div><dt>${t("map.field.image")}</dt><dd>${escapeHtml(d.image || "—")}</dd></div>
      <div><dt>${t("map.field.project")}</dt><dd>${escapeHtml(d.project || "—")}</dd></div>
      <div><dt>compose service</dt><dd>${escapeHtml(d.compose_service || "—")}</dd></div>
      <div><dt>${t("map.field.ports")}</dt><dd>${escapeHtml(ports)}</dd></div>
      <div><dt>connect_to</dt><dd>${escapeHtml(d.connect_to || "—")}</dd></div>
    `;
  }

  function clearDrawer() {
    document.getElementById("drawer-empty").hidden = false;
    document.getElementById("drawer-body").hidden = true;
    const clearBtn = document.getElementById("btn-clear-selection");
    if (clearBtn) clearBtn.hidden = true;
    updateDrawerButton();
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  function paintIdle() {
    routeLinkDir = new Map();
    node.attr("opacity", 1);
    node
      .selectAll("rect.node-card")
      .attr("stroke", defaultNodeStroke)
      .attr("stroke-width", defaultNodeStrokeWidth);
    node.selectAll(".node-dot").attr("fill", nodeColor);
    link
      .attr("stroke", linkStroke)
      .attr("opacity", linkOpacity)
      .attr("stroke-width", 1.35)
      .attr("marker-end", (d) => (linkOpacity(d) === 0 ? null : "url(#arrow)"));
    linkLabels.style("visibility", "hidden");
    redrawEdges();
  }

  function highlightConnections() {
    if (!selectedNodes.size) {
      paintIdle();
      return;
    }

    const isRoute = routePath && routePath.length > 1;
    const routeIds = isRoute ? new Set(routePath.map((n) => n.id)) : null;
    const connectedLinks = new Set();
    const connectedNodes = new Set();
    const chainLinks = new Set();
    routeLinkDir = new Map();

    selectedNodes.forEach((selected) => connectedNodes.add(selected));

    if (isRoute) {
      // Только рёбра между соседними шагами маршрута + направление стрелки
      for (let i = 0; i < routePath.length - 1; i++) {
        const a = routePath[i];
        const b = routePath[i + 1];
        links.forEach((lnk) => {
          const s = lnk.source;
          const t = lnk.target;
          if ((s.id === a.id && t.id === b.id) || (s.id === b.id && t.id === a.id)) {
            chainLinks.add(lnk);
            connectedLinks.add(lnk);
            routeLinkDir.set(lnk, { from: a, to: b });
          }
        });
      }
      routePath.forEach((n) => connectedNodes.add(n));
    } else {
      links.forEach((lnk) => {
        if (selectedNodes.has(lnk.source) && selectedNodes.has(lnk.target)) {
          chainLinks.add(lnk);
          connectedLinks.add(lnk);
        }
      });
      selectedNodes.forEach((selected) => {
        links.forEach((lnk) => {
          if (lnk.source.id === selected.id || lnk.target.id === selected.id) {
            connectedLinks.add(lnk);
            connectedNodes.add(lnk.source);
            connectedNodes.add(lnk.target);
          }
        });
      });
    }

    // Маршрутные линии поверх остальных
    link
      .filter((d) => chainLinks.has(d))
      .each(function () {
        this.parentNode.appendChild(this);
      });
    linkLabels
      .filter((d) => chainLinks.has(d))
      .each(function () {
        this.parentNode.appendChild(this);
      });

    link
      .attr("stroke", (d) => {
        if (chainLinks.has(d)) return "#e11d48";
        if (connectedLinks.has(d)) return portColors[parseInt(d.target_port, 10)] || "#666";
        return "#d5dbe5";
      })
      .attr("opacity", (d) => {
        if (chainLinks.has(d)) return 1;
        if (isRoute) return 0.06;
        return connectedLinks.has(d) ? 0.55 : 0.08;
      })
      .attr("stroke-width", (d) => (chainLinks.has(d) ? 3.75 : connectedLinks.has(d) ? 1.25 : 1))
      .attr("marker-end", (d) => {
        if (chainLinks.has(d) && isRoute) return "url(#arrow-route)";
        if (isRoute) return null;
        return connectedLinks.has(d) ? "url(#arrow)" : null;
      });
    // Порты — только на рёбрах маршрута
    linkLabels.style("visibility", (d) => (isRoute && chainLinks.has(d) ? "visible" : "hidden"));
    node.attr("opacity", (d) => {
      if (isRoute) return routeIds.has(d.id) ? 1 : 0.12;
      return connectedNodes.has(d) ? 1 : 0.14;
    });
    node
      .selectAll("rect.node-card")
      .attr("stroke", (d) => {
        if (isRoute && routeIds.has(d.id)) return "#e11d48";
        if (selectedNodes.has(d)) return "#0f9d8a";
        return defaultNodeStroke(d);
      })
      .attr("stroke-width", (d) => {
        if (isRoute && routeIds.has(d.id)) return 3.25;
        if (selectedNodes.has(d)) return 2.75;
        return defaultNodeStrokeWidth(d);
      });
    redrawEdges();
  }

  function resetHighlight(clearSearch = true) {
    selectedNodes.clear();
    selectionAnchor = null;
    clearRouteStrip();
    paintIdle();
    clearDrawer();
    closePanels();

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
      // Не затирать текст маршрута обычной статистикой
      if (routePath && routePath.length > 1) showRouteStats(routePath);
      else {
        stats.textContent = t("map.stats", {
          nodes: visibleNodes.length,
          links: links.filter((l) => visible.has(l.source.id) && visible.has(l.target.id)).length,
        });
      }
    }

    if (q && !selectedNodes.size) {
      const matches = visibleNodes.filter((d) => d.name.toLowerCase().includes(q));
      node
        .selectAll("rect.node-card")
        .attr("stroke", (d) => (matches.includes(d) ? "#c94444" : defaultNodeStroke(d)))
        .attr("stroke-width", (d) => (matches.includes(d) ? 3 : defaultNodeStrokeWidth(d)));
      if (matches.length === 1 && refit) {
        beginSelectionFocus(matches[0]);
      } else if (matches.length > 1 && refit) {
        fitToNodes(matches, true);
      }
    } else if (!selectedNodes.size) {
      node
        .selectAll("rect.node-card")
        .attr("stroke", defaultNodeStroke)
        .attr("stroke-width", defaultNodeStrokeWidth);
      if (refit && layoutReady && visibleNodes.length) {
        fitToNodes(visibleNodes, true);
      }
    } else {
      highlightConnections();
    }
  }

  function updateClusterForce() {
    placeGraph(document.getElementById("flt-cluster").checked);
    paintPositions();
    frameReadable(true);
  }

  function frameReadable(animate = false) {
    const xs = nodes.map((n) => n.x).filter(Number.isFinite);
    const ys = nodes.map((n) => n.y).filter(Number.isFinite);
    if (!xs.length) return;
    const padX = CARD_W / 2 + 56;
    const padY = CARD_H / 2 + 48;
    const minX = Math.min(...xs) - padX;
    const maxX = Math.max(...xs) + padX;
    const minY = Math.min(...ys) - padY;
    const maxY = Math.max(...ys) + padY;
    const bw = Math.max(maxX - minX, 100);
    const bh = Math.max(maxY - minY, 100);
    const fitAll = Math.min((width - 28) / bw, (height - 28) / bh, 1);
    let scale;
    let tx;
    let ty;
    if (fitAll >= 0.68) {
      scale = fitAll;
      tx = width / 2 - (scale * (minX + maxX)) / 2;
      ty = height / 2 - (scale * (minY + maxY)) / 2;
    } else {
      scale = Math.min(1, (width - 28) / bw);
      tx = 16 - scale * minX;
      ty = 16 - scale * minY;
    }
    const t = d3.zoomIdentity.translate(tx, ty).scale(scale);
    svg.interrupt();
    const sel = animate ? svg.transition().duration(420).ease(d3.easeCubicInOut) : svg;
    sel.call(zoomBehavior.transform, t);
  }

  function fitToNodes(subset, animate = true) {
    const xs = subset.map((n) => n.x).filter(Number.isFinite);
    const ys = subset.map((n) => n.y).filter(Number.isFinite);
    if (!xs.length) return;
    const padX = CARD_W / 2 + 40;
    const padY = CARD_H / 2 + 48;
    const minX = Math.min(...xs) - padX;
    const maxX = Math.max(...xs) + padX;
    const minY = Math.min(...ys) - padY;
    const maxY = Math.max(...ys) + padY;
    const bw = Math.max(maxX - minX, 100);
    const bh = Math.max(maxY - minY, 100);
    const scale = Math.min((width - 80) / bw, (height - 80) / bh, 2.2) * 0.88;
    const tx = width / 2 - (scale * (minX + maxX)) / 2;
    const ty = height / 2 - (scale * (minY + maxY)) / 2;
    const t = d3.zoomIdentity.translate(tx, ty).scale(scale);
    svg.interrupt();
    const sel = animate ? svg.transition().duration(420).ease(d3.easeCubicInOut) : svg;
    sel.call(zoomBehavior.transform, t);
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  function drag() {
    return d3
      .drag()
      .on("drag", (event) => {
        event.subject.x = event.x;
        event.subject.y = event.y;
        paintPositions();
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
      const isAll = el.dataset.projectAll === "1";
      el.classList.toggle("active", isAll ? !project : el.textContent === project);
    });
    applyFilters({ refit: true });
  }
  const allChip = document.createElement("button");
  allChip.type = "button";
  allChip.className = "project-chip active";
  allChip.dataset.projectAll = "1";
  allChip.textContent = t("map.all_projects");
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
    // Без смены размера не трогаем камеру — иначе карта «дёргается» на poll/viewport
    if (Math.abs(nextW - width) < 4 && Math.abs(nextH - height) < 4) return;
    width = nextW;
    height = nextH;
    svg.attr("viewBox", `0 0 ${width} ${height}`);
    hitbox.attr("width", width).attr("height", height);
    placeGraph(document.getElementById("flt-cluster").checked);
    paintPositions();
    frameReadable(false);
  }
  const debouncedResize = debounce(resizeMap, 180);

  const listeners = [];
  function on(el, ev, fn) {
    if (!el) return;
    el.addEventListener(ev, fn);
    listeners.push([el, ev, fn]);
  }

  function zoomBy(factor) {
    svg.interrupt();
    svg.transition().duration(280).ease(d3.easeCubicInOut).call(zoomBehavior.scaleBy, factor);
  }

  on(document.getElementById("search-box"), "input", debouncedSearch);
  on(document.getElementById("search-box"), "keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const q = e.target.value.trim().toLowerCase();
    if (!q) return;
    const match =
      nodes.find((n) => n.name.toLowerCase() === q) ||
      nodes.find((n) => n.name.toLowerCase().includes(q));
    if (match) {
      document.getElementById("flt-linked-only").checked = false;
      selectAndShow(match);
    }
  });
  on(document.getElementById("flt-running"), "change", () => applyFilters());
  on(document.getElementById("flt-stopped"), "change", () => applyFilters());
  on(document.getElementById("flt-external"), "change", () => applyFilters());
  on(document.getElementById("flt-linked-only"), "change", () => applyFilters({ refit: true }));
  on(document.getElementById("flt-cluster"), "change", updateClusterForce);
  on(document.getElementById("flt-prefix"), "input", debouncedPrefix);
  on(document.getElementById("btn-fit"), "click", () => fitToScreen(true));
  on(document.getElementById("btn-fit-float"), "click", () => fitToScreen(true));
  on(document.getElementById("btn-zoom-in"), "click", () => zoomBy(1.2));
  on(document.getElementById("btn-zoom-in-float"), "click", () => zoomBy(1.2));
  on(document.getElementById("btn-zoom-out"), "click", () => zoomBy(0.84));
  on(document.getElementById("btn-zoom-out-float"), "click", () => zoomBy(0.84));
  on(document.getElementById("btn-reset"), "click", () => {
    placeGraph(document.getElementById("flt-cluster").checked);
    paintPositions();
    resetHighlight(true);
    frameReadable(true);
  });
  on(document.getElementById("btn-refresh"), "click", () => {
    softPoll({ forceFresh: true, allowRebuild: true });
  });
  on(document.getElementById("btn-clear-selection"), "click", () => resetHighlight(true));
  on(document.getElementById("route-strip-close"), "click", () => resetHighlight(true));
  on(document.getElementById("route-strip-fit"), "click", () => {
    if (routePath && routePath.length > 1) fitToNodes(routePath, true);
  });

  const filtToggle = document.getElementById("btn-toggle-filters");
  on(filtToggle, "click", () => {
    if (!mapApp) return;
    if (mapApp.classList.contains("filters-open")) closePanels();
    else openFilters();
  });
  const drawerToggle = document.getElementById("btn-toggle-drawer");
  on(drawerToggle, "click", () => {
    if (!mapApp) return;
    if (mapApp.classList.contains("drawer-open")) closePanels();
    else openDrawerPanel();
  });
  document.querySelectorAll("[data-close-panel]").forEach((btn) => {
    on(btn, "click", () => closePanels());
  });
  on(backdrop, "click", () => closePanels());

  function onKey(e) {
    const tag = (e.target && e.target.tagName) || "";
    const typing = tag === "INPUT" || tag === "TEXTAREA" || e.target?.isContentEditable;
    if (e.key === "/" && !typing) {
      e.preventDefault();
      openFilters();
      document.getElementById("search-box")?.focus();
      return;
    }
    if (e.key === "Escape") {
      if (mapApp && mapApp.classList.contains("panel-open")) {
        closePanels();
        return;
      }
      if (selectedNodes.size) {
        resetHighlight(true);
        return;
      }
      const search = document.getElementById("search-box");
      if (search && search.value) {
        search.value = "";
        applyFilters({ refit: true });
      }
    }
  }
  on(window, "keydown", onKey);
  on(window, "resize", debouncedResize);
  if (window.visualViewport) {
    on(window.visualViewport, "resize", debouncedResize);
  }

  syncPanelState();
  layoutReady = true;
  paintPositions();
  frameReadable(false);
  applyFilters();
  focusFromQuery(preserveNode);

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
      n.name = u.name || n.name;
    });
    // Только данные/цвет — без refit и без сброса камеры
    node.selectAll(".node-dot").attr("fill", nodeColor);
    node.select("title").text((d) => d.name);
    node.select(".node-kind").text(nodeKindText);
    node
      .select(".node-name")
      .text((d) => truncate(displayName(d), 16))
      .attr("fill", nodeNameFill);

    const cov = data.coverage || {};
    const covSummary = document.getElementById("coverage-summary");
    if (covSummary) {
      const missing = (cov.without_connect_to || []).length;
      covSummary.textContent = t("map.coverage_summary", {
        with_label: cov.with_connect_to || 0,
        total: cov.total || nodes.length,
        missing,
      });
    }
    const updatedEl = document.getElementById("map-updated");
    if (updatedEl) updatedEl.textContent = formatUpdated(data.fetched_at);
    if (selectedNodes.size) highlightConnections();
  }

  mapController = {
    structureKey: topo,
    applyLiveUpdate,
    destroy() {
      listeners.forEach(([el, ev, fn]) => el.removeEventListener(ev, fn));
    },
  };
}

async function softPoll({ forceFresh = false, allowRebuild = false } = {}) {
  try {
    const data = await fetchMapData(forceFresh);
    const updatedEl = document.getElementById("map-updated");
    if (updatedEl) updatedEl.textContent = formatUpdated(data.fetched_at);
    if (!mapController) return;

    const next = structureKey(data);
    if (next === mapController.structureKey) {
      mapController.applyLiveUpdate?.(data);
      return;
    }
    // Тихий poll: не пересобираем граф (это дёргает камеру). Полный rebuild — по Refresh.
    if (!allowRebuild && !forceFresh) {
      mapController.applyLiveUpdate?.(data);
      return;
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
