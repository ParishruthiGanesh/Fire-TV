#!/usr/bin/env python3
"""
Cut the recorded sessions into the narrated demo.

Every clip here is real footage of the running product; this step only trims,
scales and captions it. Each scene is fitted to the length of its narration so
picture and voice stay together without hand-editing.
"""
import json, os, subprocess, sys, shutil
from pathlib import Path

HERE = Path(__file__).resolve().parent
BUILD = HERE / 'build'
RAW, AUDIO, SCENES = BUILD / 'raw', BUILD / 'audio', BUILD / 'scenes'
SCENES.mkdir(parents=True, exist_ok=True)

W, H = 1920, 1080
NAVY, CREAM, AMBER = '0x101D33', '0xFAF6F0', '0xD68F2C'
FONT = '/usr/share/fonts/opentype/inter/Inter-SemiBold.otf'
FONT_R = '/usr/share/fonts/opentype/inter/Inter-Regular.otf'

def run(args):
    p = subprocess.run(args, capture_output=True, text=True)
    if p.returncode:
        sys.exit(f'ffmpeg failed:\n{" ".join(args[:12])}...\n{p.stderr[-1500:]}')

def content_crop(video):
    """
    Measure the real page area inside a Playwright recording.

    The recorder letterboxes to the video size in a mid grey, and how much it
    adds depends on the viewport it actually got, so this is measured per file
    rather than hard-coded.
    """
    w, h = (int(x) for x in subprocess.check_output(
        ['ffprobe', '-v', 'error', '-select_streams', 'v',
         '-show_entries', 'stream=width,height', '-of', 'csv=p=0', str(video)]
    ).decode().strip().split(','))
    frame = subprocess.run(
        ['ffmpeg', '-v', 'error', '-ss', '6', '-i', str(video), '-frames:v', '1',
         '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True).stdout
    for y in range(h - 1, -1, -1):
        row = frame[y * w * 3:(y * w * 3) + 30]
        if len(row) < 30:
            continue
        if not all(abs(row[i] - 128) < 12 for i in range(0, 30, 3)):
            return w, y + 1
    return w, h

def dur(path):
    return float(subprocess.check_output(
        ['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(path)]))

def wrap(text, width=78):
    words, lines, line = text.split(), [], ''
    for w in words:
        if len(line) + len(w) + 1 > width:
            lines.append(line); line = w
        else:
            line = f'{line} {w}'.strip()
    lines.append(line)
    return lines

TXT = BUILD / 'txt'

def textfile(name, content):
    """
    Put caption text in a file rather than inline.

    Filter graphs are comma-separated and quote-sensitive, so any ordinary
    sentence — which is full of commas and apostrophes — breaks the parser.
    A file has none of those problems.
    """
    TXT.mkdir(parents=True, exist_ok=True)
    path = TXT / f'{name}.txt'
    path.write_text(content)
    return str(path)

def bar_height(text):
    return 56 + 46 * len(wrap(text))

def fit_and_caption(name, text, label=None):
    """
    Letterbox the picture into the space above the caption, then draw it.

    The caption gets its own band rather than being laid over the picture:
    on the television shot it would otherwise sit straight on top of the
    buttons it is describing.
    """
    bar_h = bar_height(text)
    content_h = H - bar_h
    tf = textfile(f'{name}-caption', '\n'.join(wrap(text)))
    f = (f"scale={W}:{content_h}:force_original_aspect_ratio=decrease:flags=lanczos"
         f",pad={W}:{content_h}:(ow-iw)/2:(oh-ih)/2:color={NAVY}"
         f",pad={W}:{H}:0:0:color={NAVY}"
         f",drawtext=fontfile={FONT_R}:textfile={tf}:line_spacing=12:"
         f"fontcolor={CREAM}:fontsize=34:x=(w-text_w)/2:y={content_h}+26")
    if label:
        lf = textfile(f'{name}-label', label)
        f += (f",drawbox=x=38:y=34:w={18*len(label)+44}:h=54:color={AMBER}@0.95:t=fill"
              f",drawtext=fontfile={FONT}:textfile={lf}:fontcolor=0x2A1C05:"
              f"fontsize=28:x=60:y=50")
    return f

def fit_video(name, src, start, length, target, out, label, caption, crop):
    """Trim a clip, fit it to the narration length, letterbox it, caption it."""
    speed = max(0.55, min(2.0, length / target)) if target > 0 else 1.0
    cw, ch = crop
    vf = (f"crop={cw}:{ch}:0:0,setpts=PTS/{speed:.5f},"
          + fit_and_caption(name, caption, label))
    run(['ffmpeg', '-v', 'error', '-y', '-ss', f'{start:.3f}', '-i', str(src),
         '-filter_complex', vf, '-t', f'{target:.3f}',
         '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
         '-pix_fmt', 'yuv420p', '-r', '30', str(out)])

def still_scene(name, src, target, out, label, caption):
    """
    A held screen. Deliberately not zoomed: any crop on a television frame cuts
    the very buttons the shot is there to show.
    """
    vf = fit_and_caption(name, caption, label) + ',fade=t=in:st=0:d=0.4'

    run(['ffmpeg', '-v', 'error', '-y', '-loop', '1', '-i', str(src),
         '-filter_complex', vf, '-t', f'{target:.3f}',
         '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
         '-pix_fmt', 'yuv420p', '-r', '30', str(out)])

def card_scene(name, spec, target, out, caption):
    title, _, sub = spec.partition('|')
    tf, sf = textfile(f'{name}-title', title), textfile(f'{name}-sub', sub)
    vf = (f"drawtext=fontfile={FONT}:textfile={tf}:fontcolor={CREAM}:fontsize=104:"
          f"x=(w-text_w)/2:y=(h-text_h)/2-90,"
          f"drawtext=fontfile={FONT_R}:textfile={sf}:fontcolor=0xC3CEDD:fontsize=44:"
          f"x=(w-text_w)/2:y=(h-text_h)/2+40,"
          f"drawbox=x=(iw-180)/2:y=(ih/2)-10:w=180:h=5:color={AMBER}:t=fill,"
          + fit_and_caption(name, caption))
    run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi',
         '-i', f'color=c={NAVY}:s={W}x{H}:d={target:.3f}:r=30',
         '-filter_complex', vf, '-an', '-c:v', 'libx264', '-preset', 'medium',
         '-crf', '20', '-pix_fmt', 'yuv420p', str(out)])

def main():
    spec = json.loads((HERE / 'narration.json').read_text())
    webms = sorted(RAW.glob('*.webm'), key=lambda p: p.stat().st_mtime)
    if len(webms) < 3:
        sys.exit('expected three recorded sessions in build/raw')
    sources = {'web': webms[0], 'voice': webms[1], 'dash': webms[2]}
    crops = {k: content_crop(v) for k, v in sources.items()}
    for k, c in crops.items():
        print(f'  crop {k}: {c[0]}x{c[1]}')

    cm = {m['id']: m['at'] for m in json.loads((RAW / 'marks-caregiver.json').read_text())['marks']}
    vm_raw = json.loads((RAW / 'marks-voice.json').read_text())
    vm = {m['id']: m['at'] for m in vm_raw['vMarks']}
    dm = {m['id']: m['at'] for m in vm_raw['dMarks']}

    web_order = ['02-dashboard', '03-describe', '04-asks', '05-steps', '06-publish', '06-published']
    voice_order = ['08-ask', '09-postpone', '12-help', '12-help-end']
    dash_order = ['12-help', '13-final']

    def span(marks, order, key, total):
        i = order.index(key)
        start = marks[key]
        end = marks[order[i + 1]] if i + 1 < len(order) else total
        return start, max(0.6, end - start)

    parts, labels = [], {'web': "Caregiver's dashboard", 'voice': 'Alexa+ experience simulation',
                         'tv': 'Fire TV app', 'dash': "Caregiver's dashboard"}
    for scene in spec['scenes']:
        sid, source, text = scene['id'], scene['source'], scene['text']
        wav = AUDIO / f'{sid}.wav'
        target = dur(wav) + 0.65
        out = SCENES / f'{sid}.mp4'
        kind, _, ref = source.partition(':')
        print(f'  {sid:16} {kind:6} {target:5.2f}s')
        if kind == 'card':
            card_scene(sid, ref, target, out, text)
        elif kind == 'tv':
            still = HERE / 'stills' / f'{ref}.png'
            still_scene(sid, still, target, out, 'Fire TV app', text)
        else:
            src = sources['web'] if kind == 'web' and ref in web_order else None
            if kind == 'web' and ref in web_order:
                start, length = span(cm, web_order, ref, dur(sources['web']))
                src = sources['web']
            elif kind == 'voice':
                start, length = span(vm, voice_order, ref, dur(sources['voice']))
                src = sources['voice']
            else:  # web mark that lives on the dashboard recording
                start, length = span(dm, dash_order, ref, dur(sources['dash']))
                src = sources['dash']
            fit_video(sid, src, start, length, target, out, labels[kind], text,
                      crops['web'] if src is sources['web'] else
                      crops['voice'] if src is sources['voice'] else crops['dash'])
        parts.append(out)

    listing = BUILD / 'parts.txt'
    listing.write_text('\n'.join(f"file '{p}'" for p in parts))
    silent = BUILD / 'silent.mp4'
    run(['ffmpeg', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', str(listing),
         '-c', 'copy', str(silent)])

    wavs = BUILD / 'audio.txt'
    wavs.write_text('\n'.join(f"file '{AUDIO / (s['id'] + '.wav')}'" for s in spec['scenes']))
    # Pad each narration to its scene length so voice and picture stay aligned.
    padded = []
    for s in spec['scenes']:
        w = AUDIO / f"{s['id']}.wav"
        p = BUILD / f"pad-{s['id']}.wav"
        run(['ffmpeg', '-v', 'error', '-y', '-i', str(w),
             '-af', f'apad=whole_dur={dur(w) + 0.65:.3f}', str(p)])
        padded.append(p)
    (BUILD / 'audio.txt').write_text('\n'.join(f"file '{p}'" for p in padded))
    track = BUILD / 'narration.wav'
    run(['ffmpeg', '-v', 'error', '-y', '-f', 'concat', '-safe', '0',
         '-i', str(BUILD / 'audio.txt'), '-c', 'copy', str(track)])

    final = BUILD / 'alongside-demo.mp4'
    run(['ffmpeg', '-v', 'error', '-y', '-i', str(silent), '-i', str(track),
         '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-shortest', str(final)])
    print(f'\n  {final}  {dur(final):.1f}s')

main()
