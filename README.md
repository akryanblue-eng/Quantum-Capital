# Quantum Capital

**Found companies. Control markets. Engineer mergers. Become the world's most powerful CEO.**

An original company-building strategy game in the **Quantum Star** ecosystem. Not
"Acquire with nicer graphics" — a modern corporate-strategy game with its own
identity: a living economy, distinct AI CEOs, and a market that evolves while you
play.

This repository is the **first playable version (v1)** — a self-contained,
zero-dependency browser build focused on proving the core loop:

> **build → invest → merge → outmaneuver**

## Play it

Open `index.html` in any modern browser — **desktop or phone**. No build step, no server, no install.

On desktop you get the full 3-column command center. On a phone it becomes a
**Mobile Command Center**: the board is the hero (pinch-zoom / drag-pan / zoom
buttons), tapping an operation tile arms a placement you confirm from a bottom
bar (so you never misfire on a pan), and the Market and Boardroom collapse into
bottom sheets. Portrait and landscape are both supported, with iPhone safe-area
insets handled.

1. **Take the corner office** — pick your CEO (each has a passive ability).
2. **Place operations** — click a tile in your hand (or its cell on the board).
   - Connect two loose nodes → **found** a company (choose its industry).
   - Extend a company → **grow** its market presence and share price.
   - Bridge two companies → **merge**; the larger absorbs the smaller.
3. **Invest** — buy up to 3 shares/turn in any active company.
4. **Outmaneuver** — own the most shares in a company when it's acquired to
   collect the **10× majority** / **5× minority** bonus.
5. The market settles when a company reaches **41 presence** (or every company is
   **safe**). Highest net worth wins.

## What's in v1 (the core loop)

| Pitch feature | Status in this build |
|---|---|
| ✅ Original company-building & stock system | Founding, growth, safe companies, a 25-share bank per industry, live pricing |
| ✅ Corporate mergers | Full merger resolution: survivor selection, majority/minority bonuses, sell / trade-2-for-1 / hold |
| ✅ AI CEOs with distinct personalities | 6 CEOs, each a passive ability **and** a personality (aggression / greed / loyalty / risk) that drives their play |
| ✅ Instant financial calculations | All pricing, net worth, and payouts computed live |
| ✅ Living economy | 9 industries across 3 tiers; a **live market** of earnings, breakthroughs, regulation, crashes, sector rotation |
| ✅ AI shareholders | Institutional investors accumulate, dump, and rescue companies independently of players |
| ✅ Replay-ready play-by-play | Every event is logged to the ticker (the seed of a full replay system) |

### The nine industries

⚡ Energy · 📡 Communications · 🎮 Gaming _(Tier 1)_ ·
☁️ Cloud · 🌐 Robotics · 💳 FinTech _(Tier 2)_ ·
🤖 AI · 🧬 Biotech · 🚀 Aerospace _(Tier 3)_

Higher tiers cost more and are more volatile — frontier industries explode on
breakthroughs and crater on missed trials.

### The six CEOs

| CEO | Title | Passive ability |
|---|---|---|
| 🦈 Dominic Vale | Aggressive Acquirer | +25% payout when *your* move triggers an acquisition |
| 📈 Priya Anand | Wall Street Genius | Buys shares at a 5% discount |
| 🌱 Marcus Reid | Venture Capitalist | Foundings grant 2 founder shares instead of 1 |
| ✂️ Elena Duarte | Cost Cutter | Earns 2% interest on cash every turn |
| 🔮 Kenji Sato | Tech Visionary | Frontier foundings grant +1 share |
| 🎭 Zara Okonkwo | Market Manipulator | Banks cash worth 6% of stock value on every crash |

## Deliberately deferred (the roadmap)

Per the v1 recommendation, showcase and infrastructure features are **not** in
this build — they become enhancements once the core loop is proven addictive:

- **Asynchronous multiplayer** & **ranked matchmaking / seasons** (needs a backend)
- **Full replay system** with scrubbing & spectators (the ticker log is the seed)
- **Career / Daily Challenge / Tournament** modes
- **Cross-game Quantum Star progression** — a unified profile unlocking cosmetics,
  titles, and rewards across *Street Kings*, *Arch Rivals: Street*, *Beat Mania*,
  etc., while keeping each title mechanically distinct
- Showcase presentation: AR mode, voice chat, holographic 3D charts, haptics

The single-player-vs-AI-CEOs build here is intentionally the first thing to ship,
because that's the loop everything else hangs on.

## Architecture

Plain HTML5 + Canvas + vanilla JS. No framework, no build. Three layers:

```
index.html      # shell + command-center layout
css/styles.css  # neon theme + responsive mobile command center (sheets, dock, safe-area)
js/data.js      # industries, CEOs, pricing tables, market-event deck
js/game.js      # engine: board, founding/growth/merger, live market, AI CEO brain
js/ui.js        # canvas board (fit/zoom/pan), panels, bottom sheets, decision modals, turn flow
```

`js/game.js` is UI-agnostic and fully deterministic given its inputs, so the rules
are testable headlessly. The engine exposes state + methods and emits events; the
UI drives turn flow and resolves human decisions through `engine.pending`.

### Design notes

- **Companies are their industries.** Each of the 9 industries is a single company
  slot — active or available to found — which keeps the board readable and the
  market panel meaningful.
- **Share conservation.** Exactly 25 shares exist per industry at all times
  (held + bank). Merger dispositions return sold/traded shares to the bank; "held"
  certificates stay with their owner and revive if the industry is re-founded.
- **The market is global but per-industry.** A running multiplier per industry
  (clamped to `0.4–2.2`) scales base price live, so the same board plays
  differently every match.

## Contributing / next steps

The cleanest next slices to build on this foundation:

1. **Persistence + replay scrubber** — the event log already records every action.
2. **Game-mode scaffolding** — Daily Challenge is a seeded mid-game state + score.
3. **Backend seam** — the engine is serializable; async multiplayer is a transport
   over the same rules.

---

*Part of the Quantum Star ecosystem.*
