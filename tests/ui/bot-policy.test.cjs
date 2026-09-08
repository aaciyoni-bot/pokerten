'use strict';
const assert = require('node:assert/strict');
const client = require('./load-client-bot.cjs')();
const server = require('../../functions/pokerEngine').__engineInternals;
const c = (val, suit) => ({ id: val + suit, val, suit });
const board = ['10', 'J', 'Q', 'K', 'A'].map(v => c(v, '♠'));
const hand = [c('2', '♥'), c('3', '♥')];
for (const opponents of [1, 2, 3]) {
  assert.equal(client.simMyEquity(hand, board, opponents, 'NLH', 1), Math.round(100 / (opponents + 1)));
  assert.ok(Math.abs(server.equityOf(hand, board, opponents, 'NLH', 1) - 1 / (opponents + 1)) < 1e-9);
}
// Omaha range sampling used to request >52 cards and silently return null.
const omaha = [c('A', '♥'), c('A', '♦'), c('K', '♥'), c('K', '♦'), c('7', '♣'), c('8', '♣')];
const flop = [c('Q', '♥'), c('J', '♥'), c('2', '♣')];
const clientEquity = client.simMyEquity(omaha, flop, 3, 'Omaha 6', 4);
const serverEquity = server.equityOf(omaha, flop, 3, 'Omaha 6', 4);
assert.ok(clientEquity !== null && clientEquity >= 0 && clientEquity <= 100);
assert.ok(serverEquity !== null && serverEquity >= 0 && serverEquity <= 1);
// Public-table policy must not consult another player's hidden cards.
let hiddenReads = 0;
const mine = { uid: 'bot', isBot: true, status: 'active', bet: 0, stack: 10, cards: hand };
const human = { uid: 'human', isBot: false, status: 'active', bet: 10, stack: 100 };
Object.defineProperty(human, 'cards', { get() { hiddenReads++; throw new Error('Hidden hand read'); } });
const game = { phase: 'river', highestBet: 10, minRaise: 1, handBB: 1, board, pots: [{ amount: 10 }] };
const table = { settings: { blinds: 0.5, botGodGuard: true }, players: { bot: mine, human } };
const priv = { bot: hand };
Object.defineProperty(priv, 'human', { get() { hiddenReads++; throw new Error('Hidden hand read'); } });
assert.ok(['call', 'fold', 'raise'].includes(client.botPokerMove(game, table, mine).type));
assert.ok(['call', 'fold', 'raise'].includes(server.botAction({ ...table, gameState: game, priv }, 'bot').action));
assert.equal(hiddenReads, 0);
console.log('PASS: actual client/server split-pot equity, six-card Omaha range capacity and human-table information boundary');
