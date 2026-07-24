/* ============================================================================
 * Quantum Capital — Static game data
 * Industries, CEO archetypes, pricing tables, and the live-market event deck.
 * Part of the Quantum Star ecosystem.
 * ==========================================================================*/

/* --- The nine industries -------------------------------------------------- */
/* tier 1 = foundational (cheaper), 2 = growth, 3 = frontier (premium).
 * Each industry has a passive "market behavior" that biases its volatility
 * and how it reacts to the live market. */
const INDUSTRIES = [
  { id: 'energy',   name: 'Energy',         emoji: '⚡', tier: 1, color: '#f9c74f',
    behavior: 'Steady dividends. Low volatility, resists crashes.' , volatility: 0.6 },
  { id: 'comms',    name: 'Communications', emoji: '📡', tier: 1, color: '#90be6d',
    behavior: 'Broad reach. Grows with population and city expansion.', volatility: 0.8 },
  { id: 'gaming',   name: 'Gaming',         emoji: '🎮', tier: 1, color: '#43aa8b',
    behavior: 'Hit-driven. Big swings on product launches.', volatility: 1.3 },

  { id: 'cloud',    name: 'Cloud',          emoji: '☁️', tier: 2, color: '#4d96ff',
    behavior: 'Compounding infrastructure. Reliable upside.', volatility: 0.9 },
  { id: 'robotics', name: 'Robotics',       emoji: '🌐', tier: 2, color: '#845ef7',
    behavior: 'Automation tailwind. Amplifies merger bonuses.', volatility: 1.1 },
  { id: 'fintech',  name: 'FinTech',        emoji: '💳', tier: 2, color: '#22b8cf',
    behavior: 'Sensitive to regulation and market sentiment.', volatility: 1.2 },

  { id: 'ai',       name: 'AI',             emoji: '🤖', tier: 3, color: '#f72585',
    behavior: 'Frontier hype cycle. Explosive on breakthroughs.', volatility: 1.6 },
  { id: 'biotech',  name: 'Biotech',        emoji: '🧬', tier: 3, color: '#4cc9f0',
    behavior: 'Binary outcomes. Trials make or break valuations.', volatility: 1.5 },
  { id: 'aero',     name: 'Aerospace',      emoji: '🚀', tier: 3, color: '#ff922b',
    behavior: 'Capital-heavy moonshots. Rare but massive payoffs.', volatility: 1.4 },
];

const INDUSTRY_BY_ID = Object.fromEntries(INDUSTRIES.map(i => [i.id, i]));

/* --- Pricing ---------------------------------------------------------------
 * Acquire-style bracketed pricing, modernised. Share price is a function of a
 * company's market presence (size) plus its industry tier, then scaled live by
 * the market multiplier. Majority/minority payouts are 10x / 5x share price. */
const SIZE_BRACKETS = [
  { min: 2,  max: 2,  step: 0 },
  { min: 3,  max: 3,  step: 1 },
  { min: 4,  max: 4,  step: 2 },
  { min: 5,  max: 5,  step: 3 },
  { min: 6,  max: 10, step: 4 },
  { min: 11, max: 20, step: 5 },
  { min: 21, max: 30, step: 6 },
  { min: 31, max: 40, step: 7 },
  { min: 41, max: 999,step: 8 },
];
const BASE_PRICE = 200;      // tier-1 price at the smallest bracket
const PRICE_STEP = 100;      // per size bracket
const TIER_PREMIUM = 100;    // per tier above 1

const SHARES_PER_COMPANY = 25;   // shares the bank holds per company
const SAFE_SIZE = 11;            // a company this big can't be acquired
const ENDGAME_SIZE = 41;         // a company this big can end the game
const HAND_SIZE = 6;             // operation tiles held per player
const STARTING_CASH = 6000;
const MAX_BUYS_PER_TURN = 3;

/* Base (pre-market) share price for a given size + tier. */
function basePrice(size, tier) {
  let step = 0;
  for (const b of SIZE_BRACKETS) { if (size >= b.min && size <= b.max) { step = b.step; break; } }
  return BASE_PRICE + step * PRICE_STEP + (tier - 1) * TIER_PREMIUM;
}

/* --- CEO archetypes --------------------------------------------------------
 * Every CEO has ONE passive ability plus a personality that drives the AI.
 * personality weights bias the opponent's decisions:
 *   aggression  -> willingness to trigger mergers / spend
 *   greed       -> how deep they buy into leaders
 *   loyalty     -> tendency to concentrate in industries they already hold
 *   risk        -> appetite for frontier (tier 3) volatility            */
const CEOS = [
  { id: 'acquirer',    name: 'Dominic Vale',   title: 'Aggressive Acquirer',
    emoji: '🦈', ability: 'mergerBonus',
    blurb: '+25% payout when your move triggers an acquisition.',
    personality: { aggression: 0.9, greed: 0.7, loyalty: 0.4, risk: 0.6 } },

  { id: 'wallstreet',  name: 'Priya Anand',    title: 'Wall Street Genius',
    emoji: '📈', ability: 'shareDiscount',
    blurb: 'Buys shares at a 5% discount — you read the tape better.',
    personality: { aggression: 0.5, greed: 0.8, loyalty: 0.5, risk: 0.5 } },

  { id: 'vc',          name: 'Marcus Reid',    title: 'Venture Capitalist',
    emoji: '🌱', ability: 'founderBonus',
    blurb: 'Founding a company grants 2 free founder shares, not 1.',
    personality: { aggression: 0.6, greed: 0.5, loyalty: 0.3, risk: 0.8 } },

  { id: 'costcutter',  name: 'Elena Duarte',   title: 'Cost Cutter',
    emoji: '✂️', ability: 'interest',
    blurb: 'Earns 2% interest on cash at the start of every turn.',
    personality: { aggression: 0.4, greed: 0.6, loyalty: 0.6, risk: 0.3 } },

  { id: 'visionary',   name: 'Kenji Sato',     title: 'Tech Visionary',
    emoji: '🔮', ability: 'frontierFounder',
    blurb: 'Frontier (AI / Biotech / Aerospace) foundings grant +1 share.',
    personality: { aggression: 0.6, greed: 0.5, loyalty: 0.7, risk: 0.95 } },

  { id: 'manipulator', name: 'Zara Okonkwo',   title: 'Market Manipulator',
    emoji: '🎭', ability: 'crashProfit',
    blurb: 'Profits from chaos: bank cash worth 6% of your stock value on every market crash.',
    personality: { aggression: 0.8, greed: 0.9, loyalty: 0.4, risk: 0.7 } },
];
const CEO_BY_ID = Object.fromEntries(CEOS.map(c => [c.id, c]));

/* --- Live-market event deck ------------------------------------------------
 * Events fire during play and reshape the economy. `apply` returns a
 * multiplier delta per affected industry; the engine clamps the running
 * multiplier to [0.4, 2.2]. `scope` decides targeting. */
const MARKET_EVENTS = [
  { id: 'earnings_beat', label: 'Earnings Beat',      icon: '💰', scope: 'industry', delta: +0.25,
    text: '{industry} posts blowout earnings. Shares rally.' },
  { id: 'earnings_miss', label: 'Earnings Miss',      icon: '📉', scope: 'industry', delta: -0.22,
    text: '{industry} misses guidance. Sell-off begins.' },
  { id: 'breakthrough',  label: 'Breakthrough',       icon: '💡', scope: 'industry', delta: +0.4,  frontierBias: true,
    text: 'A breakthrough electrifies {industry}. Valuations spike.' },
  { id: 'product_launch',label: 'Product Launch',     icon: '🚀', scope: 'industry', delta: +0.3,
    text: '{industry} ships a blockbuster product.' },
  { id: 'regulation',    label: 'Regulation',         icon: '⚖️', scope: 'industry', delta: -0.3,
    text: 'New regulation lands on {industry}. Traders retreat.' },
  { id: 'consumer_trend',label: 'Consumer Trend',     icon: '🔥', scope: 'industry', delta: +0.2,
    text: 'A consumer trend favors {industry}.' },
  { id: 'bull_run',      label: 'Bull Run',           icon: '🐂', scope: 'all',      delta: +0.12,
    text: 'Optimism sweeps the market. Everything lifts.' },
  { id: 'crash',         label: 'Market Crash',       icon: '🌩️', scope: 'all',      delta: -0.25, crash: true,
    text: 'A market crash rips through every sector.' },
  { id: 'rotation',      label: 'Sector Rotation',    icon: '🔄', scope: 'rotation', delta: 0,
    text: 'Capital rotates out of frontier and into foundations.' },
  { id: 'quiet',         label: 'Quiet Session',      icon: '🌙', scope: 'none',     delta: 0,
    text: 'A quiet session. The tape barely moves.' },
];

/* Institutional (AI shareholder) moves — a background actor that reads or
 * shakes the market independently of the players. */
const INSTITUTIONAL_MOVES = [
  { id: 'accumulate', label: 'Fund Accumulates', icon: '🏦', text: 'A sovereign fund quietly accumulates {company}. Price firms up.' },
  { id: 'dump',       label: 'Fund Dumps',       icon: '💥', text: 'An institution dumps its {company} stake. Panic selling.' },
  { id: 'rescue',     label: 'Bailout',          icon: '🛟', text: 'White-knight investors rescue {company}.' },
];

/* Names for AI-run rival firms flavor + the human's default. */
const PLAYER_COLORS = ['#f72585', '#4cc9f0', '#ffd166', '#06d6a0', '#a78bfa', '#fb8500'];
