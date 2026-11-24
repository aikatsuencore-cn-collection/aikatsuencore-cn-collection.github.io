/* =========================================================================
 *  app.js  ——  卡片收集册 交互逻辑
 *  纯前端，无后端。数据来自 cards.js（静态）+ localStorage（收集状态）。
 *  核心：未收集卡片显示灰白滤镜，点击切换为彩色（仅 CSS filter，无需灰白图）。
 * ========================================================================= */
(function () {
  "use strict";

  var STORE_KEY = "cardCollection.collected.v1";
  var USER_KEY  = "cardCollection.userCards.v1";

  /* ---------- 状态 ---------- */
  var collected = loadCollected();           // Set<id>
  var userCards = loadUserCards();           // 用户通过弹窗 / 导入添加的卡片
  function getAllCards() { return CARDS.concat(userCards); }
  var filters = {                            // 各分组选中的值集合
    type: new Set(), rarity: new Set(),
    category: new Set(), brand: new Set(),
    display: "all",                          // 单选：all / normal / parallel
  };
  var search = "";
  var currentGroup = "";   // 当前系列分组："" 表示「全部」，否则为具体系列名（如 第一季 / 促销卡 / 第二季 …）
  var pendingShareCount = 0;

  /* ---------- DOM ---------- */
  var $ = function (id) { return document.getElementById(id); };
  var grid = $("grid");
  var filterPanel = $("filterPanel");
  var emptyHint = $("emptyHint");
  var statGot = $("statGot"), statTotal = $("statTotal"), statPct = $("statPct");

  /* ---------- 工具 ---------- */
  function loadCollected() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(arr) ? arr : []);
    } catch (e) { return new Set(); }
  }
  function saveCollected() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(Array.from(collected))); }
    catch (e) { toast("无法保存：浏览器存储不可用"); }
  }
  function loadUserCards() {
    try {
      var raw = localStorage.getItem(USER_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }
  function saveUserCards() {
    try { localStorage.setItem(USER_KEY, JSON.stringify(userCards)); }
    catch (e) { toast("无法保存卡片：存储空间可能已满"); }
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function escapeXml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---------- 占位卡面（无 img 时自动生成，带类型配色） ---------- */
  function placeholder(card) {
    var c = (window.TYPE_COLORS && TYPE_COLORS[card.type]) || "#ff9ecd";
    var svg =
      "<svg xmlns='http://www.w3.org/2000/svg' width='300' height='400'>" +
        "<rect width='300' height='400' fill='" + c + "'/>" +
        "<rect x='16' y='16' width='268' height='368' rx='20' fill='#ffffff' opacity='0.25'/>" +
        "<text x='150' y='180' font-family='sans-serif' font-size='22' font-weight='bold' fill='#ffffff' text-anchor='middle'>" + escapeXml(card.name) + "</text>" +
        "<text x='150' y='220' font-family='sans-serif' font-size='15' fill='#ffffff' text-anchor='middle' opacity='0.9'>" + escapeXml(card.type) + "</text>" +
        "<text x='150' y='250' font-family='sans-serif' font-size='13' fill='#ffffff' text-anchor='middle' opacity='0.8'>" + escapeXml(card.rarity) + "</text>" +
      "</svg>";
    return "data:image/svg+xml," + encodeURIComponent(svg);
  }
  function cardImg(card) {
    // 独立图片文件（images/cards/*.webp），支持浏览器懒加载与缓存；
    // 兼容旧的内联 base64（若某张图仍只在 CARD_IMG_DATA 中）；无图则用占位图。
    if (card.img && window.CARD_IMG_DATA && window.CARD_IMG_DATA[card.img]) return window.CARD_IMG_DATA[card.img];
    return card.img ? card.img : placeholder(card);
  }

  /* ---------- 卡片轮廓占位图（图片加载完成前显示，与卡面同尺寸） ---------- */
  var CARD_PH_SVG = (function () {
    var svg =
      "<svg xmlns='http://www.w3.org/2000/svg' width='460' height='670' viewBox='0 0 460 670'>" +
        "<rect width='460' height='670' rx='20' fill='#FBEAF0'/>" +
        "<rect x='20' y='20' width='420' height='630' rx='14' fill='none' stroke='#ED93B1' stroke-width='3'/>" +
        "<rect x='46' y='46' width='104' height='30' rx='8' fill='none' stroke='#ED93B1' stroke-width='3'/>" +
        "<rect x='46' y='92' width='368' height='360' rx='12' fill='#F4C0D1'/>" +
        "<rect x='46' y='474' width='368' height='18' rx='9' fill='#ED93B1'/>" +
        "<rect x='46' y='508' width='230' height='18' rx='9' fill='#ED93B1'/>" +
      "</svg>";
    return "data:image/svg+xml," + encodeURIComponent(svg);
  })();

  /* ---------- 筛选面板（按 FILTER_CONFIG 自动生成） ---------- */
  function buildFilterPanel() {
    var html = "";
    // 按 row 分组包裹，保证 类型+稀有 / 类别 / 品牌+显示 固定三行排列
    var rows = {};
    Object.keys(FILTER_CONFIG).forEach(function (key) {
      var group = FILTER_CONFIG[key];
      var r = group.row || 1;
      (rows[r] = rows[r] || []).push(key);
    });
    Object.keys(rows).map(Number).sort(function (a, b) { return a - b; }).forEach(function (r) {
      html += '<div class="filter-row">';
      rows[r].forEach(function (key) {
        var group = FILTER_CONFIG[key];
        html += '<div class="filter-group" data-group="' + key + '">';
        html += "<h2>" + escapeHtml(group.label) + "</h2>";
        html += '<div class="filter-options">';
        group.options.forEach(function (opt) {
          var active = (!group.multi && filters[key] === opt.value) ? " active" : "";
          html += '<button type="button" class="filter-btn' + active +
            '" data-group="' + key + '" data-value="' + escapeHtml(opt.value) + '"' +
            (group.multi ? ' aria-pressed="false"' : ' aria-pressed="' + (!group.multi && filters[key] === opt.value) + '"') +
            ">" + escapeHtml(opt.label) + "</button>";
        });
        html += "</div></div>";
      });
      html += "</div>";
    });
    filterPanel.innerHTML = html;
  }

  filterPanel.addEventListener("click", function (e) {
    var btn = e.target.closest(".filter-btn");
    if (!btn) return;
    var group = btn.dataset.group;
    var value = btn.dataset.value;
    var cfg = FILTER_CONFIG[group];
    if (cfg.multi) {
      if (filters[group].has(value)) filters[group].delete(value);
      else filters[group].add(value);
      btn.classList.toggle("active");
      btn.setAttribute("aria-pressed", filters[group].has(value));
    } else {
      filters[group] = (filters[group] === value) ? "all" : value; // 再次点击复位为“显示所有”
      Array.prototype.forEach.call(
        filterPanel.querySelectorAll('[data-group="' + group + '"]'),
        function (b) {
          var on = (b.dataset.value === filters[group]);
          b.classList.toggle("active", on);
          b.setAttribute("aria-pressed", on);
        }
      );
    }
    render();
  });

  /* ---------- 系列分组切换（标签由数据自动生成，后期加第二季/第三季自动出现） ---------- */
  var groupRow = $("groupRow");
  // 根据卡片数据里的 group 字段，生成系列标签 + 一个「全部」标签
  function buildGroupBar() {
    var groups = [];
    getAllCards().forEach(function (c) {
      if (c.group && groups.indexOf(c.group) === -1) groups.push(c.group);
    });
    var html = '<button type="button" class="group-btn' + (currentGroup === "" ? " active" : "") +
               '" data-group="" role="tab" aria-selected="' + (currentGroup === "" ? "true" : "false") + '">全部</button>';
    groups.forEach(function (g) {
      var on = (currentGroup === g);
      html += '<button type="button" class="group-btn' + (on ? " active" : "") +
              '" data-group="' + escapeHtml(g) + '" role="tab" aria-selected="' + (on ? "true" : "false") + '">' +
              escapeHtml(g) + "</button>";
    });
    groupRow.innerHTML = html;
    // 同步填充「添加卡片」弹窗里的系列下拉
    var sel = $("addGroup");
    if (sel) {
      sel.innerHTML = groups.map(function (g) {
        return '<option value="' + escapeHtml(g) + '">' + escapeHtml(g) + "</option>";
      }).join("");
    }
  }
  groupRow.addEventListener("click", function (e) {
    var btn = e.target.closest(".group-btn");
    if (!btn) return;
    currentGroup = btn.dataset.group;
    Array.prototype.forEach.call(groupRow.querySelectorAll(".group-btn"), function (b) {
      var on = (b === btn);
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    render();
  });

  /* ---------- 顶部控制条收起 / 展开 ---------- */
  var topbar = $("topbar");
  var topbarToggleText = $(".topbar-toggle-text");
  $("topbarToggle").addEventListener("click", function () {
    var collapsed = topbar.classList.toggle("collapsed");
    this.setAttribute("aria-expanded", collapsed ? "false" : "true");
    if (topbarToggleText) topbarToggleText.textContent = collapsed ? "展开" : "收起";
    // 筛选详情面板在 topbar 之外，收起顶部时需同步收起，否则会残留
    if (collapsed) {
      filterPanel.hidden = true;
      filterToggle.setAttribute("aria-expanded", "false");
    }
  });

  /* ---------- 筛选 + 搜索 ---------- */
  function match(card) {
    if (currentGroup && card.group && card.group !== currentGroup) return false;  // 系列分组筛选（currentGroup 为空 = 全部）
    var groups = ["type", "rarity", "category", "brand"];
    for (var i = 0; i < groups.length; i++) {
      var g = groups[i];
      if (filters[g].size && !filters[g].has(card[g])) return false;
    }
    if (filters.display === "normal" && card.parallel) return false;
    if (filters.display === "parallel" && !card.parallel) return false;
    if (search) {
      var hay = card.id.toLowerCase();   // 只能搜索卡片编号
      if (hay.indexOf(search) === -1) return false;
    }
    return true;
  }

  /* ---------- 渲染 ---------- */
  function render() {
    var list = getAllCards().filter(match);
    if (arrangeMode === "collectedFirst") {
      // 已获得（点亮）卡片优先，并在各自分组内按原编号顺序稳定排序
      list.sort(function (a, b) {
        var aGot = collected.has(a.id) || cardTotal(a.id) > 0;
        var bGot = collected.has(b.id) || cardTotal(b.id) > 0;
        return (aGot ? 0 : 1) - (bGot ? 0 : 1);
      });
    }
    var html = "";
    list.forEach(function (card) {
      var isGot = collected.has(card.id) || cardTotal(card.id) > 0;
      var total = cardTotal(card.id);
      html +=
        '<article class="card-item' + (isGot ? " collected" : "") + '" data-id="' + escapeHtml(card.id) + '" tabindex="0" role="button" aria-pressed="' + isGot + '" title="' + escapeHtml(card.name) + '">' +
          '<div class="card-media">' +
            '<div class="card-ph" style="background-image:url(\'' + CARD_PH_SVG + '\')"></div>' +
            '<img class="card-img" src="' + cardImg(card) + '" alt="' + escapeHtml(card.name) + '" loading="lazy" onload="this.classList.add(\'img-loaded\')">' +
          "</div>" +
          (total > 0 ? '<span class="count-badge">' + formatCountHtml(total) + "</span>" : "") +
          '<button type="button" class="count-dot" data-id="' + escapeHtml(card.id) + '" aria-label="卡片计数">' + DOT_SVG + "</button>" +
        "</article>";
    });
    grid.innerHTML = html;
    // 图片淡入兜底：缓存命中时 load 可能在绑定前就完成，这里补一次检查
    grid.querySelectorAll("img.card-img").forEach(function (im) {
      if (im.complete && im.naturalWidth > 0) im.classList.add("img-loaded");
    });
    emptyHint.hidden = list.length !== 0;

    // 统计（按当前系列分组计算收集进度）
    var inGroup = getAllCards().filter(function (c) { return !currentGroup || !c.group || c.group === currentGroup; });
    var total = inGroup.length;
    var got = inGroup.filter(function (c) { return collected.has(c.id) || cardTotal(c.id) > 0; }).length;
    statGot.textContent = got;
    statTotal.textContent = total;
    statPct.textContent = (total ? Math.round((got / total) * 100) : 0) + "%";
  }

  /* ---------- 点击卡片：切换收集状态 / 简洁版收集 ---------- */
  function toggleCard(id) {
    if (collected.has(id)) collected.delete(id);
    else collected.add(id);
    saveCollected();
    render();
  }
  /* 简洁版（收集模式）卡面省略号下拉菜单 */
  var collectMenuEl = null;
  function closeCollectMenu() {
    if (collectMenuEl) { collectMenuEl.remove(); collectMenuEl = null; }
    document.removeEventListener("click", onCollectDocClick, true);
  }
  function onCollectDocClick(e) {
    if (collectMenuEl && !collectMenuEl.contains(e.target) && !e.target.closest(".count-dot")) closeCollectMenu();
  }
  function openCollectMenu(dot) {
    closeCollectMenu();
    var id = dot.dataset.id;
    var menu = document.createElement("div");
    menu.className = "count-menu";
    menu.innerHTML =
      '<button type="button" data-act="one">删除一张</button>' +
      '<button type="button" class="danger" data-act="all">删除所有记录</button>';
    dot.closest(".card-item").appendChild(menu);
    collectMenuEl = menu;
    menu.dataset.cardId = id;
    menu.addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      e.stopPropagation();
      if (b.dataset.act === "one") bumpCollect(id, -1);
      else clearCollect(id);
      closeCollectMenu();
    });
    setTimeout(function () { document.addEventListener("click", onCollectDocClick, true); }, 0);
  }
  grid.addEventListener("click", function (e) {
    if (e.target.closest(".count-menu")) return;   // 下拉菜单内的点击由其自身处理
    var dot = e.target.closest(".count-dot");
    if (dot) {
      if (countMode === "collect") {
        if (collectMenuEl && collectMenuEl.dataset.cardId === dot.dataset.id) closeCollectMenu();
        else openCollectMenu(dot);
      } else {
        openCountModal(dot.dataset.id);
      }
      return;
    }
    var item = e.target.closest(".card-item");
    if (item) {
      if (countMode === "collect") bumpCollect(item.dataset.id, 1);
      else toggleCard(item.dataset.id);
    }
  });
  grid.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") {
      var dot = e.target.closest(".count-dot");
      if (dot) {
        e.preventDefault();
        if (countMode === "collect") {
          if (collectMenuEl && collectMenuEl.dataset.cardId === dot.dataset.id) closeCollectMenu();
          else openCollectMenu(dot);
        } else {
          openCountModal(dot.dataset.id);
        }
        return;
      }
      var item = e.target.closest(".card-item");
      if (item) {
        e.preventDefault();
        if (countMode === "collect") bumpCollect(item.dataset.id, 1);
        else toggleCard(item.dataset.id);
      }
    }
  });

  /* =========================================================================
   *  计数方法（简洁版 / 详细版 / 简洁版1.0 / 详细版1.0）
   *  - 简洁版：每张卡记 已下单 / 运输中 / 已到货 三个数量，卡片显示三项总和（拥有张数）
   *  - 详细版1.0（menu，data-mode=detail）：逐张登记购买渠道与物流阶段，卡片显示已拥有张数
   *  数据存于 localStorage（counts），模式存于 countMode
   * ========================================================================= */
  var STORE_KEY_COUNT = "cardCollection.counts.v1";
  var STORE_KEY_MODE  = "cardCollection.countMode.v1";
  var STORE_KEY_ARRANGE = "cardCollection.arrangeMode.v1";
  var DOT_SVG = '<svg viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><circle cx="5" cy="12" r="2.2"/><circle cx="12" cy="12" r="2.2"/><circle cx="19" cy="12" r="2.2"/></svg>';
  var SIMPLE_STAGES = [["ordered", "已下单"], ["transit", "运输中"], ["arrived", "已到货"]];
  var DETAIL_PATHS = {
    "代购/跟团": ["已下单", "已付款", "已回国", "已排发", "已到货"],
    "海淘软件":   ["已付款", "已入库", "已合单回国", "已到货"]
  };

  var counts = loadCounts();
  var countMode = loadCountMode();   // "simple" | "detail"
  var arrangeMode = loadArrangeMode(); // "default" | "collectedFirst"
  var currentCountId = null;
  var wizardStep = null;     // null | "channel" | "sub"（详细版1.0 新增向导：逐级展开）
  var wizardData = null;     // 暂存正在创建的记录 {channel}

  function loadCounts() {
    try { var o = JSON.parse(localStorage.getItem(STORE_KEY_COUNT)); return (o && typeof o === "object") ? o : {}; }
    catch (e) { return {}; }
  }
  function saveCounts() {
    try { localStorage.setItem(STORE_KEY_COUNT, JSON.stringify(counts)); }
    catch (e) { toast("无法保存计数：浏览器存储不可用"); }
  }
  function loadCountMode() {
    try {
      var m = localStorage.getItem(STORE_KEY_MODE);
      return (m === "detail" || m === "ledger" || m === "collect" || m === "simple") ? m : "collect";
    }
    catch (e) { return "collect"; }
  }
  function saveCountMode() {
    try { localStorage.setItem(STORE_KEY_MODE, countMode); } catch (e) {}
  }
  function loadArrangeMode() {
    try { return localStorage.getItem(STORE_KEY_ARRANGE) === "collectedFirst" ? "collectedFirst" : "default"; }
    catch (e) { return "default"; }
  }
  function saveArrangeMode() {
    try { localStorage.setItem(STORE_KEY_ARRANGE, arrangeMode); } catch (e) {}
  }
  function readCount(id) {
    var c = counts[id];
    if (!c) return { simple: { ordered: 0, transit: 0, arrived: 0 }, detail: [], ledger: [], collect: 0 };
    return { simple: c.simple || { ordered: 0, transit: 0, arrived: 0 }, detail: c.detail || [], ledger: c.ledger || [], collect: (c.collect || 0) };
  }
  function ensureCount(id) {
    if (!counts[id]) counts[id] = { simple: { ordered: 0, transit: 0, arrived: 0 }, detail: [], ledger: [], collect: 0 };
    else {
      if (!counts[id].ledger) counts[id].ledger = [];
      if (counts[id].collect == null) counts[id].collect = 0;
    }
    return counts[id];
  }
  function simpleTotal(id) { var s = readCount(id).simple; return s.ordered + s.transit + s.arrived; }
  function detailCount(id) {
    /* 详细版1.0「已拥有」= 各记录卡片数量之和（合并后单条记录可含多张） */
    return readCount(id).detail.reduce(function (s, en) { return s + (en.qty || 1); }, 0);
  }
  function ledgerCount(id) { return (readCount(id).ledger || []).length; }
  function cardTotal(id) {
    if (countMode === "ledger") return ledgerCount(id);
    if (countMode === "collect") return (readCount(id).collect || 0);
    return countMode === "simple" ? simpleTotal(id) : detailCount(id);
  }
  /* 计数显示封顶：超过 99 显示 99+（+ 以上标形式贴在数字右上角）；原始数据不截断 */
  var COUNT_CAP = 99;
  function countCapped(n) { return n > COUNT_CAP; }
  function formatCountText(n) { return countCapped(n) ? COUNT_CAP + "+" : String(n); }
  function formatCountHtml(n) {
    return countCapped(n) ? COUNT_CAP + '<sup class="count-plus">+</sup>' : String(n);
  }
  /* 简洁版（收集模式）：点击卡面 +1 / 删除一张 / 清空记录 */
  function bumpCollect(id, delta) {
    var o = ensureCount(id);
    o.collect = Math.max(0, (o.collect || 0) + delta);
    saveCounts();
    updateCardBadge(id);
  }
  function clearCollect(id) {
    var o = ensureCount(id);
    o.collect = 0;
    saveCounts();
    updateCardBadge(id);
  }

  /* 取记录当前选中的物流阶段名（无选中返回 null） */
  function selectedStageName(en) {
    if (!en.stages) return null;
    for (var i = 0; i < en.stages.length; i++) if (en.stages[i].on) return en.stages[i].name;
    return null;
  }
  /* 找出与 idx 记录（渠道 + 方式 + 进度阶段）完全相同的其他记录下标 */
  function findMergeTargets(detail, idx) {
    var en = detail[idx], name = selectedStageName(en);
    if (!name) return [];
    var res = [];
    for (var i = 0; i < detail.length; i++) {
      if (i === idx) continue;
      var o2 = detail[i];
      if (o2.channel === en.channel && o2.sub === en.sub && selectedStageName(o2) === name) res.push(i);
    }
    return res;
  }
  /* 自定义合并确认弹窗（粉色主题） */
  function mergeConfirm(message, onYes) {
    var mask = document.createElement("div");
    mask.className = "merge-mask";
    mask.innerHTML = '<div class="merge-box"><p>' + message.replace(/\n/g, "<br>") +
      '</p><div class="merge-actions"><button type="button" class="merge-cancel">取消</button>' +
      '<button type="button" class="merge-ok">确定合并</button></div></div>';
    document.body.appendChild(mask);
    function close(yes) { if (mask.parentNode) mask.parentNode.removeChild(mask); onYes(yes); }
    mask.querySelector(".merge-cancel").addEventListener("click", function () { close(false); });
    mask.querySelector(".merge-ok").addEventListener("click", function () { close(true); });
    mask.addEventListener("click", function (e) { if (e.target === mask) close(false); });
  }

  /* ---------- 计数弹窗 DOM ---------- */
  var countModal = $("countModal"),
      countBigImg = $("countBigImg"),
      countBigBadge = $("countBigBadge"),
      countBigName = $("countBigName"),
      countRight = $("countRight");

  function openCountModal(id) {
    currentCountId = id;
    wizardStep = null; wizardData = null;
    var card = null;
    getAllCards().forEach(function (c) { if (c.id === id) card = c; });
    if (!card) return;
    countBigImg.src = cardImg(card);
    countBigName.textContent = card.name;
    renderCountRight();
    updateCountBigBadge();
    countModal.hidden = false;
  }
  function closeCountModal() { countModal.hidden = true; currentCountId = null; }
  function updateCountBigBadge() {
    var t = cardTotal(currentCountId);
    if (t > 0) { countBigBadge.hidden = false; countBigBadge.innerHTML = formatCountHtml(t); }
    else countBigBadge.hidden = true;
  }
  function updateCardBadge(id) {
    var item = grid.querySelector('[data-id="' + id + '"]');
    if (!item) return;
    var total = cardTotal(id), b = item.querySelector(".count-badge");
    if (total > 0) {
      if (!b) { b = document.createElement("span"); b.className = "count-badge"; item.appendChild(b); }
      b.innerHTML = formatCountHtml(total);
    } else if (b) { b.remove(); }
    /* 卡面点亮：已收集 或 有计数记录（有记录即代表至少拥有 1 张） */
    item.classList.toggle("collected", collected.has(id) || total > 0);
  }

  function renderCountRight() {
    var id = currentCountId, html = "";
    if (countMode === "simple") {
      var s = readCount(id).simple;
      html += '<div class="count-mode-tag">简洁版</div><div class="opt-list">';
      SIMPLE_STAGES.forEach(function (st) {
        var v = s[st[0]];
        html +=
          '<div class="opt-row" data-stage="' + st[0] + '">' +
            '<span class="opt-label">' + st[1] + "</span>" +
            (v > 0 ? '<span class="opt-badge">' + v + "</span>" : "") +
            '<div class="stepper">' +
              '<button type="button" class="step-minus" data-stage="' + st[0] + '" aria-label="减少">−</button>' +
              '<span class="step-num">' + v + "</span>" +
              '<button type="button" class="step-plus" data-stage="' + st[0] + '" aria-label="增加">+</button>' +
            "</div>" +
          "</div>";
      });
      html += "</div>";
    } else if (countMode === "detail") {
      var d = readCount(id).detail;
      /* 右上方：横长方形「新增一张卡片」按钮 + 逐级向导 */
      html += '<button type="button" class="add-card-btn" id="addCardCount">＋ 新增一张卡片</button>';
      if (wizardStep === "channel") {
        html += '<div class="wizard"><div class="wizard-head"><div class="wizard-title">① 选择购买渠道</div></div>' +
          '<div class="wizard-crumb">请选择购买渠道</div>' +
          '<div class="chan-tabs">' +
          '<button type="button" class="chan-tab" data-wchannel="海淘">海淘</button>' +
          '<button type="button" class="chan-tab" data-wchannel="国内">国内</button></div></div>';
      } else if (wizardStep === "sub") {
        html += '<div class="wizard"><div class="wizard-head">' +
          '<div class="wizard-title">② 选择海淘方式</div>' +
          '<button type="button" class="wizard-back" data-wback="1" aria-label="返回">←</button></div>' +
          '<div class="wizard-crumb">已选：海淘</div>' +
          '<div class="sub-tabs">' +
          '<button type="button" class="sub-tab" data-wsub="代购/跟团">代购 / 跟团</button>' +
          '<button type="button" class="sub-tab" data-wsub="海淘软件">海淘软件</button></div></div>';
      }
      /* 右下方：我的进度（横版一条条） */
      var totalQty = d.reduce(function (s, en) { return s + (en.qty || 1); }, 0);
      html += '<div class="record-title">我的进度（' + totalQty + ' 张）</div>';
      html += '<div class="record-rail">';
      if (d.length === 0) html += '<div class="record-empty">点上方「＋ 新增一张卡片」开始记录</div>';
      d.forEach(function (en, i) {
        html += '<div class="record-card">';
        html += '<div class="record-main">';
        html += '<div class="record-head"><span class="record-tag">' + en.channel + (en.sub ? " · " + en.sub : "") + '</span>' +
          '<button type="button" class="entry-del" data-idx="' + i + '" aria-label="删除">×</button></div>';
        if (en.channel === "海淘" && en.stages.length) {
          html += '<div class="record-stages">';
          en.stages.forEach(function (st, si) {
            html += '<button type="button" class="stage-chip' + (st.on ? " reached" : "") + '" data-idx="' + i + '" data-si="' + si + '">' + st.name + "</button>";
          });
          html += "</div>";
        } else {
          html += '<div class="sub-hint">国内渠道待定</div>';
        }
        html += "</div>";
        html += '<div class="record-meta"><span class="record-qty">数量 <b>' + (en.qty || 1) + '</b></span></div>';
        html += "</div>";
      });
      html += '</div>';
    } else {
      /* 详细版（原账本版，key=ledger）：左侧数字编号 + 购入价格录入 */
      var l = readCount(id).ledger || [];
      html += '<button type="button" class="add-card-btn" id="addCardCount">＋ 增加一张卡片</button>';
      html += '<div class="record-title">我的进度（' + l.length + ' 笔）</div>';
      /* 全部条目放进同一容器；≥3 条时整体可滑动，底部做渐隐遮罩 */
      function ledgerCard(en, i) {
        var no = (i + 1 < 10 ? "0" : "") + (i + 1);
        return '<div class="record-card ledger-entry">' +
          '<div class="ledger-no">' + no + '</div>' +
          '<div class="record-main">' +
            '<div class="record-head"><span class="record-tag">购入价格</span>' +
              '<button type="button" class="entry-del" data-idx="' + i + '" aria-label="删除">×</button></div>' +
            '<div class="ledger-price"><span class="yen">¥</span>' +
              '<input type="number" class="ledger-input" data-idx="' + i + '" value="' + (en.price ? en.price : "") + '" min="0" step="0.01" placeholder="0.00" inputmode="decimal"></div>' +
          '</div>' +
        '</div>';
      }
      html += '<div class="record-rail">';
      if (l.length === 0) html += '<div class="record-empty">点上方「＋ 增加一张卡片」开始记账</div>';
      for (var li = 0; li < l.length; li++) html += ledgerCard(l[li], li);
      html += '</div>';
    }
    /* 右下角合计：账本少于 3 笔时不显示上方分割线 */
    var ledgerN = (readCount(id).ledger || []).length;
    var noDivider = countMode === "ledger" && ledgerN < 3;
    html += '<div class="count-summary' + (noDivider ? ' no-divider' : '') + '">';
    if (countMode === "ledger") {
      var tp = (readCount(id).ledger || []).reduce(function (s, en) { return s + (Number(en.price) || 0); }, 0);
      html += '合计 <b id="ledgerTotal">¥' + tp.toFixed(2) + '</b>';
    } else {
      html += '合计 <b>' + formatCountHtml(cardTotal(id)) + '</b> 张';
    }
    html += '</div>';
    countRight.innerHTML = html;
    /* 进度列表完整展开，滚动交给外层 .count-modal-right，任意处滑动都能滚进度 */
  }

  /* 计数弹窗内的所有交互（事件委托） */
  countRight.addEventListener("click", function (e) {
    if (!currentCountId) return;
    var id = currentCountId, o = ensureCount(id);

    var plus = e.target.closest(".step-plus"), minus = e.target.closest(".step-minus");
    if (plus || minus) {
      var stg = (plus || minus).dataset.stage;
      o.simple[stg] = Math.max(0, o.simple[stg] + (plus ? 1 : -1));
      saveCounts(); renderCountRight(); updateCountBigBadge(); updateCardBadge(id);
      return;
    }
    if (e.target.closest("#addCardCount")) {
      if (countMode === "ledger") {
        o.ledger.push({ price: 0 });
        saveCounts(); renderCountRight(); updateCountBigBadge(); updateCardBadge(id);
      } else {
        /* 详细版1.0：展开 / 收起 逐级向导 */
        wizardStep = wizardStep ? null : "channel";
        wizardData = null;
        renderCountRight();
      }
      return;
    }
    var wch = e.target.closest("[data-wchannel]");
    if (wch) {
      if (wch.dataset.wchannel === "国内") {
        /* 国内：直接生成待定记录，结束向导 */
        o.detail.push({ channel: "国内", sub: null, stages: [], qty: 1 });
        wizardStep = null; wizardData = null;
        saveCounts(); renderCountRight(); updateCountBigBadge(); updateCardBadge(id);
      } else {
        wizardData = { channel: "海淘" };
        wizardStep = "sub";
        renderCountRight();
      }
      return;
    }
    var wback = e.target.closest("[data-wback]");
    if (wback) { wizardStep = "channel"; wizardData = null; renderCountRight(); return; }
    var wsub = e.target.closest("[data-wsub]");
    if (wsub) {
      var wsv = wsub.dataset.wsub;
      var wstgs = (DETAIL_PATHS[wsv] || []).map(function (s) { return { name: s, on: false }; });
      o.detail.push({ channel: "海淘", sub: wsv, stages: wstgs, qty: 1 });
      wizardStep = null; wizardData = null;
      saveCounts(); renderCountRight(); updateCountBigBadge(); updateCardBadge(id);
      return;
    }
    var chip = e.target.closest(".stage-chip");
    if (chip) {
      var en = o.detail[+chip.dataset.idx], si = +chip.dataset.si;
      if (en) {
        var wasOn = en.stages[si].on;
        en.stages.forEach(function (s) { s.on = false; });   // 单选：选中一个，其余取消
        if (!wasOn) en.stages[si].on = true;                 // 再次点同一项可取消
        saveCounts();
        /* 若与已有记录（渠道+方式+进度阶段）完全相同，提示是否合并 */
        var targets = [];
        if (en.stages[si].on) targets = findMergeTargets(o.detail, +chip.dataset.idx);
        if (targets.length) {
          var dupQty = targets.reduce(function (s, ti) { return s + (o.detail[ti].qty || 1); }, 0);
          var label = en.channel + (en.sub ? " · " + en.sub : "") + " · " + en.stages[si].name;
          mergeConfirm(
            "检测到 " + targets.length + " 条进度完全相同的记录（" + label + "，已拥有 " + dupQty + " 张）。\n是否合并为一条记录？",
            function (yes) {
              if (yes) {
                targets.sort(function (a, b) { return b - a; });
                targets.forEach(function (ti) {
                  en.qty = (en.qty || 1) + (o.detail[ti].qty || 1);
                  o.detail.splice(ti, 1);
                });
                saveCounts();
                toast("已合并为 1 条（共 " + (en.qty || 1) + " 张）");
              }
              renderCountRight(); updateCountBigBadge(); updateCardBadge(id);
            }
          );
          return;
        }
        renderCountRight(); updateCountBigBadge(); updateCardBadge(id);
      }
      return;
    }
    var del = e.target.closest(".entry-del");
    if (del) {
      var idx = +del.dataset.idx;
      if (countMode === "ledger") {
        if (o.ledger[idx] != null) { o.ledger.splice(idx, 1); saveCounts(); renderCountRight(); updateCountBigBadge(); updateCardBadge(id); }
      } else if (o.detail[idx]) {
        o.detail.splice(idx, 1); saveCounts(); renderCountRight(); updateCountBigBadge(); updateCardBadge(id);
      }
      return;
    }
  });

  /* 详细版（原账本版）：价格输入即时更新合计（不整块重渲染，避免输入框失焦） */
  countRight.addEventListener("input", function (e) {
    var inp = e.target.closest(".ledger-input");
    if (!inp || !currentCountId) return;
    var id = currentCountId, o = ensureCount(id);
    var idx = +inp.dataset.idx;
    if (!o.ledger || !o.ledger[idx]) return;
    o.ledger[idx].price = parseFloat(inp.value) || 0;
    saveCounts();
    var tp = (o.ledger || []).reduce(function (s, en) { return s + (Number(en.price) || 0); }, 0);
    var el = countRight.querySelector("#ledgerTotal");
    if (el) el.textContent = "¥" + tp.toFixed(2);
  });

  $("countModalClose").addEventListener("click", closeCountModal);
  countModal.addEventListener("click", function (e) { if (e.target === countModal) closeCountModal(); });

  /* ---------- 搜索 ---------- */
  $("search").addEventListener("input", function (e) {
    search = e.target.value.trim().toLowerCase();
    render();
  });

  /* ---------- 筛选面板开合 ---------- */
  var filterToggle = $("filterToggle");
  filterToggle.addEventListener("click", function () {
    var open = filterPanel.hidden;
    filterPanel.hidden = !open;
    filterToggle.setAttribute("aria-expanded", String(open));
  });

  /* ---------- 菜单 ---------- */
  var menuToggle = $("menuToggle"), siteMenu = $("siteMenu"), menuMask = $("menuMask"), menuCollapse = $("menuCollapse");
  function openMenu() {
    siteMenu.classList.add("open");
    menuMask.classList.add("show");
    menuToggle.classList.add("is-hidden");        /* 打开侧栏后 MENU 图标消失 */
    if (menuCollapse) menuCollapse.classList.add("show");
    menuToggle.setAttribute("aria-expanded", "true");
  }
  function closeMenu() {
    siteMenu.classList.remove("open");
    menuMask.classList.remove("show");
    menuToggle.classList.remove("is-hidden");     /* 回到主页面时图标恢复 */
    if (menuCollapse) menuCollapse.classList.remove("show");
    menuToggle.setAttribute("aria-expanded", "false");
  }
  menuToggle.addEventListener("click", function () {
    siteMenu.classList.contains("open") ? closeMenu() : openMenu();
  });
  /* 点击左侧非菜单栏处（遮罩）→ 收起侧栏，回到主页面 */
  menuMask.addEventListener("click", closeMenu);
  /* 侧栏左侧中部的右箭头按钮 → 同样收起侧栏 */
  if (menuCollapse) menuCollapse.addEventListener("click", closeMenu);

  /* ---------- 模态框 ---------- */
  var modalMask = $("modalMask"), modalTitle = $("modalTitle"), modalBody = $("modalBody");
  var MODALS = {
    about: {
      title: "关于本站",
      html: "<p class=\"about-p\">本站系利用个人业余时间开发并维护，难免存在疏漏之处，内容更新亦可能不够及时，敬请广大用户谅解。</p>" +
            "<p class=\"about-p\">如您在使用过程中发现图片显示异常、页面功能故障或其他问题，欢迎通过下方联系方式予以反馈，我将第一时间核实并修正。</p>" +
            "<p class=\"about-p\">您的每一条意见与建议，都是本站持续改进的重要依据，也将帮助更多用户获得更加顺畅的使用体验。感谢您的监督与指正！</p>" +
            "<div class=\"contact-block\">" +
              "<p class=\"contact-title\">联系方式：</p>" +
              "<p class=\"contact-line\">邮箱：1294768994@qq.com <button type=\"button\" class=\"contact-copy\" data-copy=\"1294768994@qq.com\">复制</button></p>" +
              "<p class=\"contact-line\">qq：1294768994 <button type=\"button\" class=\"contact-copy\" data-copy=\"1294768994\">复制</button></p>" +
              "<p class=\"contact-line\">小红书号：336680952 <button type=\"button\" class=\"contact-copy\" data-copy=\"336680952\">复制</button></p>" +
            "</div>"
    },
    howto: {
      title: "使用说明",
      html: "<h3>① 收集 / 取消</h3><p>简洁版：单击任意卡片即可切换「未收集 ↔ 已收集」。右上角计数+1。<br>详细版：单击卡片点亮。点击右下详情按钮增加已收集卡片状态</p>" +
            "<h3>② 筛选</h3><p>点顶部「筛选」展开面板，按 <strong>类型 / 稀有 / 类别 / 品牌</strong> 多选组合，按 <strong>显示</strong> 单选常规卡 / 平行卡 / 全部。</p>" +
            "<h3>③ 搜索</h3><p>搜索框可匹配卡片名称与品牌。</p>" +
            "<h3>④ 保存为图片</h3><p>把当前<strong>已点亮（已收集）</strong>的卡面含已收集数量自动按系列分组、拼成一张 PNG 拼图并下载，方便分享或存档。</p>"
    },
    data: {
      title: "数据管理",
      html: "<p>收集状态与计数记录都仅保存在本机浏览器，不会上传任何服务器。</p>" +
            "<div class=\"data-btns\">" +
            "<button type=\"button\" class=\"btn\" data-dm=\"export\">导出备份</button>" +
            "<button type=\"button\" class=\"btn\" data-dm=\"import\">导入备份</button>" +
            "<input type=\"file\" id=\"dmFile\" accept=\"application/json,.json\" hidden>" +
            "</div>" +
            "<ul class=\"data-list\">" +
            "<li><strong>导出备份</strong>：把当前收集进度、计数记录、计数方式与排列设置打包成一个 JSON 文件下载到本地，换设备或清缓存前可留底。</li>" +
            "<li><strong>导入备份</strong>：选择一个之前导出的 JSON 文件，覆盖恢复进度（恢复后会自动刷新页面）。</li>" +
            "</ul>" +
            "<p class=\"data-tip\">提示：换浏览器或清除站点数据会丢失进度，建议定期导出备份。</p>"
    },
    disclaimer: {
      title: "免责声明",
      html: "<ol class=\"disclaimer-list\">" +
        "<li>本站是粉丝自发搭建的非营利、非官方的兴趣站点，仅用于偶像活动系列爱好者资料查阅、收藏交流。</li>" +
        "<li>网站内出现的动画截图、卡牌图、官方插画、宣传图、文字资料等素材，著作权归 BNP、BANDAI、DENTSU、TV TOKYO、BNArts 等《アイカツ！》对应版权方所有。</li>" +
        "<li>如版权方或权利人对本站素材使用有异议，请通过本站联系方式告知，收到通知后我们将尽快移除相关内容。</li>" +
        "<li>访客从本站获取素材后自行转载、二次使用产生的一切后果，由使用人自行承担，本站不承担相关责任。</li>" +
        "<li>本站整理的文字、图鉴排版内容，未经许可禁止擅自打包<button type=\"button\" class=\"hidden-entry\" data-modal=\"secret\">转载</button>。</li>" +
        "</ol>"
    },
    changelog: {
      title: "更新公告",
      html: "<div class=\"changelog-item\">" +
        "<div class=\"changelog-date\">2026 / 11 / 24</div>" +
        "<p>更新了占位符逻辑和优化了加载速度</p>" +
        "</div>" +
        "<div class=\"changelog-item\">" +
        "<div class=\"changelog-date\">2026 / 11 / 17</div>" +
        "<p>更新了统计方式的逻辑。</p>" +
        "</div>"
    },
    secret: {
      title: "更多功能",
      html: "<p class=\"secret-tip\">管理员正在修改bug，建议不要使用</p>" +
        "<div class=\"secret-list\">" +
        "<button type=\"button\" class=\"secret-opt\" data-secret=\"add\">添加卡片</button>" +
        "<button type=\"button\" class=\"secret-opt\" data-secret=\"simple\">简洁版1.0</button>" +
        "<button type=\"button\" class=\"secret-opt\" data-secret=\"detail\">详细版1.0</button>" +
        "<button type=\"button\" class=\"secret-opt\" data-secret=\"data\">数据管理</button>" +
        "</div>"
    }
  };
  function buildCountMethodHtml() {
    return "<div class=\"stats-section\">" +
      "<h3 class=\"stats-h\">计数方式</h3>" +
      "<p class=\"stats-desc\">第一次用？10秒选好计数方式</p>" +
      "<div class=\"mode-opts\">" +
        "<button type=\"button\" class=\"mode-opt" + (countMode === "collect" ? " active" : "") + "\" data-countmode=\"collect\">简洁版</button>" +
        "<button type=\"button\" class=\"mode-opt" + (countMode === "ledger" ? " active" : "") + "\" data-countmode=\"ledger\">详细版</button>" +
      "</div>" +
      "<p class=\"stats-note\">" +
      "简洁版：轻触点亮卡片、数字 +1；点击右下角可以删除记录。<span class=\"note-em\">最推荐！</span><br>" +
      "详细版：方便的记录每张卡的购入价格。<span class=\"note-em\">适合想记录花销的用户。</span></p>" +
      "</div>";
  }
  function buildArrangeMethodHtml() {
    return "<div class=\"stats-section\">" +
      "<h3 class=\"stats-h\">排列方式</h3>" +
      "<p class=\"stats-desc\">选择卡片排列方式：</p>" +
      "<div class=\"mode-opts\">" +
        "<button type=\"button\" class=\"mode-opt" + (arrangeMode === "default" ? " active" : "") + "\" data-arrange=\"default\">默认图鉴排序</button>" +
        "<button type=\"button\" class=\"mode-opt" + (arrangeMode === "collectedFirst" ? " active" : "") + "\" data-arrange=\"collectedFirst\">已获得卡片优先</button>" +
      "</div>" +
      "<p class=\"stats-note\">" +
      "默认图鉴排序：按卡片编号顺序排列。<br>已获得卡片优先：已点亮的卡片在保持编号顺序的前提下靠前显示。</p>" +
      "</div>";
  }
  function buildStatsMethodHtml() {
    return buildCountMethodHtml() + buildArrangeMethodHtml() +
      "<div class=\"stats-bottom-space\" aria-hidden=\"true\"></div>";
  }
  function openModal(key) {
    if (key === "statsMethod") {
      modalTitle.textContent = "统计方式";
      modalBody.innerHTML = buildStatsMethodHtml();
      modalMask.hidden = false;
      return;
    }
    if (key === "countMethod") {
      modalTitle.textContent = "计数方法";
      modalBody.innerHTML = buildCountMethodHtml();
      modalMask.hidden = false;
      return;
    }
    if (key === "arrangeMethod") {
      modalTitle.textContent = "排列方式";
      modalBody.innerHTML = buildArrangeMethodHtml();
      modalMask.hidden = false;
      return;
    }
    var m = MODALS[key]; if (!m) return;
    modalTitle.textContent = m.title;
    modalBody.innerHTML = m.html;
    modalMask.hidden = false;
  }
  function closeModal() { modalMask.hidden = true; }
  Array.prototype.forEach.call(document.querySelectorAll("[data-modal]"), function (link) {
    link.addEventListener("click", function () {
      closeMenu();
      if (link.dataset.modal === "add") { openAdd(); return; }
      openModal(link.dataset.modal);
    });
  });
  $("modalClose").addEventListener("click", closeModal);
  modalMask.addEventListener("click", function (e) { if (e.target === modalMask) closeModal(); });

  /* 计数方法 / 排列方式 面板：模式切换 */
  modalBody.addEventListener("click", function (e) {
    var st = e.target.closest("[data-staff-toggle]");
    if (st) {
      var body = st.parentElement.querySelector(".staff-body");
      if (body) {
        var collapsed = body.classList.toggle("collapsed");
        st.setAttribute("aria-expanded", collapsed ? "false" : "true");
      }
      return;
    }
    var m = e.target.closest("[data-countmode]");
    if (m) {
      countMode = m.dataset.countmode;
      saveCountMode();
      Array.prototype.forEach.call(modalBody.querySelectorAll("[data-countmode]"), function (x) {
        x.classList.toggle("active", x === m);
      });
      var label = countMode === "collect" ? "简洁版" : countMode === "simple" ? "简洁版1.0" : countMode === "detail" ? "详细版1.0" : "详细版";
      toast("已切换为「" + label + "」");
      render();   // 卡片角标数字随模式变化
      return;
    }
    var a = e.target.closest("[data-arrange]");
    if (a) {
      arrangeMode = a.dataset.arrange;
      saveArrangeMode();
      Array.prototype.forEach.call(modalBody.querySelectorAll("[data-arrange]"), function (x) {
        x.classList.toggle("active", x === a);
      });
      toast("已切换为「" + (arrangeMode === "default" ? "默认图鉴排序" : "已获得卡片优先") + "」");
      render();
      return;
    }
    var dm = e.target.closest("[data-dm]");
    if (dm) {
      if (dm.dataset.dm === "export") { exportProgress(); }
      else if (dm.dataset.dm === "import") { var fi = $("dmFile"); if (fi) fi.click(); }
      return;
    }
    var cp = e.target.closest("[data-copy]");
    if (cp) {
      copyText(cp.getAttribute("data-copy"));
      return;
    }
    /* 免责声明「转载」隐藏入口：打开更多功能弹窗 */
    var hiddenEntry = e.target.closest("[data-modal]");
    if (hiddenEntry) {
      openModal(hiddenEntry.getAttribute("data-modal"));
      return;
    }
    /* 隐藏弹窗里的三个选项：复用原有功能 */
    var sec = e.target.closest("[data-secret]");
    if (sec) {
      var kind = sec.getAttribute("data-secret");
      if (kind === "add") { closeModal(); openAdd(); return; }
      if (kind === "data") { openModal("data"); return; }
      if (kind === "simple" || kind === "detail") {
        var secName = kind === "simple" ? "简洁版1.0" : "详细版1.0";
        closeModal();
        countMode = kind;
        saveCountMode();
        toast("已切换为「" + secName + "」");
        render();
        return;
      }
    }
  });

  /* 复制文本到剪贴板：优先 Clipboard API，失败降级 execCommand（兼容 http 本地环境） */
  function copyText(text) {
    function done() { toast("已复制：" + text); }
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (err) { ok = false; }
      document.body.removeChild(ta);
      if (ok) done(); else toast("复制失败，请手动复制");
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else {
      fallback();
    }
  }

  /* 数据管理弹窗内的「导入备份」文件选择 */
  modalBody.addEventListener("change", function (e) {
    if (e.target && e.target.id === "dmFile") {
      var f = e.target.files && e.target.files[0];
      if (f) importProgress(f);
      e.target.value = "";   // 允许重复选择同一文件
    }
  });

  /* ---------- 备份：导出 / 导入 JSON ---------- */
  function exportProgress() {
    var data = {
      app: "aikatsu-encore-collect",
      version: 1,
      exportedAt: new Date().toISOString(),
      collected: Array.from(collected),
      userCards: userCards,
      counts: counts,
      countMode: countMode,
      arrangeMode: arrangeMode
    };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "aikatsu-encore-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast("已导出备份文件");
  }
  function importProgress(file) {
    var reader = new FileReader();
    reader.onload = function (ev) {
      try {
        var data = JSON.parse(ev.target.result);
        if (!data || typeof data !== "object") throw new Error("文件内容不是有效备份");
        if (Array.isArray(data.collected))     localStorage.setItem(STORE_KEY, JSON.stringify(data.collected));
        if (Array.isArray(data.userCards))     localStorage.setItem(USER_KEY, JSON.stringify(data.userCards));
        if (data.counts && typeof data.counts === "object") localStorage.setItem(STORE_KEY_COUNT, JSON.stringify(data.counts));
        if (typeof data.countMode === "string") localStorage.setItem(STORE_KEY_MODE, data.countMode);
        if (typeof data.arrangeMode === "string") localStorage.setItem(STORE_KEY_ARRANGE, data.arrangeMode);
        toast("导入成功，正在刷新…");
        setTimeout(function () { location.reload(); }, 600);
      } catch (err) {
        toast("导入失败：" + (err && err.message ? err.message : "文件格式错误"));
      }
    };
    reader.onerror = function () { toast("导入失败：无法读取文件"); };
    reader.readAsText(file);
  }

  /* ---------- 保存为图片：只导出已点亮的卡面，按系列整理成拼图 ---------- */
  function loadImg(src) {
    return new Promise(function (resolve) {
      var im = new Image();
      im.onload = function () { resolve(im); };
      im.onerror = function () { resolve(null); };
      im.src = src;
    });
  }
  function exportCollectedImage() {
    var got = getAllCards().filter(function (c) { return collected.has(c.id) || cardTotal(c.id) > 0; });
    if (!got.length) { toast("还没有已点亮的卡片"); return; }
    toast("正在合成图片…");

    var n = got.length;
    // 列数随数量自适应（卡面偏瘦长，列数不宜过多）
    var cols = n <= 2 ? n : (n <= 6 ? 3 : (n <= 12 ? 4 : (n <= 30 ? 5 : 6)));
    var CW = 210, CH = Math.round(CW * 670 / 460);
    var GAP = 12, PAD = 24, HEADER_H = 114, GROUP_H = 38, RADIUS = 12;
    var SITE_URL = "https://aikatsuencore-cn-collection.github.io";

    // 按系列分组（保持 CARDS 中出现顺序）
    var groups = [];
    getAllCards().forEach(function (c) {
      if (c.group && groups.indexOf(c.group) === -1) groups.push(c.group);
    });
    groups.push("未分组");
    var map = {};
    groups.forEach(function (g) { map[g] = []; });
    got.forEach(function (c) {
      (map[c.group] || map["未分组"]).push(c);
    });

    var rowsTotal = 0;
    groups.forEach(function (g) {
      var cnt = map[g].length;
      if (cnt) rowsTotal += Math.ceil(cnt / cols);
    });
    var gridW = PAD * 2 + cols * CW + (cols - 1) * GAP;
    // 与下方绘制逐组消耗的空间完全一致：标题(GROUP_H+GAP) + 卡块 + 组尾(GAP*2)
    var contentH = 0;
    groups.forEach(function (g) {
      var cnt = map[g].length;
      if (!cnt) return;
      var rowsUsed = Math.ceil(cnt / cols);
      contentH += GROUP_H + GAP + rowsUsed * CH + (rowsUsed - 1) * GAP + GAP * 2;
    });
    // 网址固定 24px 显示：画布至少撑宽到能完整放下网址；卡面内容仍靠左，不受画布变宽影响
    var measureCtx = document.createElement("canvas").getContext("2d");
    measureCtx.font = "24px sans-serif";
    var urlTextW = measureCtx.measureText(SITE_URL).width;
    var W = Math.max(gridW, Math.ceil(urlTextW) + PAD * 2);
    var H = PAD + HEADER_H + contentH + PAD;

    var scale = 2;
    if (H * scale > 16000) scale = 16000 / H;   // 防止超出画布高度上限
    var canvas = document.createElement("canvas");
    canvas.width = Math.round(W * scale);
    canvas.height = Math.round(H * scale);
    var ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);

    // 背景
    var bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#fff3fa");
    bg.addColorStop(1, "#ffe6f3");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // 标题区：主标题 → 网址 → 已点亮数量
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillStyle = "#d63384";
    ctx.font = "bold 30px sans-serif";
    ctx.fillText("偶像活动！安可 收集册", PAD, PAD + 20);
    // 网址：固定 24px，画布已撑宽保证完整显示
    ctx.fillStyle = "#a05a86";
    ctx.font = "24px sans-serif";
    ctx.fillText(SITE_URL, PAD, PAD + 56);
    ctx.fillStyle = "#a05a86";
    ctx.font = "20px sans-serif";
    ctx.fillText("已点亮 " + n + " 张卡面", PAD, PAD + 90);

    function roundImg(img, x, y, w, h, r) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
      ctx.clip();
      if (img) ctx.drawImage(img, x, y, w, h);
      else { ctx.fillStyle = "#ffd6ec"; ctx.fillRect(x, y, w, h); }
      ctx.restore();
      ctx.strokeStyle = "rgba(214,51,132,0.30)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
      ctx.stroke();
    }

    /* 在卡面右上角画持有数量角标，样式对齐页面 .count-badge（粉底白字 + 加号上标） */
    function drawCountBadge(total, x, y) {
      var text = formatCountText(total);           // 已封顶："99+" 或数字
      var hasPlus = text.indexOf("+") !== -1;
      var mainText = hasPlus ? text.slice(0, -1) : text;
      var fontMain = "bold 22px sans-serif", fontPlus = "bold 14px sans-serif";
      ctx.textBaseline = "middle";
      ctx.font = fontMain;
      var mw = ctx.measureText(mainText).width;
      ctx.font = fontPlus;
      var pw = hasPlus ? ctx.measureText("+").width : 0;
      var inset = 10, padX = 11, badgeH = 34;
      var badgeW = Math.max(badgeH, Math.round(mw + pw + padX * 2));
      var bx = x + CW - inset - badgeW, by = y + inset, r = badgeH / 2;
      ctx.beginPath();
      ctx.moveTo(bx + r, by);
      ctx.arcTo(bx + badgeW, by, bx + badgeW, by + badgeH, r);
      ctx.arcTo(bx + badgeW, by + badgeH, bx, by + badgeH, r);
      ctx.arcTo(bx, by + badgeH, bx, by, r);
      ctx.arcTo(bx, by, bx + badgeW, by, r);
      ctx.closePath();
      ctx.fillStyle = "#e85b9d";
      ctx.fill();
      ctx.fillStyle = "#fff";
      var contentW = mw + pw, sx = bx + (badgeW - contentW) / 2, midY = by + badgeH / 2;
      ctx.textAlign = "left";
      ctx.font = fontMain;
      ctx.fillText(mainText, sx, midY + 1);
      if (hasPlus) { ctx.font = fontPlus; ctx.fillText("+", sx + mw, midY - 6); }
    }

    Promise.all(got.map(function (c) {
      return loadImg(cardImg(c)).then(function (im) { return { id: c.id, img: im }; });
    })).then(function (loaded) {
      var byId = {};
      loaded.forEach(function (o) { byId[o.id] = o.img; });

      var y = PAD + HEADER_H;
      groups.forEach(function (g) {
        var arr = map[g];
        if (!arr.length) return;
        ctx.fillStyle = "#b8327f";
        ctx.font = "bold 19px sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(g, PAD, y + GROUP_H / 2);
        y += GROUP_H + GAP;
        arr.forEach(function (card, idx) {
          var col = idx % cols, row = Math.floor(idx / cols);
          var x = PAD + col * (CW + GAP);
          var cy = y + row * (CH + GAP);
          roundImg(byId[card.id], x, cy, CW, CH, RADIUS);
          var ct = cardTotal(card.id);
          if (ct > 0) drawCountBadge(ct, x, cy);
        });
        var rowsUsed = Math.ceil(arr.length / cols);
        y += rowsUsed * CH + (rowsUsed - 1) * GAP + GAP * 2;
      });

      try {
        var a = document.createElement("a");
        a.download = "aikatsu-encore-collected.png";
        a.href = canvas.toDataURL("image/png");
        a.click();
        toast("已保存为图片（" + n + " 张已点亮卡面）");
      } catch (err) {
        toast("导出失败：若用 file:// 直接打开会被浏览器限制，请用本地服务器访问");
      }
    }).catch(function () { toast("生成图片失败"); });
  }
  $("saveImg").addEventListener("click", exportCollectedImage);


  $("resetAll").addEventListener("click", function () {
    /* 判断是否有任何「标记」：已收集，或存在计数记录（简洁版三项计数 / 详细版我的进度） */
    var hasCollected = collected.size > 0;
    var hasCounts = Object.keys(counts).some(function (k) {
      var c = counts[k]; if (!c) return false;
      if ((c.collect || 0) > 0) return true;
      var s = c.simple || {};
      if ((s.ordered || 0) + (s.transit || 0) + (s.arrived || 0) > 0) return true;
      return Array.isArray(c.detail) && c.detail.length > 0;
    });
    if (!hasCollected && !hasCounts) { toast("当前没有任何已记录的卡片"); return; }
    if (confirm("确定清除所有标记吗？\n\n将清空：\n· 已点亮的卡面（恢复灰白）\n· 每张卡的计数记录与右上角数字（我的进度）\n\n此操作不可撤销。")) {
      collected.clear();          // 清除「已收集」标记 → 卡面恢复灰白
      counts = {};                // 清除所有计数记录 → 右上角数字清空、卡面灭灯
      saveCollected();
      saveCounts();
      render();                   // 全量重渲染：卡面变灰、数字消失、排列回到初始
      toast("已清除全部标记，回到初始状态");
    }
  });


  /* ---------- 添加卡片弹窗 ---------- */
  var addModal = $("addModal");
  var addForm = $("addCardForm");
  var addImg = $("addImg");
  var addImgPreview = $("addImgPreview");
  function openAdd() { addModal.hidden = false; }
  function closeAdd() {
    addModal.hidden = true;
    addForm.reset();
    addImgPreview.hidden = true;
    addImgPreview.removeAttribute("src");
  }
  $("addModalClose").addEventListener("click", closeAdd);
  $("addCancel").addEventListener("click", closeAdd);
  addModal.addEventListener("click", function (e) { if (e.target === addModal) closeAdd(); });

  addImg.addEventListener("change", function () {
    var f = addImg.files && addImg.files[0];
    if (!f) { addImgPreview.hidden = true; return; }
    var r = new FileReader();
    r.onload = function () { addImgPreview.src = r.result; addImgPreview.hidden = false; };
    r.readAsDataURL(f);
  });

  addForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var file = addImg.files && addImg.files[0];
    var build = function (imgData) {
      var card = {
        id: "u" + Date.now(),
        name: ($("addName").value.trim() || "未命名卡片"),
        type: $("addType").value,
        rarity: $("addRarity").value,
        category: $("addCategory").value,
        brand: $("addBrand").value,
        parallel: $("addParallel").value === "true",
        group: $("addGroup").value,
      };
      if (imgData) card.img = imgData;
      userCards.push(card);
      saveUserCards();
      closeAdd();
      render();
      toast("已添加卡片：" + card.name);
    };
    if (file) {
      var r = new FileReader();
      r.onload = function () { build(r.result); };
      r.onerror = function () { build(null); };
      r.readAsDataURL(file);
    } else { build(null); }
  });

  /* ---------- Toast ---------- */
  var toastEl = $("toast"), toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    requestAnimationFrame(function () { toastEl.classList.add("show"); });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove("show");
      setTimeout(function () { toastEl.hidden = true; }, 220);
    }, 1800);
  }

  /* ---------- 初始化 ---------- */
  // 从分享链接（?p=）恢复进度：合并进本地，不覆盖已有

  buildFilterPanel();
  buildGroupBar();
  render();
})();
