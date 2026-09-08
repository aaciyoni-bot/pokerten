/* Only presentation: fit the original live text inside its instrument face.
 * No independent multiplier, timer, wager or settlement state is introduced. */
(function () {
  const number = document.getElementById('mult');
  function fitReadout() {
    const length = number.textContent.length;
    number.style.setProperty('--readout-size', (length > 8 ? 12 : length > 6 ? 15 : 21) + 'cqw');
  }
  new MutationObserver(fitReadout).observe(number, {childList:true, characterData:true, subtree:true});
  fitReadout();
})();
