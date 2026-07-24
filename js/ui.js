/* ============================================================================
 * Quantum Capital — UI layer
 * Canvas board (fit / pinch-zoom / pan), command-center panels, bottom sheets,
 * decision modals, and turn flow. Desktop = 3-column; mobile = board hero +
 * bottom dock + collapsible sheets.
 * ==========================================================================*/
(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const money = (n) => '$' + Math.round(n).toLocaleString();
  const cellLabel = (p) => `${p.c + 1}${String.fromCharCode(65 + p.r)}`;

  let engine = null;
  let prevPrices = {};
  const AI_DELAY = 850;
  let animStart = performance.now();
  let armed = null;                 // touch: cell awaiting placement confirmation

  const isMobile = () => window.matchMedia('(max-width: 900px)').matches;
  const canvas = () => $('#board');
  const CELL = 52;                  // logical unit; board is drawn fit-to-container

  /* ================= SETUP ================= */
  function showSetup() {
    const ov = $('#overlay'); ov.className = 'overlay setup'; ov.innerHTML = '';
    const m = el('div', 'modal center-modal');
    m.appendChild(el('h2', null, 'Take the corner office'));
    m.appendChild(el('p', 'lede', 'Choose your CEO. Every executive has a passive edge and a personality that shapes how your rivals play. Found companies, corner industries, and engineer the mergers that make you the most powerful CEO on the board.'));

    let selected = CEOS[0].id;
    const grid = el('div', 'ceo-pick');
    CEOS.forEach((c) => {
      const o = el('div', 'ceo-opt' + (c.id === selected ? ' sel' : ''));
      o.innerHTML =
        `<div class="hd"><div class="e">${c.emoji}</div><div><div class="nm">${c.name}</div><div class="ti">${c.title}</div></div></div>
         <div class="ab">${c.blurb}</div>`;
      o.onclick = () => { selected = c.id; grid.querySelectorAll('.ceo-opt').forEach(x => x.classList.remove('sel')); o.classList.add('sel'); };
      grid.appendChild(o);
    });
    m.appendChild(grid);

    const row = el('div', 'setup-actions');
    row.appendChild(el('div', null, 'Rivals')).style.cssText = 'font-weight:700;font-size:13px;';
    const sel = el('select');
    [1, 2, 3].forEach(n => { const op = el('option', null, `${n} AI CEO${n > 1 ? 's' : ''}`); op.value = n; if (n === 2) op.selected = true; sel.appendChild(op); });
    const start = el('button', 'action', 'Enter the market →'); start.style.marginLeft = 'auto';
    start.onclick = () => startGame(selected, parseInt(sel.value, 10));
    row.append(sel, start);
    m.appendChild(row);
    m.appendChild(el('div', 'footnote', 'Async multiplayer, ranked seasons & cross-game Quantum Star rewards are on the roadmap — this build is the core loop vs. AI CEOs.'));

    ov.appendChild(m); ov.classList.add('show');
  }

  function startGame(humanCeo, aiCount) {
    const players = [{ name: 'You', isHuman: true, ceoId: humanCeo, color: PLAYER_COLORS[0] }];
    let ci = 1;
    const pool = CEOS.filter(c => c.id !== humanCeo); shuffle(pool);
    for (let i = 0; i < aiCount; i++) {
      const ceo = pool[i % pool.length];
      players.push({ name: ceo.name, isHuman: false, ceoId: ceo.id, color: PLAYER_COLORS[ci++ % PLAYER_COLORS.length] });
    }
    engine = new QuantumCapital({ players, onEvent: () => {}, onChange: render });
    prevPrices = {}; armed = null; resetView();
    closeSheets(); hideConfirm();
    $('#overlay').className = 'overlay';
    engine.beginTurn(); render(); scheduleAI();
  }

  /* ================= TURN ORCHESTRATION ================= */
  function scheduleAI() {
    if (engine.phase === 'gameover') { showGameOver(); return; }
    if (engine.player.isHuman) { render(); return; }
    setTimeout(() => { snapshotPrices(); engine.runAITurn(); render(); scheduleAI(); }, AI_DELAY);
  }
  function snapshotPrices() { prevPrices = {}; for (const ind of INDUSTRIES) prevPrices[ind.id] = engine.sharePrice(ind.id); }
  function humanEndTurn() { hideConfirm(); armed = null; snapshotPrices(); engine.endTurn(); render(); scheduleAI(); }

  /* ================= BOARD: view transform ================= */
  const view = { zoom: 1, panX: 0, panY: 0 };
  function resetView() { view.zoom = 1; view.panX = 0; view.panY = 0; }
  const boardW = () => COLS * CELL, boardH = () => ROWS * CELL;

  function viewTransform(w, h) {
    const bw = boardW(), bh = boardH();
    const scale = Math.min(w / bw, h / bh) * view.zoom;
    const sw = bw * scale, sh = bh * scale;
    let ox, oy;
    if (sw <= w) { view.panX = 0; ox = (w - sw) / 2; }
    else { const min = w - sw; ox = Math.min(0, Math.max(min, (w - sw) / 2 + view.panX)); view.panX = ox - (w - sw) / 2; }
    if (sh <= h) { view.panY = 0; oy = (h - sh) / 2; }
    else { const min = h - sh; oy = Math.min(0, Math.max(min, (h - sh) / 2 + view.panY)); view.panY = oy - (h - sh) / 2; }
    return { scale, ox, oy };
  }

  function sizeCanvas() {
    const cv = canvas();
    const w = cv.clientWidth || 320, h = cv.clientHeight || 240;
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    return { ctx: cv.getContext('2d'), w, h, dpr };
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function hex(h, a) { const n = parseInt(h.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; }

  function drawBoard() {
    const { ctx, w, h, dpr } = sizeCanvas();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const { scale, ox, oy } = viewTransform(w, h);
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, ox * dpr, oy * dpr);

    const t = (performance.now() - animStart) / 1000;
    const handSet = new Set(engine.player.isHuman && engine.phase === 'place'
      ? engine.player.hand.map(p => key(p.r, p.c)) : []);

    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const x = c * CELL, y = r * CELL, pad = 3, s = CELL - pad * 2;
      const v = engine.board[r][c];
      if (v === 'empty') {
        roundRect(ctx, x + pad, y + pad, s, s, 8);
        ctx.fillStyle = 'rgba(255,255,255,0.015)'; ctx.fill();
        ctx.strokeStyle = 'rgba(90,120,220,0.10)'; ctx.lineWidth = 1; ctx.stroke();
        if (handSet.has(key(r, c))) {
          const st = engine.tileState({ r, c });
          const pulse = 0.5 + 0.5 * Math.sin(t * 3);
          ctx.fillStyle = st === 'playable' ? `rgba(53,240,208,${0.25 + 0.4 * pulse})` : 'rgba(255,93,122,0.28)';
          ctx.beginPath(); ctx.arc(x + CELL / 2, y + CELL / 2, 5, 0, Math.PI * 2); ctx.fill();
        } else {
          ctx.fillStyle = 'rgba(120,140,200,0.14)';
          ctx.font = '9px ' + getMono(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(`${c + 1}${String.fromCharCode(65 + r)}`, x + CELL / 2, y + CELL / 2);
        }
        continue;
      }
      if (v === 'unincorp') {
        roundRect(ctx, x + pad, y + pad, s, s, 8);
        ctx.fillStyle = 'rgba(180,200,255,0.16)'; ctx.fill();
        ctx.strokeStyle = 'rgba(180,200,255,0.5)'; ctx.lineWidth = 1.2; ctx.stroke();
        ctx.beginPath(); ctx.arc(x + CELL / 2, y + CELL / 2, 4, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(220,230,255,0.8)'; ctx.fill();
        continue;
      }
      const co = engine.companies[v], col = co.industry.color;
      roundRect(ctx, x + pad, y + pad, s, s, 8);
      const g = ctx.createLinearGradient(x, y, x, y + CELL);
      g.addColorStop(0, hex(col, 0.9)); g.addColorStop(1, hex(col, 0.55));
      ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = hex(col, 1); ctx.lineWidth = 1.2;
      ctx.shadowColor = col; ctx.shadowBlur = 8; ctx.stroke(); ctx.shadowBlur = 0;
      ctx.font = '18px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(co.industry.emoji, x + CELL / 2, y + CELL / 2 + 1);
    }

    // Armed (confirm-pending) cell ghost.
    if (armed) {
      const x = armed.c * CELL, y = armed.r * CELL;
      const pulse = 0.5 + 0.5 * Math.sin(t * 6);
      roundRect(ctx, x + 3, y + 3, CELL - 6, CELL - 6, 8);
      ctx.fillStyle = `rgba(255,209,102,${0.25 + 0.35 * pulse})`; ctx.fill();
      ctx.strokeStyle = 'rgba(255,209,102,0.95)'; ctx.lineWidth = 2; ctx.stroke();
    }
    // Last-placed ring.
    if (engine.lastPlaced) {
      const { r, c } = engine.lastPlaced; const x = c * CELL, y = r * CELL;
      const pulse = 0.5 + 0.5 * Math.sin(t * 5);
      ctx.strokeStyle = `rgba(255,255,255,${0.4 + 0.5 * pulse})`; ctx.lineWidth = 2;
      roundRect(ctx, x + 2, y + 2, CELL - 4, CELL - 4, 9); ctx.stroke();
    }
    // Merge flash.
    if (engine.mergeFlash && engine.mergeFlash.length) {
      const age = (performance.now() - (engine._mergeFlashAt || 0)) / 1400;
      const a = Math.max(0, 1 - age);
      if (a > 0) for (const cell of engine.mergeFlash) {
        const x = cell.c * CELL, y = cell.r * CELL;
        roundRect(ctx, x + 3, y + 3, CELL - 6, CELL - 6, 8);
        ctx.fillStyle = `rgba(255,209,102,${0.5 * a})`; ctx.fill();
      }
    }
  }
  function getMono() { return "'SF Mono', ui-monospace, Menlo, monospace"; }

  /* ================= BOARD: interaction ================= */
  function hitCell(clientX, clientY) {
    const cv = canvas(); const rect = cv.getBoundingClientRect();
    const { scale, ox, oy } = viewTransform(rect.width, rect.height);
    const lx = (clientX - rect.left - ox) / scale, ly = (clientY - rect.top - oy) / scale;
    const c = Math.floor(lx / CELL), r = Math.floor(ly / CELL);
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return null;
    return { r, c };
  }

  function zoomAround(clientX, clientY, factor) {
    const cv = canvas(); const rect = cv.getBoundingClientRect(); const w = rect.width, h = rect.height;
    const before = viewTransform(w, h);
    const lx = (clientX - rect.left - before.ox) / before.scale, ly = (clientY - rect.top - before.oy) / before.scale;
    view.zoom = clamp(view.zoom * factor, 1, 3.6);
    const after = viewTransform(w, h);
    const sw = boardW() * after.scale, sh = boardH() * after.scale;
    view.panX = ((clientX - rect.left) - lx * after.scale) - (w - sw) / 2;
    view.panY = ((clientY - rect.top) - ly * after.scale) - (h - sh) / 2;
    viewTransform(w, h);
  }

  function setupBoardInput() {
    const cv = canvas();
    const ptrs = new Map(); let down = null; let lastDist = 0;
    const dist = () => { const p = [...ptrs.values()]; return Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y); };
    const mid = () => { const p = [...ptrs.values()]; return { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 }; };

    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 1) down = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
      else if (ptrs.size === 2) { lastDist = dist(); down = null; }
    });
    cv.addEventListener('pointermove', (e) => {
      if (!ptrs.has(e.pointerId)) return;
      const prev = ptrs.get(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size >= 2) { const d = dist(); if (lastDist) { const m = mid(); zoomAround(m.x, m.y, d / lastDist); } lastDist = d; }
      else if (ptrs.size === 1 && down) {
        const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
        if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10) down.moved = true;
        if (down.moved) { view.panX += dx; view.panY += dy; const r = cv.getBoundingClientRect(); viewTransform(r.width, r.height); }
      }
    });
    const end = (e) => {
      const wasSize = ptrs.size; ptrs.delete(e.pointerId);
      try { cv.releasePointerCapture(e.pointerId); } catch (_) {}
      if (wasSize === 1 && down && !down.moved) handleTap(down.x, down.y);
      if (ptrs.size < 2) lastDist = 0;
      if (ptrs.size === 1) { const p = [...ptrs.values()][0]; down = { x: p.x, y: p.y, t: performance.now(), moved: true }; }
      else if (ptrs.size === 0) down = null;
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('wheel', (e) => { e.preventDefault(); zoomAround(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 1 / 1.12); }, { passive: false });

    document.querySelectorAll('.zoom-ctl button').forEach(b => b.addEventListener('click', () => {
      const cx = cv.getBoundingClientRect(); const cxm = cx.left + cx.width / 2, cym = cx.top + cx.height / 2;
      if (b.dataset.zoom === 'in') zoomAround(cxm, cym, 1.35);
      else if (b.dataset.zoom === 'out') zoomAround(cxm, cym, 1 / 1.35);
      else resetView();
    }));
  }

  function handleTap(clientX, clientY) {
    if (!engine || engine.phase !== 'place' || !engine.player.isHuman || engine.pending) return;
    const cell = hitCell(clientX, clientY);
    if (!cell) return;
    const inHand = engine.player.hand.some(t => t.r === cell.r && t.c === cell.c);
    if (!inHand) { toast('You can only build on one of your operation tiles'); return; }
    if (engine.tileState(cell) !== 'playable') { toast('That placement is illegal here'); return; }
    if (isMobile()) armPlacement(cell); else doPlace(cell);
  }

  function armPlacement(pos) { armed = pos; showConfirm(pos); render(); }
  function doPlace(pos) {
    armed = null; hideConfirm();
    if (!engine.player.hand.some(t => t.r === pos.r && t.c === pos.c)) return;
    if (engine.tileState(pos) !== 'playable') { toast('That placement is illegal here'); return; }
    snapshotPrices(); engine._mergeFlashAt = performance.now();
    const done = engine.playTile(pos);
    if (done) render();
  }

  /* ================= CONFIRM BAR + TOAST ================= */
  function showConfirm(pos) {
    $('#cbCell').textContent = cellLabel(pos);
    $('#confirmBar').classList.add('show');
  }
  function hideConfirm() { $('#confirmBar').classList.remove('show'); }
  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 1700);
  }

  /* ================= SHEETS ================= */
  function openSheet(which) {
    closeSheets();
    $(which === 'market' ? '#sheetMarket' : '#sheetBoard').classList.add('open');
    $('#scrim').classList.add('show');
  }
  function closeSheets() {
    $('#sheetMarket').classList.remove('open'); $('#sheetBoard').classList.remove('open');
    $('#scrim').classList.remove('show');
  }

  /* ================= PANELS ================= */
  function render() {
    if (!engine) return;
    renderTop(); renderMarket(); renderCenter(); renderPlayers(); renderLog(); renderPending();
    // Keep the confirm bar honest.
    if (!(armed && engine.phase === 'place' && engine.player.isHuman && !engine.pending)) { armed = armed && engine.phase === 'place' ? armed : null; if (!armed) hideConfirm(); }
  }

  function renderTop() {
    $('#turnChip').innerHTML = `TURN <b>${engine.turnCount}</b>`;
    const you = engine.players.find(x => x.isHuman);
    const cash = money(you.cash), net = money(engine.netWorth(you));
    $('#cash').textContent = cash; $('#networth').textContent = net;
    $('#cash2').textContent = cash; $('#networth2').textContent = net;
  }

  function renderMarket() {
    const host = $('#marketList'); host.innerHTML = '';
    const active = engine.activeCompanies().sort((a, b) => b.cells.length - a.cells.length);
    const avail = engine.availableIndustries();
    const buyPhase = engine.phase === 'buy' && engine.player.isHuman;

    active.forEach(co => {
      const price = engine.sharePrice(co.id);
      const prev = prevPrices[co.id] ?? price;
      const dir = price > prev ? 'up' : (price < prev ? 'down' : '');
      const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '·';
      const mine = engine.player.shares[co.id]; const mult = engine.market[co.id];
      const canBuy = buyPhase && engine.canBuy(co.id);
      const row = el('div', 'co-row' + (canBuy ? ' buyable' : ''));
      row.innerHTML =
        `<div class="emoji">${co.industry.emoji}</div>
         <div><div class="nm">${co.industry.name}${co.safe ? '<span class="safe-tag">SAFE</span>' : ''}</div>
              <div class="sub">${co.cells.length} presence · ${co.sharesInBank} left · T${co.industry.tier}</div>
              <div class="mkt-bar"><i style="width:${clamp((mult - 0.4) / 1.8 * 100, 4, 100)}%;background:${co.industry.color}"></i></div></div>
         <div class="price ${dir}">${money(price)}<div class="sub ${dir}">${arrow} ×${mult.toFixed(2)}</div></div>
         <div class="mine">${mine ? mine + '📜' : ''}</div>`;
      if (canBuy) row.onclick = () => { engine.buyShare(co.id); render(); };
      host.appendChild(row);
    });

    if (avail.length) {
      const h = el('div'); h.style.cssText = 'margin:10px 0 4px;color:var(--text-dim);font-family:var(--mono);font-size:10px;';
      h.textContent = 'AVAILABLE TO FOUND'; host.appendChild(h);
      avail.forEach(ind => {
        const row = el('div', 'co-row'); row.style.opacity = '0.6';
        row.innerHTML = `<div class="emoji">${ind.emoji}</div>
           <div><div class="nm">${ind.name}</div><div class="sub">Tier ${ind.tier} · ${ind.behavior}</div></div>
           <div class="price sub">—</div><div class="mine"></div>`;
        host.appendChild(row);
      });
    }
  }

  function renderCenter() {
    const p = engine.player;
    let phaseText;
    if (engine.phase === 'place') phaseText = p.isHuman ? 'Place an operation' : `${p.name} is placing…`;
    else if (engine.phase === 'buy') phaseText = p.isHuman ? `Invest — ${engine.buysRemaining} buy${engine.buysRemaining !== 1 ? 's' : ''} left` : `${p.name} is investing…`;
    else phaseText = 'Market closed';
    $('#phaseNow').innerHTML = `<span class="dot" style="color:${p.color}"></span>${phaseText}`;
    $('#mbPhase').textContent = p.isHuman ? phaseText : `${p.name} — ${engine.phase === 'buy' ? 'investing' : 'placing'}…`;

    const hand = $('#hand'); hand.innerHTML = '';
    const controls = $('#controls'); controls.innerHTML = '';
    const hint = $('#dockHint'); if (hint) hint.style.display = (p.isHuman && engine.phase === 'place' && !engine.pending) ? '' : 'none';

    if (p.isHuman && engine.phase === 'place' && !engine.pending) {
      const playable = p.hand.filter(t => engine.tileState(t) === 'playable');
      p.hand.slice().sort((a, b) => (a.r - b.r) || (a.c - b.c)).forEach(t => {
        const dead = engine.tileState(t) !== 'playable';
        const armedTile = armed && armed.r === t.r && armed.c === t.c;
        const b = el('button', 'tile-btn' + (dead ? ' dead' : '') + (armedTile ? ' armed' : ''), cellLabel(t));
        if (!dead) b.onclick = () => { isMobile() ? armPlacement(t) : doPlace(t); }; else b.title = 'Illegal placement';
        hand.appendChild(b);
      });
      if (!playable.length) {
        const skip = el('button', 'action', 'No legal move — redraw & continue');
        skip.onclick = () => { engine.humanSkip(); render(); };
        controls.appendChild(skip);
      }
    } else if (p.isHuman && engine.phase === 'buy') {
      if (isMobile()) {
        const trade = el('button', 'ghost', '💹 Trade shares');
        trade.onclick = () => openSheet('market');
        controls.appendChild(trade);
      } else {
        const info = el('div', null, `Click a company at left to buy. <b style="color:var(--gold)">${engine.buysRemaining}</b> buys left.`);
        info.style.cssText = 'font-size:13px;color:var(--text-dim);align-self:center;';
        controls.appendChild(info);
      }
      const end = el('button', 'action', 'End turn →'); end.onclick = humanEndTurn;
      controls.appendChild(end);
    } else {
      const wait = el('div', null, `${p.name} is making moves…`);
      wait.style.cssText = 'font-size:13px;color:var(--text-dim);align-self:center;';
      controls.appendChild(wait);
    }
  }

  function renderPlayers() {
    const host = $('#players'); host.innerHTML = '';
    engine.players.forEach((p, i) => {
      const card = el('div', 'player-card' + (i === engine.current ? ' active' : ''));
      card.innerHTML =
        `<div class="ava">${p.ceo.emoji}</div>
         <div class="who"><div class="n">${p.name}${p.isHuman ? '<span class="you-tag">YOU</span>' : ''}</div>
           <div class="t">${p.ceo.title}</div></div>
         <div class="net">${money(engine.netWorth(p))}<small>${money(p.cash)} cash</small></div>`;
      host.appendChild(card);
    });
  }

  function renderLog() {
    const host = $('#log'); host.innerHTML = '';
    engine.log.forEach(e => {
      const row = el('div', 'log-entry ' + e.kind);
      row.innerHTML = `<span class="ic">${e.icon}</span><span class="tx">${e.text}</span>`;
      host.appendChild(row);
    });
  }

  /* ================= DECISION MODALS ================= */
  function renderPending() {
    const ov = $('#overlay');
    if (!engine.pending) { if (engine.phase !== 'gameover') { ov.className = 'overlay'; } return; }
    closeSheets(); hideConfirm();
    const pd = engine.pending; ov.className = 'overlay'; ov.innerHTML = '';
    const m = el('div', 'modal');
    if (pd.type === 'found') {
      m.appendChild(el('h2', null, 'Found a company'));
      m.appendChild(el('p', 'lede', `Your operations connected. Choose the industry for your new ${pd.cluster.length}-node company — you keep the founder shares.`));
      const grid = el('div', 'choice-grid');
      pd.options.forEach(ind => {
        const c = el('div', 'choice');
        c.innerHTML = `<div class="big">${ind.emoji}</div><div class="nm">${ind.name}</div><div class="meta">Tier ${ind.tier} · ${ind.behavior}</div>`;
        c.onclick = () => { pd.resolve(ind.id); render(); };
        grid.appendChild(c);
      });
      m.appendChild(grid);
    } else if (pd.type === 'survivor') {
      m.appendChild(el('h2', null, 'Choose the survivor'));
      m.appendChild(el('p', 'lede', 'The merging companies are the same size. Pick which one absorbs the others.'));
      const grid = el('div', 'choice-grid');
      pd.options.forEach(id => {
        const co = engine.companies[id];
        const c = el('div', 'choice');
        c.innerHTML = `<div class="big">${co.industry.emoji}</div><div class="nm">${co.industry.name}</div><div class="meta">${co.cells.length} presence · you hold ${engine.player.shares[id]}📜</div>`;
        c.onclick = () => { pd.resolve(id); render(); };
        grid.appendChild(c);
      });
      m.appendChild(grid);
    } else if (pd.type === 'disposition') {
      buildDisposition(m, pd);
    }
    ov.appendChild(m); ov.classList.add('show');
  }

  function buildDisposition(m, pd) {
    const co = engine.companies[pd.companyId], surv = engine.companies[pd.survivorId];
    m.appendChild(el('h2', null, `${co.industry.name} was acquired`));
    m.appendChild(el('p', 'lede',
      `You hold <b>${pd.held}📜</b> at ${money(pd.price)} each. Sell for cash, trade 2-for-1 into ${surv.industry.name}, or hold for a possible re-founding. Bonuses are already paid.`));

    let trade = 0;
    const maxTrade = Math.min(pd.held - (pd.held % 2), pd.survivorBank * 2);
    const tradeRow = el('div', 'dispo-row');
    tradeRow.appendChild(el('label', null, `Trade → ${surv.industry.emoji}`));
    const input = el('input'); input.type = 'range'; input.min = 0; input.max = maxTrade; input.step = 2; input.value = 0;
    const val = el('div', 'val'); tradeRow.append(input, val);

    const holdRow = el('div', 'dispo-row');
    holdRow.appendChild(el('label', null, 'Hold rest'));
    const holdChk = el('input'); holdChk.type = 'checkbox';
    const holdHint = el('div', null, 'Keep untraded shares (worthless unless re-founded)');
    holdHint.style.cssText = 'font-size:11px;color:var(--text-dim);';
    holdRow.append(holdChk, holdHint);

    const summary = el('div', 'dispo-summary');
    const confirm = el('button', 'action', 'Confirm');

    function refresh() {
      trade = Math.min(parseInt(input.value, 10) - (parseInt(input.value, 10) % 2), maxTrade);
      let sell = pd.held - trade, hold = 0;
      if (holdChk.checked) { hold = sell; sell = 0; }
      val.textContent = `${trade}📜`;
      const cash = sell * pd.price, got = trade / 2;
      summary.innerHTML = `Sell <b>${sell}</b> → ${money(cash)} · Trade <b>${trade}</b> → <b>${got}</b> ${surv.industry.name}📜 · Hold <b>${hold}</b>`;
      confirm.onclick = () => { pd.resolve({ sell, trade, hold }); render(); };
    }
    input.oninput = refresh; holdChk.onchange = refresh;
    m.append(tradeRow, holdRow, summary, confirm); refresh();
  }

  /* ================= GAME OVER ================= */
  function showGameOver() {
    closeSheets(); hideConfirm();
    const ov = $('#overlay'); ov.className = 'overlay'; ov.innerHTML = '';
    const m = el('div', 'modal');
    m.appendChild(el('h2', null, '🏁 The market has closed'));
    m.appendChild(el('p', 'lede', 'Final net worth after every company was liquidated and all majority/minority bonuses paid.'));
    const list = el('div', 'standings');
    engine.finalStandings.forEach((s, i) => {
      const row = el('div', 'stand-row' + (i === 0 ? ' win' : ''));
      row.innerHTML =
        `<div class="rank">${i === 0 ? '🏆' : '#' + (i + 1)}</div>
         <div class="e">${s.ceo.emoji}</div>
         <div class="info"><div class="n">${s.name}</div><div class="t">${s.ceo.title}</div></div>
         <div class="net">${money(s.net)}</div>`;
      list.appendChild(row);
    });
    m.appendChild(list);
    const again = el('button', 'action', 'Play again'); again.onclick = showSetup;
    m.appendChild(again);
    m.appendChild(el('div', 'footnote', 'This match would post to your Quantum Star profile in a live build — unlocking titles & cosmetics across the ecosystem.'));
    ov.appendChild(m); ov.classList.add('show');
  }

  /* ================= ANIMATION LOOP ================= */
  function loop() { if (engine) drawBoard(); requestAnimationFrame(loop); }

  /* ================= BOOT ================= */
  window.addEventListener('load', () => {
    setupBoardInput();
    // Mobile nav + sheet controls.
    document.querySelectorAll('.mb-btn').forEach(b => b.addEventListener('click', () => openSheet(b.dataset.open)));
    document.querySelectorAll('.sheet-grab').forEach(g => g.addEventListener('click', closeSheets));
    $('#scrim').addEventListener('click', closeSheets);
    $('#cbCancel').addEventListener('click', () => { armed = null; hideConfirm(); render(); });
    $('#cbPlace').addEventListener('click', () => { if (armed) doPlace(armed); });
    window.addEventListener('resize', () => { if (engine) render(); });
    window.addEventListener('orientationchange', () => { resetView(); if (engine) render(); });
    requestAnimationFrame(loop);
    showSetup();
  });
})();
