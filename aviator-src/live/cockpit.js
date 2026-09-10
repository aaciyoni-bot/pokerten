/* Presentation reads the same round, pending action and confirmed bet state. */
let flightLabel = "";
function updateFlightStatus(){
  const label = pendingCash && pendingCash.roundId === S.roundId ? "REQUEST SENT" :
    S.phase === "crashed" ? "FLIGHT ENDED" : S.phase === "waiting" ? "BOARDING" :
    S.phase === "flying" && !quoteFresh() ? "CONNECTION DELAY" :
    myBet && myBet.cashedAt ? (myBet.auto ? "AUTO EXIT CONFIRMED" : "EXIT CONFIRMED") :
    S.phase === "flying" ? "IN FLIGHT" : "CONNECTING";
  if (label !== flightLabel){ flightLabel = label; document.getElementById('flightStatus').textContent = label; }
}
(function () {
  const number = document.getElementById('mult');
  let lastLength = 0;
  function fitReadout() {
    const length = number.textContent.length;
    if (length === lastLength) return;
    lastLength = length;
    number.style.setProperty('--readout-size', (length > 8 ? 12 : length > 6 ? 15 : 19) + 'cqw');
  }
  new MutationObserver(fitReadout).observe(number, {childList:true, characterData:true, subtree:true});
  fitReadout();
})();
