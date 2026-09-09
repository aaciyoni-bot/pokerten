"""Original procedural roulette foley: ivory/wood impact and a fading ball roll."""
from pathlib import Path
import wave
import numpy as np
from scipy.signal import butter, sosfilt
root=Path(__file__).resolve().parents[1]/'assets/sounds'
sr=32000
rng=np.random.default_rng(258)
def save(name, samples):
    samples=np.clip(samples,-.92,.92)
    with wave.open(str(root/(name+'.wav')),'wb') as f:
        f.setnchannels(1);f.setsampwidth(2);f.setframerate(sr)
        f.writeframes((samples*32767).astype('<i2').tobytes())
t=np.arange(int(.12*sr))/sr
noise=sosfilt(butter(2,[900,6800],btype='bandpass',fs=sr,output='sos'),rng.normal(size=len(t)))
impact=.38*np.sin(2*np.pi*1260*t)*np.exp(-t*95)+.2*np.sin(2*np.pi*2740*t)*np.exp(-t*155)+.22*noise*np.exp(-t*210)
impact*=np.minimum(1,t/.0007)
save('roulette_tick',impact)
t=np.arange(int(6.55*sr))/sr
roll=sosfilt(butter(2,[180,2700],btype='bandpass',fs=sr,output='sos'),rng.normal(size=len(t)))
velocity=np.maximum(0,1-t/6.5)**1.8
texture=.7+.3*np.sin(2*np.pi*(43*t-2.4*t*t))**2
envelope=np.minimum(1,t/.08)*np.minimum(1,np.maximum(0,6.5-t)/.6)
save('roulette_roll',roll*.11*velocity*texture*envelope)
print('Original roulette foley generated: 6.55 s roll and 120 ms impact, bounded below clipping.')
