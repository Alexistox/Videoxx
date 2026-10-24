#!/usr/bin/env python3
"""Final audio mix: voice untouched + ambience/SFX bed ducked under it, normalised for YouTube.

  python mix.py <project> [--lufs -16] [--no-bed] [--min-ratio 16]

Writes audio/final_mix.wav (render.mjs muxes it automatically) and audio/mix_report.json.
Pass criteria (printed): voice-to-bed ratio while speaking >= 16 dB (--min-ratio; tasteful, never competes with the
voice), true peak <= -1.0 dB, integrated loudness within 0.5 LU of the target. If the ratio is too low,
lower the gains in beds.json and re-run sound_design.py - do not touch the voice.
"""
import argparse, json, math, os, re, subprocess, wave
import numpy as np

ap = argparse.ArgumentParser(); ap.add_argument('project'); ap.add_argument('--lufs', type=float, default=-16.0); ap.add_argument('--no-bed', action='store_true')
ap.add_argument('--bed-duck', type=float, default=3.0)   # sidechain ratio on the bed (low poly shorts: 1.5, the effects stay audible)
ap.add_argument('--tp', type=float, default=-1.5)   # true-peak ceiling (low poly shorts: -2)
ap.add_argument('--bed-gain', type=float, default=0.0)   # dB on the whole bed (music + sfx); the app lowers it when the voice is buried
# the voice-to-bed ratio the check asks for (default 16 dB). Styles whose effects are meant to be heard pass less: Stick stories'
# references sit 10-13 LU under the voice with music + effects (experiments/stickstory-style/analysis/story NOTES.md 3) -> 12
ap.add_argument('--min-ratio', type=float, default=16.0)
# the user's own music (Project settings > Music; first levelled to -16 LUFS so the dB setting means the same for any track): looped / cut to the video, faded in and out, at their level, ducked under the voice
ap.add_argument('--music'); ap.add_argument('--music-gain', type=float, default=-10.0); ap.add_argument('--duck', type=float, default=8.0)
# audio layers the user placed by hand (Music & effects > Layers): a json the app writes with every clip resolved
# {"clips": [{"file", "start", "in", "len", "loop", "fadeIn", "fadeOut", "gain" (dB, loudness-matched), "pan" -1..1, "duck" dB}]}
ap.add_argument('--layers')
a = ap.parse_args()
A = os.path.join(os.path.abspath(a.project), 'audio')
clean, bed, pre, out = [os.path.join(A, f) for f in ('clean.wav', 'sfx_bed.wav', 'premix.wav', 'final_mix.wav')]
ff = lambda *args: subprocess.run(['ffmpeg', '-hide_banner', '-y', '-loglevel', 'error', *args], check=True)
music = a.music if a.music and os.path.exists(a.music) else None
if music:
    w0 = wave.open(clean); dur = w0.getnframes() / w0.getframerate(); w0.close()
    has_bed = not a.no_bed and os.path.exists(bed)
    # duck: the voice sits ~12 dB over the -30 dB threshold, so ratio r takes 12*(1-1/r) dB off the music while speaking
    r = max(1.0, min(20.0, 1 / max(.05, 1 - min(a.duck, 11.4) / 12))) if a.duck > 0 else 1.0
    fo = min(2.5, dur / 4)
    g = (f'[0:a]aformat=channel_layouts=stereo,asplit={3 if has_bed else 2}[v][k1]{"[k2]" if has_bed else ""};'
         f'[{2 if has_bed else 1}:a]aformat=channel_layouts=stereo,aresample=48000,loudnorm=I=-16:TP=-2:LRA=11,aresample=48000,atrim=0:{dur:.3f},asetpts=PTS-STARTPTS,afade=t=in:st=0:duration=1.2,'
         f'afade=t=out:st={max(0, dur - fo):.3f}:duration={fo:.3f},volume={a.music_gain if a.music_gain > -40 else -120}dB[mu];'
         f'[mu][k1]sidechaincompress=threshold=0.03:ratio={r:.2f}:attack=80:release=900:makeup=1[mud];')
    if has_bed:
        g += f'[1:a]volume={a.bed_gain}dB[bg];[bg][k2]sidechaincompress=threshold=0.03:ratio={a.bed_duck}:attack=60:release=700:makeup=1[duck];[v][duck][mud]amix=inputs=3:normalize=0:duration=first[out]'
        ins = ['-i', clean, '-i', bed, '-stream_loop', '-1', '-i', music]
    else:
        g += '[v][mud]amix=inputs=2:normalize=0:duration=first[out]'; ins = ['-i', clean, '-stream_loop', '-1', '-i', music]
    ff(*ins, '-filter_complex', g, '-map', '[out]', '-ar', '48000', '-c:a', 'pcm_s16le', pre)
    print(f'your music: {os.path.basename(music)} at {a.music_gain} dB, ducked about {a.duck} dB under the voice')
elif a.no_bed or not os.path.exists(bed):
    ff('-i', clean, '-af', 'aformat=channel_layouts=stereo', '-ar', '48000', '-c:a', 'pcm_s16le', pre)
else:
    ff('-i', clean, '-i', bed, '-filter_complex',
       '[0:a]aformat=channel_layouts=stereo,asplit=2[v][key];' f'[1:a]volume={a.bed_gain}dB[bg];' f'[bg][key]sidechaincompress=threshold=0.03:ratio={a.bed_duck}:attack=60:release=700:makeup=1[duck];'
       '[v][duck]amix=inputs=2:normalize=0:duration=first[out]', '-map', '[out]', '-ar', '48000', '-c:a', 'pcm_s16le', pre)
# ---------- the user's audio layers: each clip trimmed, faded, levelled, panned, delayed to its start (sample exact) and
# ducked under the voice by its own amount (the same sidechain as the music), summed onto the premix ----------
clips = []
if a.layers and os.path.exists(a.layers):
    try: clips = [c for c in json.load(open(a.layers, encoding='utf-8')).get('clips', []) if os.path.exists(c.get('file', ''))]
    except Exception as ex: print('audio layers: could not read', a.layers, ex)
laid = pre
if clips:
    w0 = wave.open(clean); vdur = w0.getnframes() / w0.getframerate(); w0.close()
    ins, g, keys = ['-i', pre, '-i', clean], [], [i for i, c in enumerate(clips) if (c.get('duck') or 0) > 0]
    for c in clips: ins += (['-stream_loop', '-1'] if c.get('loop') else []) + ['-i', c['file']]
    if keys: g.append('[1:a]aformat=channel_layouts=stereo,' + (f'asplit={len(keys)}' + ''.join(f'[k{i}]' for i in keys) if len(keys) > 1 else f'anull[k{keys[0]}]'))
    for i, c in enumerate(clips):
        st, ln = max(0.0, float(c.get('start', 0))), max(.01, float(c.get('len') or 1))
        ln = min(ln, max(.01, vdur - st))
        fi, fo = min(float(c.get('fadeIn') or 0), ln / 2), min(float(c.get('fadeOut') or 0), ln / 2)
        p = max(-1.0, min(1.0, float(c.get('pan') or 0)))
        gl, gr = math.cos((p + 1) * math.pi / 4) * math.sqrt(2), math.sin((p + 1) * math.pi / 4) * math.sqrt(2)
        ms = int(round(st * 1000))
        f = (f'[{i + 2}:a]aformat=sample_fmts=fltp:channel_layouts=stereo,aresample=48000,atrim=start={max(0.0, float(c.get("in") or 0)):.4f}:duration={ln:.4f},asetpts=PTS-STARTPTS'
             + (f',afade=t=in:st=0:d={fi:.3f}' if fi > 0 else '') + (f',afade=t=out:st={ln - fo:.4f}:d={fo:.3f}' if fo > 0 else '')
             + f',volume={float(c.get("gain", 0)):.2f}dB,pan=stereo|c0={gl:.4f}*c0|c1={gr:.4f}*c1,adelay={ms}|{ms}')
        if i in keys:
            d = min(float(c['duck']), 11.4); r = max(1.0, min(20.0, 1 / max(.05, 1 - d / 12)))
            g.append(f + f'[c{i}];[c{i}][k{i}]sidechaincompress=threshold=0.03:ratio={r:.2f}:attack=80:release=900:makeup=1[l{i}]')
        else: g.append(f + f'[l{i}]')
    g.append('[0:a]' + ''.join(f'[l{i}]' for i in range(len(clips))) + f'amix=inputs={len(clips) + 1}:normalize=0:duration=first[out]')
    laid = os.path.join(A, 'premix_layers.wav')
    ff(*ins, '-filter_complex', ';'.join(g), '-map', '[out]', '-ar', '48000', '-c:a', 'pcm_s16le', laid)
    for c in clips: print(f"layer {os.path.basename(c['file'])}: {c.get('start', 0):.3f}s for {c.get('len', 0):.2f}s at {c.get('gain', 0):+.1f} dB" + (', looped' if c.get('loop') else '') + (f", ducks {c['duck']} dB" if c.get('duck') else ''))
r = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', laid, '-af', f'loudnorm=I={a.lufs}:TP={a.tp}:LRA=11:print_format=json', '-f', 'null', '-'],
                   capture_output=True, text=True)
m = json.loads(re.search(r'\{[^{}]*\}', r.stderr[r.stderr.rfind('{') - 1:], re.S).group(0))
ff('-i', laid, '-af', f"loudnorm=I={a.lufs}:TP={a.tp}:LRA=11:measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}:"
   f"measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true", '-ar', '48000', '-c:a', 'pcm_s16le', out)
e = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', out, '-af', 'ebur128=peak=true', '-f', 'null', '-'], capture_output=True, text=True).stderr
I = float(re.findall(r'I:\s+(-?[\d.]+) LUFS', e)[-1]); TP = float(re.findall(r'Peak:\s+(-?[\d.]+) dBFS', e)[-1])

def load(p):
    w = wave.open(p); x = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768
    return x.reshape(-1, w.getnchannels()), w.getframerate()
ratio = None
if music or (not a.no_bed and os.path.exists(bed)):
    mx, sr = load(pre); v, _ = load(clean); v = v[:, 0] * .7071
    n = min(len(mx), len(v)); part = mx[:n, 0] - v[:n]
    sp = np.zeros(n, bool)
    for p in json.load(open(os.path.join(A, 'timeline.json'), encoding='utf-8')): sp[int(p['s'] * sr):int(p['e'] * sr)] = True
    rms = lambda z: 20 * np.log10(np.sqrt(np.mean(z ** 2)) + 1e-9)
    ratio = round(float(rms(v[:n][sp]) - rms(part[sp])), 1)
rep = {'bed_gain_db': a.bed_gain, **({'music': os.path.basename(music), 'music_gain_db': a.music_gain, 'duck_db': a.duck} if music else {}),'integrated_lufs': float(I), 'true_peak_dbfs': float(TP), 'voice_to_bed_db_while_speaking': ratio,
       **({'layers': [{'file': os.path.basename(c['file']), 'start': round(float(c.get('start', 0)), 3), 'len': round(float(c.get('len') or 0), 3), 'gain_db': c.get('gain', 0)} for c in clips]} if clips else {}),
       'min_ratio_db': a.min_ratio, 'pass': bool((ratio is None or ratio >= a.min_ratio) and TP <= a.tp + .5 and abs(I - a.lufs) <= .5)}
json.dump(rep, open(os.path.join(A, 'mix_report.json'), 'w'), indent=1); os.remove(pre)
if laid != pre: os.remove(laid)
print(json.dumps(rep, indent=1))
