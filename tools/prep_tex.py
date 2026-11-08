"""Ground textures: design/tex/<name>.png -> web/public/tex/<name>.jpg (1024, seams blended away),
plus web/src/realm/texAvg.json with each texture's mean colour in linear RGB (the shader divides by it,
so a texture only adds detail and the map keeps its painted colours)."""
import json
from pathlib import Path
from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parent.parent
SRC, OUT = ROOT / 'design/tex', ROOT / 'web/public/tex'
N = 1024

def edge_mask(n):
    # 0 in the middle, rising to 1 at the borders: where the half-shifted copy takes over.
    m = Image.new('L', (n, n))
    px = []
    for j in range(n):
        y = abs(j / (n - 1) * 2 - 1)
        for i in range(n):
            x = abs(i / (n - 1) * 2 - 1)
            v = min(1.0, max(0.0, (max(x, y) - 0.55) / 0.4)) ** 1.5
            px.append(int(v * 255))
    m.putdata(px)
    return m

def lin(c):
    c /= 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

MASK = edge_mask(N)
avg = {}
for p in sorted(SRC.glob('*.png')):
    img = Image.open(p).convert('RGB').resize((N, N), Image.LANCZOS)
    out = Image.composite(ImageChops.offset(img, N // 2, N // 2), img, MASK)
    out.save(OUT / f'{p.stem}.jpg', quality=86)
    small = list(out.resize((64, 64), Image.BOX).getdata())
    avg[p.stem] = [round(sum(lin(float(px[k])) for px in small) / len(small), 4) for k in range(3)]
    print(p.stem, avg[p.stem])
(ROOT / 'web/src/realm/texAvg.json').write_text(json.dumps(avg, indent=1) + '\n')
