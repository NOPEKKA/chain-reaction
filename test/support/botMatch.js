'use strict';
// เล่นเกมจนจบด้วยกติกาของ shared/gameLogic.js — ลำดับเดียวกับที่ server ทำตอนจบแต่ละตา
// (การเดิน → ระเบิดจนนิ่ง → Time Bomb → ตกรอบ → ชนะ/เปลี่ยนตา → รอบเลือกการ์ด) ใช้วัดบอทโดยไม่ต้องมีหน้าเว็บ
const L = require('../../shared/gameLogic');
const Bot = require('../../client/botAI');

// seats: [{ level: 'easy'|'normal'|'hard'|'impossible', maxNodes?, timeBudgetMs? } | { random: true }]
function playGame({ rows = 8, cols = 8, seats, seed = 1, cardInterval = 2, maxTurns = 500, onDecision } = {}) {
  const players = seats.length;
  const state = L.createInitialState({ players, mapSize: rows, mapCols: cols, cardInterval });
  state._rng = Bot.makeRng(seed);                       // การสุ่มของเกม (การ์ดที่จั่ว, ผลของการ์ดสุ่ม) ซ้ำได้
  const rngs = seats.map((_, i) => Bot.makeRng(seed * 7919 + i * 104729 + 13));
  const out = { winner: -1, turns: 0, illegal: [], stuck: false, cards: 0, decisions: seats.map(() => ({ n: 0, ms: 0, max: 0 })) };
  const optsOf = i => ({ level: seats[i].level, rng: rngs[i], timeBudgetMs: seats[i].timeBudgetMs === undefined ? Infinity : seats[i].timeBudgetMs, maxNodes: seats[i].maxNodes });
  while (out.turns < maxTurns) {
    const p = state.current, seat = seats[p];
    const t0 = performance.now();
    const act = seat.random ? Bot.randomAction(state, p, rngs[p]) : Bot.chooseAction(state, p, optsOf(p));
    const ms = performance.now() - t0, d = out.decisions[p];
    d.n++; d.ms += ms; if (ms > d.max) d.max = ms;
    if (onDecision) onDecision(state, p, act, ms);
    if (state.frozen[p] > 0) state.moved[p] = true;     // โดน Freeze: ตานี้ไม่มีผล (เหมือน server)
    else if (act.type === 'place') {
      const res = L.applyPlace(state, p, act.r, act.c);
      if (!res.ok) { out.illegal.push({ turn: out.turns, p, act, msg: res.msg }); state.moved[p] = true; }
    } else if (act.type === 'card') {
      const def = (state.hands[p] || []).find(x => x.id === act.cardId);
      const res = def ? L.applyCard(state, p, def, act.targets || {}) : { ok: false, msg: 'ไม่มีการ์ดนี้ในมือ' };
      if (!res.ok) { out.illegal.push({ turn: out.turns, p, act, msg: res.msg }); state.moved[p] = true; } else out.cards++;
    } else {                                             // ข้ามตา (หมดเวลา): ผู้ตายที่ถือ Rebirth แล้วไม่ใช้ เสียสิทธิ์ เหมือน server
      state.moved[p] = true;
      if (!state.alive.includes(p)) state.hands[p] = state.hands[p].filter(x => x.id !== 'l5');
    }
    L.processExplosionsSync(state);
    if (L.tickTimeBombs(state)) L.processExplosionsSync(state);
    state._fx = null;
    L.checkEliminations(state);
    out.turns++;
    if (L.checkWin(state)) { out.winner = state.winner; return out; }
    L.nextTurn(state);
    if (cardInterval > 0 && state.turnCount % (players * cardInterval) === 0) {
      for (const slot of state.alive) {
        if (state.hands[slot].length >= L.HAND_LIMIT) continue;
        const choices = L.drawPickChoices(state, slot);
        const id = seats[slot].random ? choices[Math.floor(rngs[slot]() * choices.length)].id : Bot.chooseCardPick(state, slot, choices, optsOf(slot));
        const card = id && choices.find(c => c.id === id);
        if (card) state.hands[slot].push({ ...card });
      }
    }
  }
  out.stuck = true;
  return out;
}

// A พบ B หลายเกม สลับที่นั่ง — คืนอัตราชนะของ A (เกมที่ไม่จบไม่นับ)
function duel(a, b, { games = 100, rows = 8, cols = 8, cardInterval = 2, seed = 1000 } = {}) {
  let wa = 0, wb = 0, stuck = 0, illegal = 0, turns = 0;
  const dec = [{ n: 0, ms: 0, max: 0 }, { n: 0, ms: 0, max: 0 }];
  for (let g = 0; g < games; g++) {
    const swap = g % 2 === 1;
    const r = playGame({ rows, cols, cardInterval, seed: seed + g, seats: swap ? [b, a] : [a, b] });
    illegal += r.illegal.length; turns += r.turns;
    if (r.stuck) { stuck++; continue; }
    if ((r.winner === 0) !== swap) wa++; else wb++;
    r.decisions.forEach((d, i) => { const k = (i === 0) !== swap ? 0 : 1; dec[k].n += d.n; dec[k].ms += d.ms; dec[k].max = Math.max(dec[k].max, d.max); });
  }
  return { winRate: wa / Math.max(1, wa + wb), wa, wb, stuck, illegal, avgTurns: turns / games, avgMs: dec.map(d => d.ms / Math.max(1, d.n)), maxMs: dec.map(d => d.max) };
}

module.exports = { playGame, duel };
