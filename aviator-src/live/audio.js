/* =====================================================================
   SOUND ENGINE — existing wav pack + procedural rising tone (WebAudio)
   ===================================================================== */
const SND_FILES = {
  bet:    ["assets/sounds/chip_single_1.wav","assets/sounds/chip_single_2.wav"],
  chip:   ["assets/sounds/chip_single_1.wav","assets/sounds/chip_single_2.wav"],
  slide:  ["assets/sounds/chips_slide_1.wav","assets/sounds/chips_slide_2.wav","assets/sounds/chips_slide_3.wav"],
  tick:   ["assets/sounds/timer_tick_1.wav","assets/sounds/timer_tick_2.wav"],
  win:    ["assets/sounds/win_pot.wav"],
  bigwin: ["assets/sounds/big_win.wav"],
  crash:  ["assets/sounds/bust.wav"],
  join:   ["assets/sounds/player_join.wav"],
  ui:     ["assets/sounds/card_flip_1.wav","assets/sounds/card_flip_2.wav"]
};
let audioUnlocked = false;
let entered = false;   // no sound until the player taps TAKE OFF
let AC = null, jetSrc = null, jetGain = null, jetFilter = null, jetBuf = null,
    rumbleOsc = null, rumbleGain = null, whineOsc = null, whineGain = null;
let masterGain = null, audioResumePending = false;
const bufferCache = new Map();

function updateSoundOutput(){
  const silent = muted || document.visibilityState === "hidden";
  if (masterGain && AC) {
    masterGain.gain.cancelScheduledValues(AC.currentTime);
    masterGain.gain.setTargetAtTime(silent ? 0 : 0.75, AC.currentTime, 0.01);
  }
  $("#soundBtn").textContent = muted ? "🔇" : "🔊";
  $("#soundBtn").setAttribute("aria-label", muted ? "Unmute sound" : "Mute sound");
  $("#soundBtn").setAttribute("aria-pressed", String(!muted));
}
function unlockAudio(){
  try{
    if (!AC){
      AC = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = AC.createGain();
      masterGain.gain.value = muted ? 0 : 0.75;
      masterGain.connect(AC.destination);
      Object.values(SND_FILES).flat().forEach(loadBuffer);
    }
    audioUnlocked = AC.state === "running";
    $("#audioHint").classList.toggle("off", audioUnlocked || muted);
    if (!audioUnlocked && !audioResumePending){
      audioResumePending = true;
      AC.resume().then(() => {
        audioUnlocked = AC.state === "running";
        $("#audioHint").classList.toggle("off", audioUnlocked || muted);
        if (audioUnlocked && entered && !muted && S.phase === "flying" && !jetSrc) toneStart();
      }).catch(() => {
        audioUnlocked = false;
        $("#audioHint").classList.toggle("off", muted);
      }).finally(() => { audioResumePending = false; });
    }
  }catch(e){ audioUnlocked = false; }
}
function loadBuffer(url){
  if (!AC || bufferCache.has(url)) return;
  bufferCache.set(url, null);
  fetch(url).then(r => r.arrayBuffer())
    .then(ab => AC.decodeAudioData(ab))
    .then(buf => bufferCache.set(url, buf))
    .catch(() => {});
}
function play(name, vol = 0.5, rateVar = 0.08){
  if (!entered || muted || !AC || !audioUnlocked) return;
  const buf = bufferCache.get(pick(SND_FILES[name] || []));
  if (!buf) return;
  const src = AC.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = 1 + rand(-rateVar, rateVar);
  const g = AC.createGain();
  g.gain.value = vol;
  src.connect(g).connect(masterGain);
  src.start();
}
/* jet-engine take-off during flight: three layers — broadband roar
   (noise through an opening lowpass), low engine rumble, and a faint
   turbine whine — with a full-throttle spool-up in the first ~1.6s */
function jetBuffer(){
  if (jetBuf) return jetBuf;
  const len = AC.sampleRate * 2;
  jetBuf = AC.createBuffer(1, len, AC.sampleRate);
  const d = jetBuf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++){
    const w = Math.random() * 2 - 1;
    last = (last + 0.03 * w) / 1.03;
    d[i] = last * 2.6 + w * 0.22;
  }
  return jetBuf;
}
function toneStart(){
  if (!entered || muted || !AC || !audioUnlocked) return;
  toneStop(0.01);
  jetSrc = AC.createBufferSource();
  jetSrc.buffer = jetBuffer();
  jetSrc.loop = true;
  jetFilter = AC.createBiquadFilter();
  jetFilter.type = "lowpass";
  jetFilter.frequency.value = 420;
  jetFilter.Q.value = 0.8;
  jetGain = AC.createGain();
  jetGain.gain.value = 0;
  jetSrc.connect(jetFilter).connect(jetGain).connect(masterGain);
  jetSrc.playbackRate.value = 0.7;
  jetSrc.start();
  rumbleOsc = AC.createOscillator();
  rumbleOsc.type = "sawtooth";
  rumbleOsc.frequency.value = 43;
  const rf = AC.createBiquadFilter();
  rf.type = "lowpass"; rf.frequency.value = 130;
  rumbleGain = AC.createGain();
  rumbleGain.gain.value = 0;
  rumbleOsc.connect(rf).connect(rumbleGain).connect(masterGain);
  rumbleOsc.start();
  whineOsc = AC.createOscillator();
  whineOsc.type = "sine";
  whineOsc.frequency.value = 1400;
  whineGain = AC.createGain();
  whineGain.gain.value = 0;
  whineOsc.connect(whineGain).connect(masterGain);
  whineOsc.start();
}
function toneUpdate(m){
  if (!jetSrc) return;
  const ft = (eNow() - S.phaseAt) / 1000;
  const spool = Math.min(1, ft / 1.6);
  const tc = AC.currentTime;
  jetGain.gain.setTargetAtTime(0.36 * spool + clamp((m - 1) * 0.012, 0, 0.1), tc, 0.15);
  jetFilter.frequency.setTargetAtTime(420 + 1250 * spool + clamp((m - 1) * 260, 0, 2000), tc, 0.2);
  jetSrc.playbackRate.setTargetAtTime(0.7 + 0.36 * spool + clamp((m - 1) * 0.1, 0, 1), tc, 0.25);
  rumbleGain.gain.setTargetAtTime(0.1 * spool, tc, 0.2);
  whineGain.gain.setTargetAtTime(0.015 * spool, tc, 0.3);
  whineOsc.frequency.setTargetAtTime(clamp(1400 + 1300 * spool + (m - 1) * 220, 1400, 5200), tc, 0.3);
}
function toneStop(fade = 0.12){
  if (!jetSrc) return;
  const nodes = [[jetSrc, jetGain], [rumbleOsc, rumbleGain], [whineOsc, whineGain]];
  jetSrc = null; jetGain = null; jetFilter = null;
  rumbleOsc = null; rumbleGain = null; whineOsc = null; whineGain = null;
  for (const [src, g] of nodes){
    try{
      g.gain.setTargetAtTime(0, AC.currentTime, fade);
      src.stop(AC.currentTime + fade * 6 + 0.05);
    }catch(e){}
  }
}
function haptic(ms){ if (!REDUCED && navigator.vibrate) navigator.vibrate(ms); }

/* cabin ambience: seatbelt-sign chime + radio call before takeoff */
let noiseBuf = null;
function noiseBuffer(){
  if (noiseBuf) return noiseBuf;
  const len = AC.sampleRate * 1.2;
  noiseBuf = AC.createBuffer(1, len, AC.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}
function beltChime(){
  if (!entered || muted || !AC || !audioUnlocked) return;
  const t = AC.currentTime;
  [[987, 0], [659, 0.3]].forEach(([f, d]) => {
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = "sine"; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t + d);
    g.gain.linearRampToValueAtTime(0.09, t + d + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d + 1);
    o.connect(g).connect(masterGain);
    o.start(t + d); o.stop(t + d + 1.1);
  });
}
function radioCall(){
  if (!entered || muted || !AC || !audioUnlocked) return;
  const t = AC.currentTime;
  const src = AC.createBufferSource(); src.buffer = noiseBuffer();
  const bp = AC.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1600; bp.Q.value = 4.5;
  const g = AC.createGain(); g.gain.value = 0;
  src.connect(bp).connect(g).connect(masterGain);
  let tt = t + 0.06;
  g.gain.setValueAtTime(0.001, t);
  for (let i = 0; i < 7; i++){
    g.gain.linearRampToValueAtTime(rand(0.02, 0.05), tt); tt += rand(0.05, 0.12);
    g.gain.linearRampToValueAtTime(rand(0.003, 0.01), tt); tt += rand(0.03, 0.06);
  }
  g.gain.linearRampToValueAtTime(0.0001, tt + 0.04);
  src.start(t); src.stop(tt + 0.15);
  const o = AC.createOscillator(), og = AC.createGain();
  o.frequency.value = 2300;
  og.gain.setValueAtTime(0.04, tt); og.gain.exponentialRampToValueAtTime(0.0001, tt + 0.07);
  o.connect(og).connect(masterGain); o.start(tt); o.stop(tt + 0.09);
}
