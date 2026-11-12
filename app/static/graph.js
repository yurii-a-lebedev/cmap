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

  // Узлы только с external-связями — держим у шлюза, не внутри чужой звезды.
  const nbrIds = new Map();
  links.forEach((l) => {
    if (!nbrIds.has(l.source)) nbrIds.set(l.source, []);
    if (!nbrIds.has(l.target)) nbrIds.set(l.target, []);
    nbrIds.get(l.source).push(l.target);
    nbrIds.get(l.target).push(l.source);
  });
  const externalLeafIds = new Set();
  const leafExternalTarget = new Map();
  nodes.forEach((n) => {
    if (n.state === "external") return;
    const ids = nbrIds.get(n.id) || [];
    if (!ids.length) return;
    if (ids.every((id) => String(id).startsWith("external:"))) {
      externalLeafIds.add(n.id);
      leafExternalTarget.set(n.id, ids[0]);
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
  let fittedOnce = false;
  /** Пока true — камера тихо следует за раскладкой, без «появились → потом зум». */
  let framingLive = true;
  let frameTick = 0;
  let layoutReady = false;
  let destroyed = false;
  // Снимок фильтров до временного раскрытия при фокусе на узле
  let filterSnapshot = null;

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
    const drawerBtn = document.getElementById("btn-toggle-drawer");
    if (drawerBtn) {
      drawerBtn.setAttribute(
        "aria-expanded",
        mapApp.classList.contains("drawer-open") ? "true" : "false"
      );
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

  function nodesAreLinked(a, b) {
    return links.some(
      (l) =>
        (l.source.id === a.id && l.target.id === b.id) ||
        (l.source.id === b.id && l.target.id === a.id)
    );
  }

  function isAdjacentToSelection(d) {
    for (const sel of selectedNodes) {
      if (nodesAreLinked(sel, d)) return true;
    }
    return false;
  }

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

  function applyPathSelection(path, focusNode) {
    selectedNodes.clear();
    path.forEach((n) => selectedNodes.add(n));
    highlightConnections();
    fillDrawer(focusNode);
    setNodeQuery(focusNode.name);
    updateDrawerButton();
    showRouteStats(path);
    // Подгоняем кадр только для длинного маршрута, не к одному узлу
    if (layoutReady && path.length > 2) fitToNodes(path, true);
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
  let leafOrbit = 0;
  nodes.forEach((n, i) => {
    if (saved[n.id] && Number.isFinite(saved[n.id].x) && Number.isFinite(saved[n.id].y) && !externalLeafIds.has(n.id)) {
      n.x = saved[n.id].x;
      n.y = saved[n.id].y;
      restoredCount += 1;
    } else if (externalLeafIds.has(n.id)) {
      // Сразу у шлюза, а не внутри чужой звезды
      const c = projectCenters.external;
      const angle = -Math.PI / 2 + (leafOrbit++ - 0.5) * 0.55;
      n.x = c.x + Math.cos(angle) * 120;
      n.y = c.y + Math.sin(angle) * 90 + 70;
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
      // Ручной pan/zoom — не перетягивать кадр автофитом
      if (event.sourceEvent && framingLive) framingLive = false;
    });
  svg.call(zoomBehavior);

  // Osmos-like: слабые пружины, сильное отталкивание, вязкая среда
  function clusterStrength() {
    return document.getElementById("flt-cluster").checked ? 0.12 : 0.015;
  }

  /** Выпрямляет цепочки A—B—C: B тянется к линии между A и C (не хабы). */
  function forceStraighten(strength = 0.07) {
    let nodesArr;
    function force(alpha) {
      const adj = new Map();
      links.forEach((l) => {
        const s = l.source;
        const t = l.target;
        if (!s || !t || !Number.isFinite(s.x) || !Number.isFinite(t.x)) return;
        if (!adj.has(s.id)) adj.set(s.id, []);
        if (!adj.has(t.id)) adj.set(t.id, []);
        adj.get(s.id).push(t);
        adj.get(t.id).push(s);
      });
      const k = strength * alpha;
      nodesArr.forEach((n) => {
        if (n.fx != null || n.fy != null) return;
        const nb = adj.get(n.id);
        if (!nb || nb.length < 2 || nb.length > 3) return;
        const pairW = nb.length === 2 ? 1 : 0.3;
        for (let i = 0; i < nb.length; i++) {
          for (let j = i + 1; j < nb.length; j++) {
            const a = nb[i];
            const b = nb[j];
            // проекция n на отрезок ab → выпрямление без сжатия в точку
            const abx = b.x - a.x;
            const aby = b.y - a.y;
            const len2 = abx * abx + aby * aby || 1;
            let t = ((n.x - a.x) * abx + (n.y - a.y) * aby) / len2;
            t = Math.max(0.2, Math.min(0.8, t));
            const px = a.x + abx * t;
            const py = a.y + aby * t;
            n.vx += (px - n.x) * k * pairW;
            n.vy += (py - n.y) * k * pairW;
          }
        }
      });
    }
    force.initialize = (n) => {
      nodesArr = n;
    };
    return force;
  }

  function forceExternalLeaves(strength = 0.16) {
    let nodesArr;
    const byId = () => new Map(nodesArr.map((n) => [n.id, n]));
    function force(alpha) {
      const map = byId();
      const k = strength * alpha;
      externalLeafIds.forEach((id) => {
        const n = map.get(id);
        const ext = map.get(leafExternalTarget.get(id));
        if (!n || !ext || !Number.isFinite(ext.x) || !Number.isFinite(ext.y)) return;
        if (n.fx != null || n.fy != null) return;
        // держим лист рядом со шлюзом, сбоку — чтобы не лезть в чужие лучи
        const tx = ext.x + (n.x >= ext.x ? 110 : -110);
        const ty = ext.y + 95;
        n.vx += (tx - n.x) * k;
        n.vy += (ty - n.y) * k;
      });
    }
    force.initialize = (n) => {
      nodesArr = n;
    };
    return force;
  }

  const simulation = d3
    .forceSimulation(nodes)
    .force(
      "link",
      d3
        .forceLink(links)
        .id((d) => d.id)
        .distance((l) => (l.resolved === "external" ? 300 : 260))
        .strength((l) => (l.resolved === "external" ? 0.26 : 0.14))
    )
    .force(
      "charge",
      d3
        .forceManyBody()
        .strength(-920)
        .distanceMin(40)
        .distanceMax(720)
    )
    .force("collide", d3.forceCollide().radius(84).strength(0.5).iterations(2))
    .force("straighten", forceStraighten(0.08))
    .force("externalLeaves", forceExternalLeaves(0.18))
    .force("centerX", d3.forceX(width / 2).strength(0.018))
    .force("centerY", d3.forceY(height / 2).strength(0.018))
    .force(
      "x",
      d3
        .forceX((d) => {
          if (externalLeafIds.has(d.id)) return projectCenters.external.x;
          const key = d.state === "external" ? "external" : d.project || "_none";
          return (projectCenters[key] || projectCenters._none).x;
        })
        .strength((d) => (externalLeafIds.has(d.id) ? 0.08 : clusterStrength()))
    )
    .force(
      "y",
      d3
        .forceY((d) => {
          if (externalLeafIds.has(d.id)) return projectCenters.external.y + 80;
          const key = d.state === "external" ? "external" : d.project || "_none";
          return (projectCenters[key] || projectCenters._none).y;
        })
        .strength((d) => (externalLeafIds.has(d.id) ? 0.1 : clusterStrength()))
    )
    .velocityDecay(0.55)
    .alphaDecay(0.012)
    .alphaMin(0.0008);

  // Если раскладка уже сохранена — не взрывать граф и не гонять камеру за тиками
  const layoutMostlyRestored = restoredCount >= Math.max(3, nodes.length * 0.35);
  if (layoutMostlyRestored) {
    simulation.alpha(0.04);
    framingLive = false;
    fittedOnce = true;
  }

  const link = g
    .append("g")
        .selectAll("line")
        .data(links)
        .join("line")
    .attr("class", "link-line")
    .attr("stroke", (d) => portColors[parseInt(d.target_port, 10)] || "#9aa6b5")
    .attr("stroke-width", 1.35)
    .attr("stroke-opacity", 0.45);

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
      if (selectedNodes.has(d)) {
        if (selectedNodes.size === 1) {
          resetHighlight(true);
          return;
        }
        selectedNodes.delete(d);
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
    .append("circle")
    .attr("class", "node-circle")
    .attr("r", (d) => nodeRadius(d))
    .attr("fill", nodeColor)
    .attr("stroke", defaultNodeStroke)
    .attr("stroke-width", defaultNodeStrokeWidth)
    .attr("stroke-dasharray", (d) => (d.state === "external" ? "4 3" : null));

  // Имя внутри круга
  node
    .append("text")
    .attr("class", "node-label-text")
    .attr("text-anchor", "middle")
    .attr("dy", "0.35em")
    .style("pointer-events", "none")
    .style("font-weight", "700")
    .style("font-size", (d) => (innerLabel(d).length > 7 ? "10px" : "12px"))
    .style("fill", (d) => labelColor(d))
    .style("paint-order", "stroke")
    .style("stroke", "rgba(0,0,0,0.28)")
    .style("stroke-width", "2.5px")
    .text((d) => innerLabel(d));

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
    if (framingLive && ++frameTick % 2 === 0) fitToScreen(false);
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

  function startLiveFraming() {
    framingLive = true;
    fittedOnce = false;
    frameTick = 0;
  }

  simulation.on("end", () => {
    if (destroyed) return;
    // Не фиксируем fx/fy — иначе граф «замирает» и не расправляется
    persistPositions();
    layoutReady = true;
    if (!fittedOnce || framingLive) {
      fittedOnce = true;
      framingLive = false;
      fitToScreen(false);
      focusFromQuery(preserveNode);
    }
  });

  // Сразу поставить кадр по известным координатам — без вспышки 1:1 и последующего зума
  if (restoredCount > 0) fitToScreen(false);

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

  function labelColor(d) {
    if (d.state === "external") return "#1c3a7a";
    return "#ffffff";
  }

  function defaultNodeStroke(d) {
    return d.state === "external" ? "#2f6fed" : "rgba(28,36,48,0.22)";
  }

  function defaultNodeStrokeWidth(d) {
    return d.state === "external" ? 2 : 1.25;
  }

  function nodeRadius(d) {
    return d.state === "external" ? 28 : 34;
  }

  function innerLabel(d) {
    const raw = String(d.name || "");
    const proj = (d.project || "").toLowerCase();
    let name = raw;
    if (proj && name.toLowerCase().startsWith(proj + "-")) {
      name = name.slice(proj.length + 1);
    }
    if (proj && name.toLowerCase().startsWith(proj + "_")) {
      name = name.slice(proj.length + 1);
    }
    return truncate(name, 10);
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
    framingLive = false;
    svg.interrupt();
    svg.transition().duration(380).ease(d3.easeCubicInOut).call(zoomBehavior.transform, t);
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

  function showDrawer(d) {
    fillDrawer(d);
    openDrawerPanel();
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

  function highlightConnections() {
    if (!selectedNodes.size) {
      node
        .selectAll("circle")
        .attr("opacity", 1)
        .attr("stroke", defaultNodeStroke)
        .attr("stroke-width", defaultNodeStrokeWidth);
      link
        .attr("stroke", (d) => portColors[parseInt(d.target_port, 10)] || "#666")
        .attr("opacity", 1)
        .attr("stroke-width", 1.35);
      linkLabels.style("visibility", "hidden");
      return;
    }

    const connectedLinks = new Set();
    const connectedNodes = new Set();
    const chainLinks = new Set();

    selectedNodes.forEach((selected) => connectedNodes.add(selected));

    // Рёбра внутри выбранной цепочки
    links.forEach((link) => {
      if (selectedNodes.has(link.source) && selectedNodes.has(link.target)) {
        chainLinks.add(link);
        connectedLinks.add(link);
      }
    });

    // Соседи всей цепочки (куда можно кликнуть дальше)
    selectedNodes.forEach((selected) => {
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
      .attr("opacity", (d) => (connectedLinks.has(d) ? 1 : 0.12))
      .attr("stroke-width", (d) => (chainLinks.has(d) ? 2.5 : connectedLinks.has(d) ? 1.25 : 1));
    linkLabels.style("visibility", (d) => (connectedLinks.has(d) ? "visible" : "hidden"));
    node
      .selectAll("circle")
      .attr("opacity", (d) => (connectedNodes.has(d) ? 1 : 0.15))
      .attr("stroke", (d) => (selectedNodes.has(d) ? "#0f9d8a" : defaultNodeStroke(d)))
      .attr("stroke-width", (d) => (selectedNodes.has(d) ? 3.5 : defaultNodeStrokeWidth(d)));
  }

  function resetHighlight(clearSearch = true) {
    selectedNodes.clear();
    selectionAnchor = null;
    node
      .selectAll("circle")
      .attr("opacity", 1)
      .attr("fill", nodeColor)
      .attr("stroke", defaultNodeStroke)
      .attr("stroke-width", defaultNodeStrokeWidth);
    link
      .attr("stroke", (d) => portColors[parseInt(d.target_port, 10)] || "#666")
      .attr("opacity", 1);
    linkLabels.style("visibility", "hidden");
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
      stats.textContent = t("map.stats", {
        nodes: visibleNodes.length,
        links: links.filter((l) => visible.has(l.source.id) && visible.has(l.target.id)).length,
      });
    }

    if (q && !selectedNodes.size) {
      const matches = visibleNodes.filter((d) => d.name.toLowerCase().includes(q));
      node
        .selectAll("circle")
        .attr("stroke", (d) => (matches.includes(d) ? "#c94444" : defaultNodeStroke(d)))
        .attr("stroke-width", (d) => (matches.includes(d) ? 3 : defaultNodeStrokeWidth(d)));
      if (matches.length === 1) {
        beginSelectionFocus(matches[0]);
      } else if (matches.length > 1 && refit) {
        fitToNodes(matches, true);
      }
    } else if (!selectedNodes.size) {
      node
        .selectAll("circle")
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
    simulation.force("x").strength(clusterStrength);
    simulation.force("y").strength(clusterStrength);
    startLiveFraming();
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
    if (animate) framingLive = false;
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
      const isAll = el.dataset.projectAll === "1";
      el.classList.toggle("active", isAll ? !project : el.textContent === project);
    });
    applyFilters({ refit: true });
    startLiveFraming();
    reheat(0.2);
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
    simulation.force("centerX", d3.forceX(width / 2).strength(0.018));
    simulation.force("centerY", d3.forceY(height / 2).strength(0.018));
    const rSpread = Math.min(width, height) * 0.42;
    const projKeys = Object.keys(projectCenters).filter((k) => k !== "_none" && k !== "external");
    Object.keys(projectCenters).forEach((key) => {
      if (key === "_none") {
        projectCenters[key] = { x: width / 2, y: height / 2 };
      } else if (key === "external") {
        projectCenters[key] = { x: width / 2, y: height * 0.1 };
      } else {
        const i = projKeys.indexOf(key);
        const angle = (i / Math.max(projKeys.length, 1)) * Math.PI * 2;
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

  function zoomBy(factor) {
    framingLive = false;
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
    localStorage.removeItem(STORAGE_KEY);
    startLiveFraming();
    reheat(0.3);
    resetHighlight(true);
  });
  on(document.getElementById("btn-refresh"), "click", () => {
    persistPositions();
    softPoll({ forceFresh: true, allowRebuild: true });
  });
  on(document.getElementById("btn-clear-selection"), "click", () => resetHighlight(true));

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
      n.name = u.name || n.name;
    });
    // Только данные/цвет — без refit и без сброса камеры
    node.selectAll("circle").attr("fill", nodeColor);
    node.select("title").text((d) => d.name);
    node.select("text.node-label-text").text((d) => innerLabel(d)).style("fill", (d) => labelColor(d));

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
