/* Real Natural Earth land data, embedded by the builder: no network request
 * can leave the map empty. Rasterize only when the canvas dimensions change. */
const WORLD_LAND = /*__WORLD_LAND__*/ [];
const worldOutline = new Path2D();
for (const polygon of WORLD_LAND){
  worldOutline.moveTo(polygon[0], polygon[1]);
  for (let i=2; i<polygon.length; i+=2) worldOutline.lineTo(polygon[i], polygon[i+1]);
  worldOutline.closePath();
}
const worldLayer = document.createElement('canvas');
let worldLayerKey = '';
function drawWorldMap(){
  if (!W || !H) return;
  const key = `${W}:${H}:${DPR}`;
  if (key !== worldLayerKey){
    worldLayerKey = key;
    worldLayer.width = Math.round(W * DPR); worldLayer.height = Math.round(H * DPR);
    const map = worldLayer.getContext('2d');
    map.setTransform(DPR, 0, 0, DPR, 0, 0);
    const scale = Math.min(W / 720, H / 360) * .96;
    map.translate((W - 720 * scale) / 2, (H - 360 * scale) / 2);
    map.scale(scale, scale);
    map.fillStyle = 'rgba(82,144,166,0.18)';
    map.strokeStyle = 'rgba(136,191,207,0.38)';
    map.lineWidth = .7 / scale;
    map.fill(worldOutline); map.stroke(worldOutline);
  }
  ctx.drawImage(worldLayer, 0, 0, W, H);
}

/* Load/decode once; screen blending removes the asset's pure black backdrop.
 * Flight rendering never waits for decode and never initiates a game action. */
const flightJet = new Image();
let flightJetReady = false;
flightJet.decoding = 'async';
flightJet.onload = () => { flightJetReady = true; };
flightJet.src = 'aviator-src/live/assets/flight-jet.webp';
function drawFlightJet(x, y){
  if (!flightJetReady) return;
  const width = Math.min(104, Math.max(64, W * .15));
  const height = width * flightJet.naturalHeight / flightJet.naturalWidth;
  const slopeY = GROWTH_K * S.mult * (H - PAD.t - PAD.b) / Math.max(.001, view.yMax - 1);
  const slopeX = (W - PAD.l - PAD.r) / view.xMax;
  const angle = -Math.min(.55, Math.atan2(slopeY, slopeX));
  ctx.save();
  ctx.translate(x - 8, y); ctx.rotate(angle);
  ctx.globalCompositeOperation = 'screen';
  ctx.drawImage(flightJet, -width * .55, -height * .5, width, height);
  ctx.restore();
}
