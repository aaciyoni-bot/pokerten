/* Presentation-only build transform. Existing controls and live element IDs
 * are retained so the authoritative game, money and timing paths are unchanged. */
module.exports = function cockpitLayout(body) {
  function replaceOnce(from, to) {
    if (!body.includes(from) || body.indexOf(from) !== body.lastIndexOf(from)) {
      throw new Error('Cockpit layout anchor missing or duplicated: ' + from.slice(0, 60));
    }
    body = body.replace(from, to);
  }
  const history = '<div id="history" aria-label="Round history"></div>';
  replaceOnce(history, '');
  replaceOnce('</header>', '</header><aside class="historyGroup" aria-label="Previous rounds"><span class="panelLabel">RECENT</span>' + history + '</aside>');
  replaceOnce('<span class="word">AVIATORIZIS</span>', '<span class="word">AVIATORIZIS</span><span class="brandSub"><i class="avIcon planeIcon" aria-hidden="true"></i> FLIGHT DECK</span>');
  replaceOnce('<span id="balanceNum">0</span>', '<span class="balanceReadout"><span id="balanceNum">0</span><span class="panelLabel">PLAY CHIPS</span></span>');
  replaceOnce('</header>', '</header><div class="cockpitHorizon" aria-hidden="true"></div>');

  const from = body.indexOf('      <div id="stageCenter">');
  const to = body.indexOf('      <div id="winToast">', from);
  if (from < 0 || to < from) throw new Error('Missing live multiplier/countdown block');
  const center = body.slice(from, to);
  body = body.slice(0, from) + body.slice(to);
  const instrument = '<section id="flightInstrument" aria-label="Live flight multiplier">' +
    '<div class="instrumentFace">' + center +
    '<p class="instrumentBoot">CONNECTING…</p><p id="flightStatus" class="instrumentCaption" role="status">FLIGHT DECK</p></div></section>';
  replaceOnce('      <div id="winToast">', instrument + '\n      <div id="winToast">');
  replaceOnce('  <section id="betPanel">', '<section id="betPanel" aria-label="Flight controls">');
  replaceOnce('<section id="stage">', '<section id="stage" aria-label="Live flight graph"><div class="chartHeading"><i class="avIcon planeIcon" aria-hidden="true"></i><span>LIVE FLIGHT</span></div>');
  replaceOnce('<div id="amountBox">', '<div class="amountControl"><label class="panelLabel" for="betInput">BET AMOUNT</label><div id="amountBox">');
  replaceOnce('      <div id="autoBox">', '      </div><div id="autoBox">');
  replaceOnce('<span class="lbl">Auto<br>cash&nbsp;out</span>', '<label class="lbl" for="autoInput">AUTO CASH OUT</label>');
  replaceOnce('    <div id="players"></div>', '<div class="playerColumns" aria-hidden="true"><span>PILOT</span><span>CHIPS</span><span>CASH OUT</span></div><div id="players"></div>');
  return body.replace(/^[\t ]+$/gm, '');
};
