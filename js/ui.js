/* ============================================================================
 * Quantum Capital — UI layer
 * Canvas board, command-center panels, decision modals, and turn flow.
 * ==========================================================================*/
(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const money = (n) => '$' + Math.round(n).toLocaleString();
  const cellLabel = (p) => `${p.c + 1}${String.fromCharCode(65 + p.r)}`;

  let engine = null;
  let prevPrices = {};       // for up/down arrows
  const AI_DELAY = 850;      // ms between AI turns
  let animStart = performance.now();

  /* ================= SETUP ================= */
  function showSetup() {
    const ov = $('#overlay');
    ov.innerHTML = '';
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

    const row = el('div');
    row.style.cssText = 'display:flex;gap:10px;align-items:center;';
    const label = el('div', null, 'Rivals'); label.style.cssText = 'font-weight:700;font-size:13px;';
    const sel = el('select');
    sel.style.cssText = 'font-family:var(--mono);background:var(--panel-2);color:var(--text);border:1px solid var(--edge);border-radius:8px;padding:8px;';
    [1, 2, 3].forEach(n => { const op = el('option', null, `${n} AI CEO${n > 1 ? 's' : ''}`); op.value = n; if (n === 2) op.selected = true; sel.appendChild(op); });
    const start = el('button', 'action', 'Enter the market →');
    start.style.marginLeft = 'auto';
    start.onclick = () => startGame(selected, parseInt(sel.value, 10));
    row.append(label, sel, start);
    m.appendChild(row);
    m.appendChild(el('div', 'footnote', 'Async multiplayer, ranked seasons & cross-game Quantum Star rewards are on the roadmap — this build is the core loop vs. AI CEOs.'));

    ov.appendChild(m); ov.classList.add('show');
  }

  function startGame(humanCeo, aiCount) {
    const used = new Set([humanCeo]);
    const players = [{ name: 'You', isHuman: true, ceoId: humanCeo, color: PLAYER_COLORS[0] }];
    let ci = 1;
    const pool = CEOS.filter(c => c.id !== humanCeo);
    shuffle(pool);
    for (let i = 0; i < aiCount; i++) {
      const ceo = pool[i % pool.length];
      players.push({ name: ceo.name, isHuman: false, ceoId: ceo.id, color: PLAYER_COLORS[ci++ % PLAYER_COLORS.length] });
    }
    engine = new QuantumCapital({ players, onEvent: () => {}, onChange: render });
    prevPrices = {};
    $('#overlay').classList.remove('show');
    engine.beginTurn();
    render();
    scheduleAI();
  }

  /* ================= TURN ORCHESTRATION ================= */
  function scheduleAI() {
    if (engine.phase === 'gameover') { showGameOver(); return; }
    if (engine.player.isHuman) { render(); return; }
    setTimeout(() => {
      snapshotPrices();
      engine.runAITurn();
      render();
      scheduleAI();
    }, AI_DELAY);
  }

  function snapshotPrices() {
    prevPrices = {};
    for (const ind of INDUSTRIES) prevPrices[ind.id] = engine.sharePrice(ind.id);
  }

  function humanEndTurn() {
    snapshotPrices();
    engine.endTurn();
    render();
    scheduleAI();
  }

  /* ================= BOARD (canvas) ================= */
  const canvas = () => $('#board');
  const CELL = 52, PAD = 6;
  function sizeCanvas() {
    const cv = canvas();
    const w = COLS * CELL + PAD * 2, h = ROWS * CELL + PAD * 2;
    const dpr = window.devicePixelRatio || 1;
    cv.width = w * dpr; cv.height = h * dpr;
    cv.style.width = Math.max(320, Math.min(w, window.innerWidth - 700)) + 'px';
    cv.style.maxWidth = '100%';
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawBoard() {
    const ctx = sizeCanvas();
    const w = COLS * CELL + PAD * 2, h = ROWS * CELL + PAD * 2;
    ctx.clearRect(0, 0, w, h);
    const t = (performance.now() - animStart) / 1000;
    const handSet = new Set(engine.player.isHuman && engine.phase === 'place'
      ? engine.player.hand.map(p => key(p.r, p.c)) : []);

    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const x = PAD + c * CELL, y = PAD + r * CELL, pad = 3, s = CELL - pad * 2;
      const v = engine.board[r][c];

      if (v === 'empty') {
        roundRect(ctx, x + pad, y + pad, s, s, 8);
        ctx.fillStyle = 'rgba(255,255,255,0.015)'; ctx.fill();
        ctx.strokeStyle = 'rgba(90,120,220,0.10)'; ctx.lineWidth = 1; ctx.stroke();
        // Playable-from-hand marker.
        if (handSet.has(key(r, c))) {
          const st = engine.tileState({ r, c });
          const pulse = 0.5 + 0.5 * Math.sin(t * 3);
          ctx.fillStyle = st === 'playable'
            ? `rgba(53,240,208,${0.25 + 0.35 * pulse})`
            : 'rgba(255,93,122,0.28)';
          ctx.beginPath(); ctx.arc(x + CELL / 2, y + CELL / 2, 4, 0, Math.PI * 2); ctx.fill();
        } else {
          ctx.fillStyle = 'rgba(120,140,200,0.14)';
          ctx.font = '9px var(--mono)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
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

      // Company cell.
      const co = engine.companies[v];
      const col = co.industry.color;
      roundRect(ctx, x + pad, y + pad, s, s, 8);
      const g = ctx.createLinearGradient(x, y, x, y + CELL);
      g.addColorStop(0, hex(col, 0.9)); g.addColorStop(1, hex(col, 0.55));
      ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = hex(col, 1); ctx.lineWidth = 1.2; ctx.stroke();
      ctx.shadowColor = col; ctx.shadowBlur = 8; ctx.stroke(); ctx.shadowBlur = 0;
      ctx.font = '17px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(co.industry.emoji, x + CELL / 2, y + CELL / 2 + 1);
    }

    // Last-placed pulse ring.
    if (engine.lastPlaced) {
      const { r, c } = engine.lastPlaced;
      const x = PAD + c * CELL, y = PAD + r * CELL;
      const pulse = 0.5 + 0.5 * Math.sin(t * 5);
      ctx.strokeStyle = `rgba(255,255,255,${0.4 + 0.5 * pulse})`; ctx.lineWidth = 2;
      roundRect(ctx, x + 2, y + 2, CELL - 4, CELL - 4, 9); ctx.stroke();
    }

    // Merge flash (gold, decaying over ~1.4s).
    if (engine.mergeFlash && engine.mergeFlash.length) {
      const age = (performance.now() - (engine._mergeFlashAt || 0)) / 1400;
      const a = Math.max(0, 1 - age);
      if (a > 0) {
        for (const cell of engine.mergeFlash) {
          const x = PAD + cell.c * CELL, y = PAD + cell.r * CELL;
          roundRect(ctx, x + 3, y + 3, CELL - 6, CELL - 6, 8);
          ctx.fillStyle = `rgba(255,209,102,${0.5 * a})`; ctx.fill();
        }
      }
    }
  }

  function hex(h, a) {
    const n = parseInt(h.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  function onBoardClick(e) {
    if (!engine || engine.phase !== 'place' || !engine.player.isHuman || engine.pending) return;
    const cv = canvas(); const rect = cv.getBoundingClientRect();
    const scale = (COLS * CELL + PAD * 2) / rect.width;
    const px = (e.clientX - rect.left) * scale - PAD;
    const py = (e.clientY - rect.top) * scale - PAD;
    const c = Math.floor(px / CELL), r = Math.floor(py / CELL);
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return;
    tryPlay({ r, c });
  }

  function tryPlay(pos) {
    if (!engine.player.hand.some(t => t.r === pos.r && t.c === pos.c)) return;
    if (engine.tileState(pos) !== 'playable') { flashInvalid(); return; }
    engine._mergeFlashAt = performance.now();
    snapshotPrices();
    const done = engine.playTile(pos);
    if (done) render();
    // If not done, engine.pending drives a modal (rendered by onChange).
  }

  function flashInvalid() {
    const bar = $('#phaseNow'); if (!bar) return;
    bar.animate([{ color: '#ff5d7a' }, { color: '' }], { duration: 500 });
  }

  /* ================= PANELS ================= */
  function render() {
    if (!engine) return;
    renderTop();
    renderMarket();
    renderCenter();
    renderPlayers();
    renderLog();
    renderPending();
  }

  function renderTop() {
    $('#turnChip').innerHTML = `TURN <b>${engine.turnCount}</b> · ${engine.player.isHuman ? 'YOUR MOVE' : engine.player.name + ' thinking…'}`;
  }

  function renderMarket() {
    const host = $('#marketList'); host.innerHTML = '';
    // Active first (by size), then available to found.
    const active = engine.activeCompanies().sort((a, b) => b.cells.length - a.cells.length);
    const avail = engine.availableIndustries();
    const buyPhase = engine.phase === 'buy' && engine.player.isHuman;

    active.forEach(co => {
      const price = engine.sharePrice(co.id);
      const prev = prevPrices[co.id] ?? price;
      const dir = price > prev ? 'up' : (price < prev ? 'down' : '');
      const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '·';
      const mine = engine.player.shares[co.id];
      const mult = engine.market[co.id];
      const row = el('div', 'co-row' + (buyPhase && engine.canBuy(co.id) ? ' buyable' : ''));
      row.innerHTML =
        `<div class="emoji">${co.industry.emoji}</div>
         <div><div class="nm">${co.industry.name}${co.safe ? '<span class="safe-tag">SAFE</span>' : ''}</div>
              <div class="sub">${co.cells.length} presence · ${co.sharesInBank} left · T${co.industry.tier}</div>
              <div class="mkt-bar"><i style="width:${clamp((mult - 0.4) / 1.8 * 100, 4, 100)}%;background:${co.industry.color}"></i></div></div>
         <div class="price ${dir}">${money(price)}<div class="sub ${dir}">${arrow} ×${mult.toFixed(2)}</div></div>
         <div class="mine">${mine ? mine + '📜' : ''}</div>`;
      if (buyPhase && engine.canBuy(co.id)) row.onclick = () => { engine.buyShare(co.id); render(); };
      host.appendChild(row);
    });

    if (avail.length) {
      const h = el('div', 'sub'); h.style.cssText = 'margin:10px 0 4px;color:var(--text-dim);font-family:var(--mono);font-size:10px;';
      h.textContent = 'AVAILABLE TO FOUND';
      host.appendChild(h);
      avail.forEach(ind => {
        const row = el('div', 'co-row'); row.style.opacity = '0.6';
        row.innerHTML =
          `<div class="emoji">${ind.emoji}</div>
           <div><div class="nm">${ind.name}</div><div class="sub">Tier ${ind.tier} · ${ind.behavior}</div></div>
           <div class="price sub">—</div><div class="mine"></div>`;
        host.appendChild(row);
      });
    }
  }

  function renderCenter() {
    // Phase bar.
    const now = $('#phaseNow');
    const p = engine.player;
    if (engine.phase === 'place') {
      now.innerHTML = `<span class="dot" style="color:${p.color}"></span>${p.isHuman ? 'Place an operation' : p.name + ' is placing…'}`;
    } else if (engine.phase === 'buy') {
      now.innerHTML = `<span class="dot" style="color:${p.color}"></span>${p.isHuman ? `Invest — ${engine.buysRemaining} buy${engine.buysRemaining !== 1 ? 's' : ''} left` : p.name + ' is investing…'}`;
    } else now.innerHTML = '<span class="dot" style="color:#ffd166"></span>Market closed';
    // Cash + net worth in the HUD always reflect the human player.
    const you = engine.players.find(x => x.isHuman);
    $('#cash').textContent = money(you.cash);
    $('#networth').textContent = money(engine.netWorth(you));

    // Hand + controls (only meaningful on human turn).
    const hand = $('#hand'); hand.innerHTML = '';
    const controls = $('#controls'); controls.innerHTML = '';
    if (engine.player.isHuman && engine.phase === 'place' && !engine.pending) {
      const playable = engine.player.hand.filter(t => engine.tileState(t) === 'playable');
      engine.player.hand.slice().sort((a, b) => (a.r - b.r) || (a.c - b.c)).forEach(t => {
        const dead = engine.tileState(t) !== 'playable';
        const b = el('button', 'tile-btn' + (dead ? ' dead' : ''), cellLabel(t));
        if (!dead) b.onclick = () => tryPlay(t); else b.title = 'Illegal placement';
        hand.appendChild(b);
      });
      if (!playable.length) {
        const skip = el('button', 'action', 'No legal move — redraw & continue');
        skip.onclick = () => { engine.humanSkip(); render(); };
        controls.appendChild(skip);
      }
    } else if (engine.player.isHuman && engine.phase === 'buy') {
      const info = el('div', null, `Click a company at left to buy shares. <b style="color:var(--gold)">${engine.buysRemaining}</b> buys remaining.`);
      info.style.cssText = 'font-size:13px;color:var(--text-dim);align-self:center;';
      const end = el('button', 'action', 'End turn →');
      end.onclick = humanEndTurn;
      controls.append(info, end);
    } else {
      const wait = el('div', null, `${engine.player.name} is making moves…`);
      wait.style.cssText = 'font-size:13px;color:var(--text-dim);align-self:center;';
      controls.appendChild(wait);
    }
  }

  function renderPlayers() {
    const host = $('#players'); host.innerHTML = '';
    engine.players.forEach((p, i) => {
      const card = el('div', 'player-card' + (i === engine.current ? ' active' : ''));
      const nw = engine.netWorth(p);
      card.innerHTML =
        `<div class="ava">${p.ceo.emoji}</div>
         <div class="who"><div class="n">${p.name}${p.isHuman ? '<span class="you-tag">YOU</span>' : ''}</div>
           <div class="t">${p.ceo.title}</div></div>
         <div class="net">${money(nw)}<small>${money(p.cash)} cash</small></div>`;
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
    if (!engine.pending) {
      if (engine.phase !== 'gameover') ov.classList.remove('show');
      return;
    }
    const pd = engine.pending; ov.innerHTML = '';
    const m = el('div', 'modal');
    if (pd.type === 'found') {
      m.appendChild(el('h2', null, 'Found a company'));
      m.appendChild(el('p', 'lede', `Your operations connected on the board. Choose the industry for your new ${pd.cluster.length}-node company — you keep the founder shares.`));
      const grid = el('div', 'choice-grid');
      pd.options.forEach(ind => {
        const c = el('div', 'choice');
        c.innerHTML = `<div class="big">${ind.emoji}</div><div class="nm">${ind.name}</div>
          <div class="meta">Tier ${ind.tier} · ${ind.behavior}</div>`;
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
        c.innerHTML = `<div class="big">${co.industry.emoji}</div><div class="nm">${co.industry.name}</div>
          <div class="meta">${co.cells.length} presence · you hold ${engine.player.shares[id]}📜</div>`;
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
    const co = engine.companies[pd.companyId];
    const surv = engine.companies[pd.survivorId];
    m.appendChild(el('h2', null, `${co.industry.name} was acquired`));
    m.appendChild(el('p', 'lede',
      `You hold <b>${pd.held}📜</b> at ${money(pd.price)} each. Sell them for cash, trade 2-for-1 into ${surv.industry.name}, or hold for a possible re-founding. Bonuses are already paid.`));

    let trade = 0, sell = pd.held; // default: cash out fully
    const maxTrade = Math.min(pd.held - (pd.held % 2), pd.survivorBank * 2);

    const mkRange = (labelText, max, getVal, setVal, step) => {
      const row = el('div', 'dispo-row');
      row.appendChild(el('label', null, labelText));
      const input = el('input'); input.type = 'range'; input.min = 0; input.max = max; input.step = step || 1; input.value = getVal();
      const val = el('div', 'val');
      input.oninput = () => { setVal(parseInt(input.value, 10)); refresh(); };
      row.append(input, val);
      row._val = val; row._input = input;
      return row;
    };

    const tradeRow = mkRange(`Trade → ${surv.industry.emoji}`, maxTrade, () => trade, (v) => { trade = v - (v % 2); }, 2);
    const summary = el('div', 'dispo-summary');
    const confirm = el('button', 'action', 'Confirm'); confirm.style.marginTop = '6px';

    function refresh() {
      trade = Math.min(trade - (trade % 2), maxTrade);
      sell = pd.held - trade;             // remainder is sold; hold is opt-in via checkbox
      const holdIt = holdChk.checked;
      let hold = 0;
      if (holdIt) { hold = sell; sell = 0; }
      tradeRow._input.value = trade;
      tradeRow._val.textContent = `${trade}📜`;
      const cash = sell * pd.price;
      const got = trade / 2;
      summary.innerHTML = `Sell <b>${sell}</b> → ${money(cash)} · Trade <b>${trade}</b> → <b>${got}</b> ${surv.industry.name}📜 · Hold <b>${hold}</b>`;
      confirm.onclick = () => { pd.resolve({ sell, trade, hold }); render(); };
    }

    const holdRow = el('div', 'dispo-row');
    holdRow.appendChild(el('label', null, 'Hold rest'));
    const holdChk = el('input'); holdChk.type = 'checkbox';
    holdChk.onchange = refresh;
    const holdHint = el('div', null, 'Keep untraded shares (worthless unless re-founded)');
    holdHint.style.cssText = 'font-size:11px;color:var(--text-dim);';
    holdRow.append(holdChk, holdHint);

    m.append(tradeRow, holdRow, summary, confirm);
    refresh();
  }

  /* ================= GAME OVER ================= */
  function showGameOver() {
    const ov = $('#overlay'); ov.innerHTML = '';
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
    const again = el('button', 'action', 'Play again');
    again.onclick = showSetup;
    m.appendChild(again);
    m.appendChild(el('div', 'footnote', 'This match would post to your Quantum Star profile in a live build — unlocking titles & cosmetics across the ecosystem.'));
    ov.appendChild(m); ov.classList.add('show');
  }

  /* ================= ANIMATION LOOP ================= */
  function loop() { if (engine) drawBoard(); requestAnimationFrame(loop); }

  /* ================= BOOT ================= */
  window.addEventListener('load', () => {
    canvas().addEventListener('click', onBoardClick);
    window.addEventListener('resize', () => engine && render());
    requestAnimationFrame(loop);
    showSetup();
  });
})();
