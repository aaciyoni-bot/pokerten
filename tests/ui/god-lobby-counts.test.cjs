'use strict';
const fs = require('node:fs'), assert = require('node:assert/strict'), {JSDOM} = require('jsdom');
const w = new JSDOM('<div id="root"></div>', {url: 'https://pokerten.com/', runScripts: 'outside-only', pretendToBeVisual: true}).window;
global.window = w; global.document = w.document; Object.defineProperty(global, 'navigator', {value: w.navigator, configurable: true}); global.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react'), {createRoot} = require('react-dom/client'); w.React = React;
const html = fs.readFileSync(require.resolve('../../index.html'), 'utf8');
w.eval(html.match(/const GOD_EMAILS = [^;]+;/)[0] + '\n' + html.slice(html.indexOf('const isGodUser ='), html.indexOf('const isClubOversightUser =')) + '\nwindow.testGod = isGodUser;');
w.eval(html.slice(html.indexOf('function pokerWaitlistSummary('), html.indexOf('function QuickBotTableCreate(')));
w.eval(fs.readFileSync(require.resolve('../../assets/js/poker-god-lobby.js'), 'utf8'));
const root = createRoot(w.document.getElementById('root'));
const HAIM = 'haim29071994@gmail.com';
let tables = [{docId: 'table1', clubId: 'main', type: 'poker', players: {a: {isBot: false}, b: {isBot: true}, departed: {isBot:false,left:true}}, waitlist: [{uid:'viewer',isBot:false},{uid:'queuedbot',isBot:true}]}];
let calls = [], result = {tables: [{tableId: 'table1', humans: 1, bots: 1, unknown: 0, seated: 2, occupancyKey: '["a","b"]'}]}, user;
function Fixture() {
  const counts = w.PokerGodLobby.useCounts({user, tables, clubId: 'main', isGodUser: w.testGod});
  return React.createElement(React.Fragment, null,
    React.createElement(w.PokerGodLobby.Badge, {user, table: tables[0], counts, isGodUser: w.testGod}),
    React.createElement(w.PokerWaitlistIndicator, {table: tables[0], uid: user.uid, hideBotDetails: !w.testGod(user)}));
}
async function mount(email, role = 'player', verified = true) {
  calls = [];
  user = {uid: 'viewer', email: HAIM, role, godMode: true};
  w.fb = {auth: {currentUser: email ? {uid: 'viewer', email, emailVerified: verified} : null}, fx: async (name, args) => {calls.push({name, args}); return result;}};
  await React.act(async () => root.render(React.createElement(Fixture)));
  await React.act(async () => new Promise(resolve => setTimeout(resolve, 300)));
}
(async () => {
  for (const [email, role, verified] of [['ordinary@example.invalid', 'manager', true], ['ordinary@example.invalid', 'club_owner', true], ['ordinary@example.invalid', 'super_admin', true], ['easymarcelos@gmail.com', 'manager', true], [HAIM, 'manager', false], [null, 'manager', true]]) {
    await mount(email, role, verified);
    assert.equal(w.document.querySelector('.tbl-god-occupancy'), null, 'non-GOD has no hidden or visible badge');
    assert.equal(calls.length, 0, 'non-GOD does not request private occupancy');
    assert.equal(w.document.querySelector('.waitlist-bots'), null, 'non-GOD lobby queue does not disclose its bot split');
    assert.match(w.document.querySelector('.tbl-waitlist').textContent, /2 waiting.*You: #1/);
    assert.doesNotMatch(w.document.querySelector('.waitlist-position').title, /bots/i);
  }
  await mount(HAIM);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'godLobbyCounts');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].args)), {clubId: 'main', tableIds: ['table1']});
  assert.match(w.document.querySelector('.tbl-god-occupancy').getAttribute('aria-label'), /1 human players · 1 bots/);
  assert.match(w.document.querySelector('.waitlist-bots').textContent, /1 bot/);
  tables = [{...tables[0], gameState: {pot: 100, phase: 'river'}}];
  await React.act(async () => root.render(React.createElement(Fixture)));
  await React.act(async () => new Promise(resolve => setTimeout(resolve, 300)));
  assert.equal(calls.length, 1, 'ordinary betting updates do not refetch seats');
  // A replacement player invalidates counts immediately, even when occupancy
  // is still 2/6. The response must match the new seated roster.
  tables = [{...tables[0], players: {a: {isBot: false}, c: {isBot: false}}}];
  await React.act(async () => root.render(React.createElement(Fixture)));
  assert.match(w.document.querySelector('.tbl-god-occupancy').getAttribute('aria-label'), /Updating/);
  await React.act(async () => new Promise(resolve => setTimeout(resolve, 300)));
  assert.equal(calls.length, 2);
  assert.match(w.document.querySelector('.tbl-god-occupancy').getAttribute('aria-label'), /Updating/, 'late/stale roster is not labelled current');
  await mount('ordinary@example.invalid', 'manager');
  assert.equal(w.document.querySelector('.tbl-god-occupancy'), null, 'previous GOD details disappear on identity change');
  assert.equal(calls.length, 0);
  await React.act(async () => root.unmount());
  w.close();
  console.log('PASS: GOD-only lobby counts, role/identity denial, efficient seat refresh and stale-response protection');
})().catch(error => {console.error(error); process.exitCode = 1; w.close();});
