/* ============================================================================
 * Quantum Capital — Core engine
 * A living-economy corporate strategy game. Found companies, control the
 * board, engineer mergers, read the live market, outmaneuver AI CEOs.
 *
 * The engine is UI-agnostic. It exposes state + methods and emits events; the
 * UI layer (ui.js) drives turn flow and resolves human decisions via
 * `engine.pending`. AI turns are fully self-driving.
 * ==========================================================================*/

const COLS = 12, ROWS = 9;

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const key = (r, c) => r + ',' + c;

class QuantumCapital {
  constructor(config) {
    // config: { players:[{name,isHuman,ceoId,color}], onEvent, onChange }
    this.onEvent = config.onEvent || (() => {});
    this.onChange = config.onChange || (() => {});

    // Board: each cell is 'empty' | 'unincorp' | <industryId>
    this.board = Array.from({ length: ROWS }, () => Array(COLS).fill('empty'));

    // One company slot per industry (a company IS its industry).
    this.companies = {};
    for (const ind of INDUSTRIES) {
      this.companies[ind.id] = {
        id: ind.id, industry: ind, active: false, safe: false,
        cells: [], sharesInBank: SHARES_PER_COMPANY,
      };
    }

    // Live market multiplier per industry (starts neutral).
    this.market = Object.fromEntries(INDUSTRIES.map(i => [i.id, 1.0]));

    // Tile bag = every board position, shuffled.
    this.bag = shuffle(
      Array.from({ length: ROWS }, (_, r) =>
        Array.from({ length: COLS }, (_, c) => ({ r, c }))).flat()
    );

    // Players
    this.players = config.players.map((p, i) => ({
      id: i, name: p.name, isHuman: !!p.isHuman,
      color: p.color || PLAYER_COLORS[i % PLAYER_COLORS.length],
      ceo: CEO_BY_ID[p.ceoId] || CEOS[i % CEOS.length],
      cash: STARTING_CASH,
      shares: Object.fromEntries(INDUSTRIES.map(ind => [ind.id, 0])),
      hand: [],
    }));
    for (const pl of this.players) for (let i = 0; i < HAND_SIZE; i++) pl.hand.push(this.bag.pop());

    this.current = 0;
    this.turnCount = 0;
    this.phase = 'place';          // 'place' | 'buy' | 'gameover'
    this.buysRemaining = MAX_BUYS_PER_TURN;
    this.pending = null;           // human decision object, or null
    this.endgameArmed = false;
    this.noProgress = 0;           // consecutive turns nobody could place
    this.log = [];
    this.lastPlaced = null;        // {r,c} for placement animation
    this.mergeFlash = [];          // cells to flash on a merger
    this.winner = null;
  }

  /* ---- Derived values -------------------------------------------------- */
  get player() { return this.players[this.current]; }

  companySize(id) { return this.companies[id].cells.length; }

  /* Live share price: base(size,tier) scaled by the market multiplier. */
  sharePrice(id) {
    const co = this.companies[id];
    if (!co.active) return 0;
    return Math.round(basePrice(co.cells.length, co.industry.tier) * this.market[id]);
  }

  netWorth(player) {
    let w = player.cash;
    for (const ind of INDUSTRIES) {
      const n = player.shares[ind.id];
      if (n > 0 && this.companies[ind.id].active) w += n * this.sharePrice(ind.id);
    }
    return w;
  }

  activeCompanies() { return INDUSTRIES.map(i => this.companies[i.id]).filter(c => c.active); }
  availableIndustries() { return INDUSTRIES.filter(i => !this.companies[i.id].active); }

  emit(icon, text, kind) {
    const entry = { icon, text, kind: kind || 'info', turn: this.turnCount };
    this.log.unshift(entry);
    if (this.log.length > 60) this.log.pop();
    this.onEvent(entry);
  }

  /* ---- Adjacency helpers ---------------------------------------------- */
  neighbors(r, c) {
    const out = [];
    if (r > 0) out.push({ r: r - 1, c });
    if (r < ROWS - 1) out.push({ r: r + 1, c });
    if (c > 0) out.push({ r, c: c - 1 });
    if (c < COLS - 1) out.push({ r, c: c + 1 });
    return out;
  }

  // Classify what happens if `pos` were placed: returns
  // { companies:Set<id>, unincorp:[{r,c}] }
  probe(pos) {
    const comps = new Set(); const unincorp = [];
    for (const n of this.neighbors(pos.r, pos.c)) {
      const v = this.board[n.r][n.c];
      if (v === 'unincorp') unincorp.push(n);
      else if (v !== 'empty') comps.add(v);
    }
    return { companies: comps, unincorp };
  }

  // Legality: a tile is unplayable if it would merge 2+ SAFE companies, or
  // would found a new company while all 9 industries are already active.
  tileState(pos) {
    if (this.board[pos.r][pos.c] !== 'empty') return 'occupied';
    const { companies, unincorp } = this.probe(pos);
    const safeCount = [...companies].filter(id => this.companies[id].safe).length;
    if (safeCount >= 2) return 'dead';
    if (companies.size === 0 && unincorp.length > 0 && this.availableIndustries().length === 0) return 'dead';
    return 'playable';
  }

  /* Flood every 'unincorp' cell connected to `start` (inclusive). */
  floodUnincorp(start) {
    const seen = new Set([key(start.r, start.c)]);
    const stack = [start]; const out = [];
    while (stack.length) {
      const cur = stack.pop(); out.push(cur);
      for (const n of this.neighbors(cur.r, cur.c)) {
        if (this.board[n.r][n.c] === 'unincorp' && !seen.has(key(n.r, n.c))) {
          seen.add(key(n.r, n.c)); stack.push(n);
        }
      }
    }
    return out;
  }

  /* ======================================================================
   * TURN LIFECYCLE
   * ==================================================================== */
  beginTurn() {
    this.turnCount++;
    this.phase = 'place';
    this.buysRemaining = MAX_BUYS_PER_TURN;
    this.lastPlaced = null; this.mergeFlash = [];

    // Cost Cutter interest.
    if (this.player.ceo.ability === 'interest') {
      const interest = Math.floor(this.player.cash * 0.02);
      if (interest > 0) {
        this.player.cash += interest;
        this.emit('✂️', `${this.player.name} earns $${interest.toLocaleString()} interest.`, 'ceo');
      }
    }

    // Live market ticks before the player acts.
    this.tickMarket();
    this.onChange();
  }

  /* ---- The live market ------------------------------------------------- */
  tickMarket() {
    // ~55% chance of a market event, ~22% chance of an institutional move.
    if (Math.random() < 0.55) this.rollMarketEvent();
    if (this.activeCompanies().length && Math.random() < 0.22) this.rollInstitutional();
  }

  rollMarketEvent() {
    const ev = MARKET_EVENTS[Math.floor(Math.random() * MARKET_EVENTS.length)];
    if (ev.scope === 'none') { this.emit(ev.icon, ev.text, 'market'); return; }

    if (ev.scope === 'all') {
      for (const ind of INDUSTRIES) {
        // Volatility scales the magnitude a touch.
        const d = ev.delta * (0.7 + 0.3 * ind.volatility);
        this.market[ind.id] = clamp(this.market[ind.id] + d, 0.4, 2.2);
      }
      this.emit(ev.icon, ev.text, ev.crash ? 'bad' : 'good');
      if (ev.crash) this.payCrashProfiteers();
      return;
    }

    if (ev.scope === 'rotation') {
      for (const ind of INDUSTRIES) {
        const d = ind.tier === 3 ? -0.18 : (ind.tier === 1 ? +0.15 : 0);
        this.market[ind.id] = clamp(this.market[ind.id] + d, 0.4, 2.2);
      }
      this.emit(ev.icon, ev.text, 'market');
      return;
    }

    // industry-scoped: pick a target, frontier-biased for breakthroughs.
    let pool = INDUSTRIES;
    if (ev.frontierBias) pool = INDUSTRIES.filter(i => i.tier === 3);
    const ind = pool[Math.floor(Math.random() * pool.length)];
    const d = ev.delta * (0.6 + 0.4 * ind.volatility);
    this.market[ind.id] = clamp(this.market[ind.id] + d, 0.4, 2.2);
    this.emit(ev.icon, ev.text.replace('{industry}', `${ind.emoji} ${ind.name}`),
      ev.delta >= 0 ? 'good' : 'bad');
  }

  // Market Manipulator profits from every crash.
  payCrashProfiteers() {
    for (const pl of this.players) {
      if (pl.ceo.ability !== 'crashProfit') continue;
      let stockVal = 0;
      for (const ind of INDUSTRIES)
        if (pl.shares[ind.id] > 0 && this.companies[ind.id].active)
          stockVal += pl.shares[ind.id] * this.sharePrice(ind.id);
      const gain = Math.floor(stockVal * 0.06);
      if (gain > 0) {
        pl.cash += gain;
        this.emit('🎭', `${pl.name} shorts the crash for $${gain.toLocaleString()}.`, 'ceo');
      }
    }
  }

  rollInstitutional() {
    const active = this.activeCompanies();
    const co = active[Math.floor(Math.random() * active.length)];
    const move = INSTITUTIONAL_MOVES[Math.floor(Math.random() * INSTITUTIONAL_MOVES.length)];
    const label = `${co.industry.emoji} ${co.industry.name}`;
    if (move.id === 'accumulate' || move.id === 'rescue') {
      this.market[co.id] = clamp(this.market[co.id] + 0.18, 0.4, 2.2);
    } else {
      this.market[co.id] = clamp(this.market[co.id] - 0.2, 0.4, 2.2);
    }
    this.emit(move.icon, move.text.replace('{company}', label),
      move.id === 'dump' ? 'bad' : 'good');
  }

  /* ======================================================================
   * PLACEMENT — the heart of the board game
   * ==================================================================== */
  // Attempt to play a tile from the current player's hand.
  // Returns true if resolution is complete, false if awaiting a human decision.
  playTile(pos) {
    if (this.phase !== 'place') return true;
    const pl = this.player;
    const idx = pl.hand.findIndex(t => t.r === pos.r && t.c === pos.c);
    if (idx === -1) return true;
    if (this.tileState(pos) !== 'playable') return true;

    pl.hand.splice(idx, 1);
    this.lastPlaced = { ...pos };
    const { companies, unincorp } = this.probe(pos);
    this.board[pos.r][pos.c] = 'unincorp'; // provisional

    if (companies.size === 0) {
      if (unincorp.length > 0) return this._found(pos);       // FOUND
      this._afterPlacement();                                 // lone tile
      return true;
    }
    if (companies.size === 1) {
      this._grow([...companies][0], pos);                     // GROW
      this._afterPlacement();
      return true;
    }
    return this._merge([...companies], pos);                  // MERGE
  }

  _found(pos) {
    const avail = this.availableIndustries();
    const cluster = this.floodUnincorp(pos);
    if (this.player.isHuman && avail.length > 1) {
      this.pending = {
        type: 'found', options: avail, cluster,
        resolve: (indId) => { this.pending = null; this._doFound(indId, cluster); this._afterPlacement(); },
      };
      this.onChange();
      return false;
    }
    const indId = this.player.isHuman ? avail[0].id : this._aiPickIndustry(avail);
    this._doFound(indId, cluster);
    this._afterPlacement();
    return true;
  }

  _doFound(indId, cluster) {
    const co = this.companies[indId];
    co.active = true; co.cells = cluster.map(c => ({ ...c }));
    for (const c of cluster) this.board[c.r][c.c] = indId;
    this._recalcSafe(co);

    // Founder shares (+ CEO abilities).
    let founder = 1;
    if (this.player.ceo.ability === 'founderBonus') founder = 2;
    if (this.player.ceo.ability === 'frontierFounder' && co.industry.tier === 3) founder += 1;
    founder = Math.min(founder, co.sharesInBank);
    if (founder > 0) { co.sharesInBank -= founder; this.player.shares[indId] += founder; }

    this.emit(co.industry.emoji,
      `${this.player.name} founds ${co.industry.name} (+${founder} founder share${founder !== 1 ? 's' : ''}).`, 'found');
  }

  _grow(indId, pos) {
    const co = this.companies[indId];
    const cluster = this.floodUnincorp(pos); // pos + any attached loose tiles
    for (const c of cluster) {
      if (this.board[c.r][c.c] !== indId) { this.board[c.r][c.c] = indId; co.cells.push({ ...c }); }
    }
    this._recalcSafe(co);
  }

  _recalcSafe(co) {
    const wasSafe = co.safe;
    co.safe = co.cells.length >= SAFE_SIZE;
    if (co.safe && !wasSafe)
      this.emit('🛡️', `${co.industry.name} reaches ${SAFE_SIZE}+ presence — now safe from takeover.`, 'info');
  }

  _merge(compIds, pos) {
    // Rank by size to find the survivor; a size tie is a human choice.
    const sized = compIds.map(id => ({ id, size: this.companySize(id) }))
      .sort((a, b) => b.size - a.size);
    const topSize = sized[0].size;
    const tied = sized.filter(s => s.size === topSize).map(s => s.id);

    if (tied.length > 1 && this.player.isHuman) {
      this.pending = {
        type: 'survivor', options: tied, all: compIds, pos,
        resolve: (survivorId) => { this.pending = null; this._resolveMerge(survivorId, compIds, pos); },
      };
      this.onChange();
      return false;
    }
    const survivor = tied.length > 1 ? this._aiPickSurvivor(tied) : sized[0].id;
    return this._resolveMerge(survivor, compIds, pos);
  }

  _resolveMerge(survivorId, compIds, pos) {
    const defunct = compIds.filter(id => id !== survivorId);
    const survivor = this.companies[survivorId];

    // Flash the whole footprint for the animation layer.
    this._mergeFlashAt = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    this.mergeFlash = [];
    for (const id of compIds) for (const c of this.companies[id].cells) this.mergeFlash.push({ ...c });
    this.mergeFlash.push({ ...pos });

    // Pay bonuses for each defunct company (queue human dispositions).
    this._defunctQueue = defunct.map(id => id);
    this._survivorId = survivorId;
    this._mergePos = pos;
    this._mergeTrigger = this.current; // who triggered it (for Acquirer bonus)

    // Absorb geometry first so the survivor is correctly sized/priced… but
    // payouts must use each defunct company's price BEFORE absorption.
    this._payoutSnapshots = {};
    for (const id of defunct) {
      this._payoutSnapshots[id] = { price: this.sharePrice(id), size: this.companySize(id) };
    }

    this.emit('🤝',
      `${this.player.name} engineers a merger — ${survivor.industry.name} absorbs ` +
      defunct.map(id => this.companies[id].industry.name).join(' & ') + '.', 'merge');

    this._processNextDefunct();
    return this.pending === null; // false if a human disposition is pending
  }

  _processNextDefunct() {
    if (!this._defunctQueue.length) { this._completeMerge(); return; }
    const id = this._defunctQueue[0];
    this._payBonuses(id);
    // Now handle shareholder disposition of the defunct stock.
    const holders = this.players.filter(p => p.shares[id] > 0);
    const humanHolder = holders.find(p => p.isHuman);
    if (humanHolder) {
      this._pendingDisposition(id, humanHolder);
    } else {
      for (const p of holders) this._aiDispose(id, p);
      this._defunctQueue.shift();
      this._processNextDefunct();
    }
  }

  _payBonuses(id) {
    const { price } = this._payoutSnapshots[id];
    const co = this.companies[id];
    const majority = price * 10, minority = price * 5;
    // Rank holders by shares.
    const ranked = this.players.map(p => ({ p, n: p.shares[id] }))
      .filter(x => x.n > 0).sort((a, b) => b.n - a.n);
    if (!ranked.length) return;

    const grant = (player, amount, tag) => {
      let amt = amount;
      // Aggressive Acquirer: +25% if THEY triggered the merger.
      if (player.id === this._mergeTrigger && player.ceo.ability === 'mergerBonus') amt = Math.round(amt * 1.25);
      player.cash += amt;
      this.emit('💵', `${player.name} collects $${amt.toLocaleString()} ${tag} bonus in ${co.industry.name}.`, 'good');
    };

    const topN = ranked[0].n;
    const topTied = ranked.filter(x => x.n === topN);
    if (topTied.length > 1) {
      // Split (majority+minority) evenly among the tied top holders.
      const each = Math.round((majority + minority) / topTied.length);
      for (const t of topTied) grant(t.p, each, 'combined');
    } else {
      grant(ranked[0].p, majority, 'majority');
      const rest = ranked.slice(1);
      if (rest.length) {
        const secondN = rest[0].n;
        const secondTied = rest.filter(x => x.n === secondN);
        const each = Math.round(minority / secondTied.length);
        for (const t of secondTied) grant(t.p, each, 'minority');
      }
    }
  }

  _pendingDisposition(id, player) {
    const co = this.companies[id];
    const survivor = this.companies[this._survivorId];
    this.pending = {
      type: 'disposition', companyId: id, player: player.id,
      held: player.shares[id], price: this._payoutSnapshots[id].price,
      survivorId: this._survivorId, survivorBank: survivor.sharesInBank,
      // choice: { sell, trade, hold } counts summing to held (trade must be even)
      resolve: (choice) => {
        this.pending = null;
        this._applyDisposition(id, player, choice);
        this._defunctQueue.shift();
        this._processNextDefunct(); // resolves remaining defuncts or completes the merge (fires onChange)
      },
    };
    this.onChange();
  }

  _applyDisposition(id, player, choice) {
    const co = this.companies[id];
    const survivor = this.companies[this._survivorId];
    const price = this._payoutSnapshots[id].price;
    let { sell = 0, trade = 0, hold = 0 } = choice;
    // Sanitize.
    const held = player.shares[id];
    trade = Math.min(trade - (trade % 2), held);
    const maxTradeByBank = survivor.sharesInBank * 2;
    trade = Math.min(trade, maxTradeByBank);
    sell = Math.min(sell, held - trade);
    hold = held - trade - sell;

    if (sell > 0) { player.shares[id] -= sell; co.sharesInBank += sell; player.cash += sell * price; }
    if (trade > 0) {
      player.shares[id] -= trade;
      co.sharesInBank += trade;
      const got = trade / 2;
      survivor.sharesInBank -= got;
      player.shares[this._survivorId] += got;
    }
    // held shares stay with the player; company will deactivate but if it is
    // ever re-founded those certificates become live again.
    if (sell || trade)
      this.emit('🔁', `${player.name}: sold ${sell}, traded ${trade} → ${trade / 2} ${survivor.industry.name}, held ${hold}.`, 'info');
  }

  _completeMerge() {
    const survivor = this.companies[this._survivorId];
    // Absorb every defunct company's geometry + the trigger tile + loose tiles.
    for (const id of this._payoutSnapshots ? Object.keys(this._payoutSnapshots) : []) {
      const co = this.companies[id];
      for (const c of co.cells) { this.board[c.r][c.c] = this._survivorId; survivor.cells.push({ ...c }); }
      co.active = false; co.cells = []; co.safe = false;
      // NOTE: the share bank is intentionally NOT reset. Sold/traded shares were
      // already returned to it during disposition; any "held" certificates stay
      // with their owners. This keeps total shares per industry conserved at 25,
      // and those held certificates become live again if the name is re-founded.
    }
    // Absorb the trigger tile and any connected loose tiles.
    const cluster = this.floodUnincorp(this._mergePos);
    for (const c of cluster) {
      if (this.board[c.r][c.c] !== this._survivorId) {
        this.board[c.r][c.c] = this._survivorId; survivor.cells.push({ ...c });
      }
    }
    this._recalcSafe(survivor);
    this._defunctQueue = null; this._payoutSnapshots = null;
    this._afterPlacement();
  }

  _afterPlacement() {
    this.noProgress = 0; // a placement happened
    // Draw back up to a full hand.
    const pl = this.player;
    while (pl.hand.length < HAND_SIZE && this.bag.length) pl.hand.push(this.bag.pop());
    // Endgame check.
    this._checkEndgame();
    this.phase = 'buy';
    this.onChange();
  }

  // Called when the current player cannot legally place a tile. Redraws one
  // dead tile if possible; if a whole round passes with nobody able to move,
  // the market settles.
  _skipPlacement() {
    const pl = this.player;
    if (pl.hand.length) {
      // Discard a dead tile and try to redraw.
      const deadIdx = pl.hand.findIndex(t => this.tileState(t) === 'dead');
      if (deadIdx !== -1) { pl.hand.splice(deadIdx, 1); if (this.bag.length) pl.hand.push(this.bag.pop()); }
    }
    this.noProgress++;
    if (this.noProgress >= this.players.length) {
      this.endgameArmed = true;
      this.emit('🏁', 'The board is gridlocked — the market settles.', 'market');
    }
    this.phase = 'buy';
    this.onChange();
  }

  // UI entry point for a human with no legal move.
  humanSkip() { this._skipPlacement(); }

  _checkEndgame() {
    const active = this.activeCompanies();
    if (!active.length) return;
    const anyGiant = active.some(c => c.cells.length >= ENDGAME_SIZE);
    const allSafe = active.every(c => c.safe);
    if (anyGiant || allSafe) {
      this.endgameArmed = true;
      this.emit('🏁', 'Endgame conditions met. This round completes, then the market settles.', 'market');
    }
  }

  /* ======================================================================
   * BUY PHASE
   * ==================================================================== */
  canBuy(id) {
    const co = this.companies[id];
    if (!co.active || this.buysRemaining <= 0 || co.sharesInBank <= 0) return false;
    let price = this.sharePrice(id);
    if (this.player.ceo.ability === 'shareDiscount') price = Math.round(price * 0.95);
    return this.player.cash >= price;
  }

  buyShare(id) {
    if (!this.canBuy(id)) return false;
    const co = this.companies[id];
    let price = this.sharePrice(id);
    if (this.player.ceo.ability === 'shareDiscount') price = Math.round(price * 0.95);
    this.player.cash -= price; co.sharesInBank -= 1; this.player.shares[id] += 1;
    this.buysRemaining -= 1;
    this.onChange();
    return true;
  }

  endTurn() {
    if (this.phase !== 'buy') return;
    if (this.endgameArmed) { this._finalize(); return; }
    this.current = (this.current + 1) % this.players.length;
    this.beginTurn();
  }

  /* ======================================================================
   * ENDGAME
   * ==================================================================== */
  _finalize() {
    // Pay out majority/minority bonuses for every active company, then
    // liquidate all shares at live price.
    for (const co of this.activeCompanies()) {
      const price = this.sharePrice(co.id);
      const ranked = this.players.map(p => ({ p, n: p.shares[co.id] }))
        .filter(x => x.n > 0).sort((a, b) => b.n - a.n);
      if (ranked.length) {
        const majority = price * 10, minority = price * 5;
        const topN = ranked[0].n; const topTied = ranked.filter(x => x.n === topN);
        if (topTied.length > 1) {
          const each = Math.round((majority + minority) / topTied.length);
          topTied.forEach(t => t.p.cash += each);
        } else {
          ranked[0].p.cash += majority;
          const rest = ranked.slice(1);
          if (rest.length) {
            const secondN = rest[0].n; const secondTied = rest.filter(x => x.n === secondN);
            const each = Math.round(minority / secondTied.length);
            secondTied.forEach(t => t.p.cash += each);
          }
        }
      }
      // Liquidate.
      for (const p of this.players) if (p.shares[co.id] > 0) { p.cash += p.shares[co.id] * price; p.shares[co.id] = 0; }
    }
    this.phase = 'gameover';
    const standings = [...this.players].sort((a, b) => b.cash - a.cash);
    this.winner = standings[0];
    this.finalStandings = standings.map(p => ({ id: p.id, name: p.name, ceo: p.ceo, net: p.cash, color: p.color }));
    this.emit('🏆', `${this.winner.name} wins with $${this.winner.cash.toLocaleString()}.`, 'good');
    this.onChange();
  }

  /* ======================================================================
   * AI CEO BRAIN
   * ==================================================================== */
  // Runs a complete AI turn: place, resolve decisions, buy, end.
  runAITurn() {
    // Placement.
    const playable = this.player.hand.filter(t => this.tileState(t) === 'playable');
    if (!playable.length) {
      this.emit('🚫', `${this.player.name} has no legal placement.`, 'info');
      this._skipPlacement();
    } else {
      const best = this._aiChooseTile(playable);
      this.playTile(best); // AI never sets `pending`; resolution is synchronous.
    }
    // Buy phase.
    this._aiBuy();
    // End (finalize handled inside endTurn).
    this.endTurn();
  }

  _aiChooseTile(playable) {
    const per = this.player.ceo.personality; const me = this.player;
    let best = playable[0], bestScore = -Infinity;
    for (const pos of playable) {
      const { companies, unincorp } = this.probe(pos);
      let score = Math.random() * 0.5; // jitter
      if (companies.size === 0 && unincorp.length > 0) {
        // Founding.
        const avail = this.availableIndustries();
        if (avail.length) {
          score += 3 + per.risk * 2;
          if (avail.some(i => i.tier === 3)) score += per.risk * 1.5;
        }
      } else if (companies.size === 1) {
        const id = [...companies][0];
        const mine = me.shares[id];
        const size = this.companySize(id);
        score += 1 + (mine > 0 ? 2 + per.greed * 2 : -0.5);
        if (this.companies[id].safe) score -= 0.5; // low upside growing a safe giant
        score += Math.min(size, 10) * 0.05 * per.loyalty;
      } else if (companies.size >= 2) {
        // Merger — very attractive if I'm the top holder of a defunct company.
        const sized = [...companies].map(id => ({ id, size: this.companySize(id) })).sort((a, b) => b.size - a.size);
        const survivor = sized[0].id;
        let merit = 2 + per.aggression * 3;
        for (const s of sized.slice(1)) {
          const price = this.sharePrice(s.id);
          const ranked = this.players.map(p => ({ id: p.id, n: p.shares[s.id] })).filter(x => x.n > 0).sort((a, b) => b.n - a.n);
          if (ranked.length && ranked[0].id === me.id) merit += (price * 10) / 1500; // bonus incentive
        }
        score += merit;
      }
      if (score > bestScore) { bestScore = score; best = pos; }
    }
    return best;
  }

  _aiPickIndustry(avail) {
    const per = this.player.ceo.personality;
    // Visionary/high-risk favor frontier; conservatives favor foundational.
    const pool = [...avail].sort((a, b) => {
      const sa = (per.risk - 0.5) * (a.tier - 2);
      const sb = (per.risk - 0.5) * (b.tier - 2);
      return sb - sa;
    });
    return pool[0].id;
  }

  _aiPickSurvivor(tied) {
    // Prefer the industry where the AI holds the most shares.
    const me = this.player;
    return [...tied].sort((a, b) => me.shares[b] - me.shares[a])[0];
  }

  _aiDispose(id, player) {
    const held = player.shares[id];
    const survivor = this.companies[this._survivorId];
    const per = player.ceo.personality;
    // Greedy CEOs holding the survivor trade in; otherwise cash out.
    let trade = 0;
    const alreadyIn = player.shares[this._survivorId] > 0;
    if (survivor.active && survivor.sharesInBank > 0 && (alreadyIn || per.greed > 0.6)) {
      trade = Math.min(held - (held % 2), survivor.sharesInBank * 2);
      trade = Math.floor(trade * (0.4 + 0.4 * per.greed));
      trade -= trade % 2;
    }
    const sell = held - trade;
    this._applyDisposition(id, player, { sell, trade, hold: 0 });
  }

  _aiBuy() {
    const me = this.player; const per = me.ceo.personality;
    let guard = 0;
    while (this.buysRemaining > 0 && guard++ < 10) {
      const candidates = this.activeCompanies()
        .filter(co => this.canBuy(co.id))
        .map(co => {
          let price = this.sharePrice(co.id);
          if (me.ceo.ability === 'shareDiscount') price = Math.round(price * 0.95);
          const mine = me.shares[co.id];
          const bankLeft = co.sharesInBank;
          // Value: momentum (market mult) + defend majority + tier upside − price drag.
          let v = this.market[co.id] * 2;
          v += mine * 0.3 * per.greed;                 // reinforce positions
          v += (co.industry.tier - 1) * per.risk * 0.6; // frontier appetite
          v += (SHARES_PER_COMPANY - bankLeft) * 0.02;  // scarcity/popularity
          v -= price / 900;                             // cost drag
          return { id: co.id, v, price };
        })
        .sort((a, b) => b.v - a.v);
      if (!candidates.length) break;
      // Keep a cash reserve; timid CEOs reserve more.
      const reserve = 400 + (1 - per.aggression) * 1200;
      const pick = candidates[0];
      if (me.cash - pick.price < reserve && pick.v < 3) break;
      if (!this.buyShare(pick.id)) break;
    }
  }
}
