/* =====================================================================
   BOOT
   ===================================================================== */
updateSoundOutput();
$("#balanceNum").textContent = "0";
renderHistory();
setBetValue(100);
updateAction();
resize();
requestAnimationFrame(() => { resize(); requestAnimationFrame(frame); });
