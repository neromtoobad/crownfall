# The Ashen Throne, modelled in code: the empty seat every house in Vael is fighting for.
# Not a chair of swords: a giant's throne of ash-black iron on an eight-sided dais (one side for each house),
# with a fan of iron shards behind it that rises into a crown, gold-tipped at the top, a red velvet seat, a crown
# set with the eight houses' stones, embers glowing in the cracks of the iron, braziers, and the houses' coin
# spilled down the steps.
#   Blender -b -P throne.py -- [glb|still|all]
# Exports web/public/env/throne.glb (1.6 MB), then compress it in place (to about 150 KB; the game loads it with Draco):
#   npx @gltf-transform/cli draco web/public/env/throne.glb web/public/env/throne.glb
# glTF frame: up y, the throne faces +z (Blender -y). Origin: dais centre, ground.
import bpy, bmesh, math, os, random, sys
from mathutils import Vector, Matrix, Euler

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, '..', '..', 'web', 'public', 'env'))
mode = (sys.argv[sys.argv.index('--') + 1:] or ['all'])[0] if '--' in sys.argv else 'all'
random.seed(7)
lin = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
def hexc(h, a=1.0): h = h.lstrip('#'); return (*(lin(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4)), a)

bpy.ops.wm.read_factory_settings(use_empty=True)

# ---------- materials ----------
MATS = {}
def mat(name, color, metal=0.0, rough=0.5, emit=None, strength=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs['Base Color'].default_value = hexc(color)
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    if emit:
        b.inputs['Emission Color'].default_value = hexc(emit)
        b.inputs['Emission Strength'].default_value = strength
    MATS[name] = m; return m

mat('stone', '#3d3935', 0.0, 0.82)          # the dais: dark basalt
mat('iron', '#26221f', 0.85, 0.42)          # blackened iron
mat('ash', '#4a4541', 0.7, 0.55)            # iron gone grey with ash
mat('gold', '#d4a849', 1.0, 0.28)
mat('velvet', '#6a0f17', 0.0, 0.72)
mat('ember', '#ff5a14', 0.0, 0.6, '#ff5a14', 4.0)
mat('coals', '#ff7a2a', 0.0, 0.6, '#ff8a30', 9.0)
HOUSE = ['#c9cdd4', '#b3261e', '#e0b23a', '#2f8a3f', '#f2f0ea', '#c07a2a', '#a9d3ee', '#e0442e']  # each house's stone
for i, c in enumerate(HOUSE): mat(f'gem{i}', c, 0.2, 0.15, c, 1.6)

PARTS = []
def put(o, m, bevel=0.0, seg=2, smooth=None):
    if bevel:
        md = o.modifiers.new('b', 'BEVEL'); md.width = bevel; md.segments = seg; md.limit_method = 'ANGLE'
        bpy.context.view_layer.objects.active = o; bpy.ops.object.modifier_apply(modifier='b')
    o.data.materials.clear(); o.data.materials.append(MATS[m])
    for p in o.data.polygons: p.use_smooth = False
    if smooth:
        for p in o.data.polygons: p.use_smooth = True
        try:
            bpy.context.view_layer.objects.active = o; o.select_set(True)
            bpy.ops.object.shade_smooth_by_angle(angle=math.radians(smooth))
            o.select_set(False)
        except Exception: pass
    PARTS.append(o); return o

def box(sx, sy, sz, loc, m, rot=(0, 0, 0), bevel=0.0, seg=2, smooth=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.active_object; o.scale = (sx, sy, sz)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return put(o, m, bevel, seg, smooth)

def cyl(r, h, loc, m, n=24, rot=(0, 0, 0), bevel=0.0, smooth=None, r2=None):
    if r2 is None: bpy.ops.mesh.primitive_cylinder_add(vertices=n, radius=r, depth=h, location=loc, rotation=rot)
    else: bpy.ops.mesh.primitive_cone_add(vertices=n, radius1=r, radius2=r2, depth=h, location=loc, rotation=rot)
    return put(bpy.context.active_object, m, bevel, 2, smooth)

def sphere(r, loc, m, n=16, rings=10, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=n, ring_count=rings, radius=r, location=loc)
    o = bpy.context.active_object; o.scale = scale
    bpy.ops.object.transform_apply(scale=True)
    return put(o, m, smooth=180)

def torus(R, r, loc, m, rot=(0, 0, 0), n=40, k=8):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, major_segments=n, minor_segments=k, location=loc, rotation=rot)
    return put(bpy.context.active_object, m, smooth=180)

def from_pydata(name, verts, faces, m, smooth=None):
    me = bpy.data.meshes.new(name); me.from_pydata(verts, [], faces); me.update()
    o = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(o)
    return put(o, m, smooth=smooth)

# ---------- the dais: three octagonal tiers, a flat face to the front ----------
TIERS = [(8.0, 0.0), (6.6, 0.9), (5.2, 1.8)]
TH = 0.9
TOP = 2.7
for R, z0 in TIERS:
    cyl(R, TH, (0, 0, z0 + TH / 2), 'stone', n=8, rot=(0, 0, math.pi / 8), bevel=0.05)
    cyl(R + 0.05, 0.12, (0, 0, z0 + TH - 0.09), 'gold', n=8, rot=(0, 0, math.pi / 8))   # gold rim
face = lambda R: R * math.cos(math.pi / 8)  # distance to a flat face
# The stair up the front, with a red runner.
N = 9; y0 = -face(8.0) - 1.2; y1 = -face(5.2) + 0.1; run = (y1 - y0) / N
for i in range(N):
    yf = y0 + i * run; h = (i + 1) * 0.3
    box(3.6, y1 + 0.6 - yf, h, (0, (yf + y1 + 0.6) / 2, h / 2), 'stone', bevel=0.03)
    box(1.9, run + 0.02, 0.04, (0, yf + run / 2, h + 0.02), 'velvet')
for sx in (-1, 1):  # stair cheeks with gold caps
    box(0.45, y1 - y0, 0.5, (sx * 2.0, (y0 + y1) / 2 + 0.25, 1.4), 'stone', rot=(math.atan2(TOP, y1 - y0), 0, 0), bevel=0.04)
box(1.9, 4.0, 0.04, (0, -face(5.2) + 2.1, TOP + 0.02), 'velvet')  # the runner across the top tier

# ---------- braziers on the top tier ----------
BRAZIERS = []
for sx in (-1, 1):
    x, y = sx * 3.3, -2.9
    cyl(0.32, 1.5, (x, y, TOP + 0.75), 'iron', n=8, bevel=0.03)
    cyl(0.5, 0.18, (x, y, TOP + 0.09), 'iron', n=8)
    cyl(0.75, 0.55, (x, y, TOP + 1.75), 'iron', n=16, r2=0.35, rot=(math.pi, 0, 0), smooth=40)
    torus(0.76, 0.05, (x, y, TOP + 2.02), 'gold', n=24, k=6)
    sphere(0.62, (x, y, TOP + 1.98), 'coals', n=12, rings=6, scale=(1, 1, 0.28))
    BRAZIERS.append((x, y, TOP + 2.1))

# ---------- the throne ----------
H0 = TOP          # plinth bottom
SEAT = H0 + 2.5   # seat top
BY = 1.25         # back panel centre (y)
box(5.4, 4.4, 0.5, (0, 0.5, H0 + 0.25), 'iron', bevel=0.06)
box(5.8, 4.8, 0.08, (0, 0.5, H0 + 0.5), 'gold')
box(3.8, 3.0, 1.95, (0, 0.35, H0 + 0.5 + 0.975), 'iron', bevel=0.05)              # body
box(4.0, 3.2, 0.42, (0, 0.35, SEAT - 0.21), 'iron', bevel=0.08, seg=3, smooth=35)  # seat slab
box(4.06, 3.26, 0.06, (0, 0.35, SEAT - 0.46), 'gold')
box(3.5, 2.6, 0.42, (0, 0.2, SEAT + 0.2), 'velvet', bevel=0.15, seg=4, smooth=60)  # cushion
for sx in (-1, 1):  # front legs: square posts with a lion's-ball foot
    box(0.55, 0.55, 2.0, (sx * 1.8, -1.05, H0 + 0.5 + 1.0), 'iron', bevel=0.05)
    sphere(0.42, (sx * 1.8, -1.05, H0 + 0.5 + 0.3), 'gold')
# A panel in the front of the body, cracked with embers.
box(2.6, 0.1, 1.2, (0, -1.17, H0 + 1.45), 'ash', bevel=0.03)

def cracks(n, origin, axis_u, axis_v, w, h, thick=0.035, depth=0.05, seed=0):
    """Glowing cracks on a face: random walks inside a w x h rectangle (u right, v up) at origin (its centre)."""
    rnd = random.Random(seed); o, U, V = Vector(origin), Vector(axis_u), Vector(axis_v)
    N = U.cross(V).normalized()
    for _ in range(n):
        p = Vector((rnd.uniform(-w / 2, w / 2), rnd.uniform(-h / 2, h / 2))); a = rnd.uniform(0, math.tau)
        for _ in range(rnd.randint(4, 9)):
            a += rnd.uniform(-0.9, 0.9); L = rnd.uniform(0.12, 0.32)
            q = p + Vector((math.cos(a), math.sin(a))) * L
            if abs(q.x) > w / 2 or abs(q.y) > h / 2: break
            mid = (p + q) / 2; c = o + U * mid.x + V * mid.y
            d = q - p; ang = math.atan2(d.y, d.x)
            bpy.ops.mesh.primitive_cube_add(size=1)
            ob = bpy.context.active_object
            basis = Matrix((U, V, N)).transposed()
            ob.matrix_world = Matrix.Translation(c) @ basis.to_4x4() @ Matrix.Rotation(ang, 4, 'Z') @ Matrix.Diagonal((L + thick, thick * rnd.uniform(0.6, 1.4), depth, 1))
            bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
            put(ob, 'ember'); p = q

cracks(9, (0, -1.22, H0 + 1.45), (1, 0, 0), (0, 0, 1), 2.4, 1.0, seed=3)
cracks(10, (0, -face(5.2) - 0.02, TOP - 0.45), (1, 0, 0), (0, 0, 1), 3.2, 0.7, seed=5)   # top tier riser, beside the stair? (hidden behind the stair in the middle)

# Arms: thick iron with gold finials, a short shard rising from each.
for sx in (-1, 1):
    x = sx * 2.25
    box(0.7, 3.3, 2.9, (x, 0.35, H0 + 0.5 + 1.45), 'iron', bevel=0.06)
    box(0.95, 3.6, 0.3, (x, 0.25, H0 + 0.5 + 2.95), 'iron', bevel=0.08, seg=3, smooth=35)
    box(0.99, 3.64, 0.05, (x, 0.25, H0 + 0.5 + 2.78), 'gold')
    sphere(0.38, (x, -1.45, H0 + 0.5 + 3.3), 'gold')
    torus(0.36, 0.06, (x, -1.45, H0 + 0.5 + 3.12), 'gold', n=20, k=6)
    cracks(4, (x + sx * 0.36, 0.35, H0 + 1.9), (0, -sx, 0), (0, 0, 1), 2.6, 1.6, seed=11 + sx)

# The back: a tall pointed arch of iron, red velvet inset, a gold border and an ember jewel.
def arch_outline(w, hs, ha, n=14):
    """Points of a pointed arch (u, v): straight sides to hs, then two arcs meeting at hs + ha."""
    r = (w * w / 4 + ha * ha) / w  # radius of each arc (centre on the springing line)
    pts = [(-w / 2, 0), (w / 2, 0), (w / 2, hs)]
    cx = w / 2 - r
    a0, a1 = 0, math.atan2(ha, -cx)
    for i in range(1, n + 1):
        a = a0 + (a1 - a0) * i / n; pts.append((cx + r * math.cos(a), hs + r * math.sin(a)))
    for i in range(n - 1, -1, -1):
        a = a0 + (a1 - a0) * i / n; pts.append((-(cx + r * math.cos(a)), hs + r * math.sin(a)))
    return pts

def slab(name, pts, y, t, z0, m, bevel=0.0, smooth=None):
    n = len(pts)
    verts = [(u, y - t / 2, z0 + v) for u, v in pts] + [(u, y + t / 2, z0 + v) for u, v in pts]
    faces = [list(range(n))[::-1], list(range(n, 2 * n))] + [[i, (i + 1) % n, n + (i + 1) % n, n + i] for i in range(n)]
    o = from_pydata(name, verts, faces, m)
    if bevel:
        md = o.modifiers.new('b', 'BEVEL'); md.width = bevel; md.segments = 2; md.limit_method = 'ANGLE'
        bpy.context.view_layer.objects.active = o; bpy.ops.object.modifier_apply(modifier='b')
    if smooth:
        for p in o.data.polygons: p.use_smooth = True
    return o

slab('back', arch_outline(4.4, 4.6, 3.6), BY, 0.8, SEAT - 0.1, 'iron', bevel=0.06)
slab('back-gold', arch_outline(3.7, 4.3, 3.0), BY - 0.42, 0.06, SEAT + 0.15, 'gold')
slab('back-velvet', arch_outline(3.3, 4.05, 2.7), BY - 0.48, 0.1, SEAT + 0.3, 'velvet', smooth=True)
jy = BY - 0.6
torus(0.42, 0.07, (0, jy, SEAT + 5.55), 'gold', rot=(math.pi / 2, 0, 0), n=28, k=8)
sphere(0.3, (0, jy - 0.05, SEAT + 5.55), 'ember', n=14, rings=8, scale=(1, 0.6, 1))
for sx in (-1, 1):  # gothic pinnacles at the back's shoulders
    box(0.6, 0.9, 1.4, (sx * 2.15, BY, SEAT + 4.6 + 0.7 - 0.1), 'iron', bevel=0.04)
    cyl(0.42, 1.6, (sx * 2.15, BY, SEAT + 5.9 + 0.8 - 0.1), 'iron', n=4, r2=0.0, rot=(0, 0, math.pi / 4))
    sphere(0.16, (sx * 2.15, BY, SEAT + 7.25), 'gold', n=10, rings=6)

# ---------- the shards: a fan of iron behind the back that rises into a crown ----------
def shard(base, d, L, w, t, roll, tip_gold):
    """A long tapered iron shard with a diamond section, slightly curved, from base along d."""
    d = d.normalized()
    side = d.cross(Vector((0, 1, 0)));
    if side.length < 1e-3: side = Vector((1, 0, 0))
    side.normalize(); up = side.cross(d).normalized()
    side, up = side * math.cos(roll) + up * math.sin(roll), up * math.cos(roll) - side * math.sin(roll)
    rings = [(0.0, 1.0), (0.35, 1.05), (0.7, 0.75), (0.88, 0.42)]
    bend = random.uniform(-0.06, 0.06) * L
    def at(k): return base + d * (L * k) + side * (bend * math.sin(math.pi * k))
    verts = []
    for k, s in rings:
        c = at(k)
        verts += [c + side * (w / 2 * s), c + up * (t / 2 * s), c - side * (w / 2 * s), c - up * (t / 2 * s)]
    tip = at(1.0)
    faces = []
    for r in range(len(rings) - 1):
        a, b = r * 4, (r + 1) * 4
        if tip_gold and r == len(rings) - 2: break
        for j in range(4): faces.append([a + j, a + (j + 1) % 4, b + (j + 1) % 4, b + j])
    faces.append([3, 2, 1, 0])
    mname = random.choice(['iron', 'iron', 'ash'])
    if not tip_gold:
        verts.append(tip); last = (len(rings) - 1) * 4; ti = len(verts) - 1
        for j in range(4): faces.append([last + j, last + (j + 1) % 4, ti])
        from_pydata('shard', [tuple(v) for v in verts], faces, mname)
    else:
        from_pydata('shard', [tuple(v) for v in verts], faces, mname)
        # the last stretch in gold
        a = (len(rings) - 2) * 4; b = (len(rings) - 1) * 4
        gv = [verts[a + j] for j in range(4)] + [verts[b + j] for j in range(4)] + [tip]
        gf = [[j, (j + 1) % 4, 4 + (j + 1) % 4, 4 + j] for j in range(4)] + [[4 + j, 4 + (j + 1) % 4, 8] for j in range(4)]
        from_pydata('shard-tip', [tuple(v) for v in gv], gf, 'gold')

C = Vector((0, BY + 0.9, SEAT + 2.6))  # where the fan springs from, hidden behind the back
layers = [(BY + 0.6, 27, 1.0), (BY + 1.05, 23, 0.85), (BY + 1.45, 19, 0.7)]
for li, (y, n, scale) in enumerate(layers):
    for i in range(n):
        th = -1.95 + 3.9 * (i + random.uniform(0.15, 0.85)) / n   # radians from straight up
        dirv = Vector((math.sin(th), random.uniform(0.0, 0.22), math.cos(th)))
        upness = max(0.0, math.cos(th))
        L = (3.6 + 6.6 * upness ** 1.3) * scale * random.uniform(0.75, 1.2)
        if th > 1.25 or th < -1.25: L *= 0.7
        r0 = random.uniform(1.4, 2.4)
        base = Vector((C.x, y, C.z)) + Vector((math.sin(th), 0, math.cos(th))) * r0
        w = random.uniform(0.32, 0.6) * (0.8 + 0.4 * scale); t = w * random.uniform(0.35, 0.55)
        shard(base, dirv, L, w, t, random.uniform(-0.5, 0.5), tip_gold=(abs(th) < 0.55 and li < 2 and random.random() < 0.8))
# Short jagged shards at the foot of the fan and along the arms' backs.
for sx in (-1, 1):
    for k in range(6):
        base = Vector((sx * random.uniform(2.0, 2.8), BY + random.uniform(0.2, 1.4), SEAT + random.uniform(0.2, 2.0)))
        dirv = Vector((sx * random.uniform(0.5, 1.0), random.uniform(0.1, 0.6), random.uniform(0.3, 1.0)))
        shard(base, dirv, random.uniform(1.4, 2.8), random.uniform(0.22, 0.4), 0.12, random.uniform(-0.6, 0.6), False)

# ---------- the crown on top of the back, set with the eight houses' stones ----------
CZ = SEAT + 8.35; CY = BY - 0.1
LEAN = 14
K0 = len(PARTS)
crown_rot = (math.radians(LEAN), 0, 0)
sphere(0.32, (0, BY - 0.05, SEAT + 8.05), 'gold', n=14, rings=8)
torus(1.05, 0.13, (0, CY, CZ), 'gold', rot=crown_rot, n=48, k=10)
cyl(1.05, 0.42, (0, CY, CZ + 0.18), 'gold', n=48, rot=crown_rot)
cyl(0.99, 0.44, (0, CY, CZ + 0.18), 'velvet', n=48, rot=crown_rot)  # inside of the band
cyl(0.99, 0.05, (0, CY, CZ + 0.02), 'velvet', n=48, rot=crown_rot)  # its cap
tilt = Matrix.Rotation(math.radians(LEAN), 4, 'X')
for i in range(8):
    a = math.pi / 2 + i * math.tau / 8 + math.pi / 8
    p = Vector((math.cos(a) * 1.05, math.sin(a) * 1.05, 0))
    tip = tilt @ (p + Vector((0, 0, 0.95)))
    base = tilt @ (p + Vector((0, 0, 0.36)))
    v = tip - base
    bpy.ops.mesh.primitive_cone_add(vertices=6, radius1=0.2, radius2=0.0, depth=v.length)
    o = bpy.context.active_object
    o.rotation_euler = v.to_track_quat('Z', 'Y').to_euler(); o.location = Vector((0, CY, CZ)) + (base + tip) / 2
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True); put(o, 'gold')
    sphere(0.1, tuple(Vector((0, CY, CZ)) + tilt @ (p + Vector((0, 0, 1.0)))), 'gold', n=10, rings=6)
    g = tilt @ (Vector((math.cos(a) * 1.13, math.sin(a) * 1.13, 0.18)))
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=0.19, location=tuple(Vector((0, CY, CZ)) + g))
    o = bpy.context.active_object; o.scale = (1, 1, 1.3); bpy.ops.object.transform_apply(scale=True); put(o, f'gem{i}')

# Bigger: the crown is what they're all fighting for.
for o in PARTS[K0:]:
    o.data.transform(o.matrix_world); o.matrix_world = Matrix.Identity(4)
    for v in o.data.vertices: v.co = Vector((0, CY, CZ - 0.25)) + (v.co - Vector((0, CY, CZ - 0.25))) * 1.4

# ---------- the houses' coin, spilled down the dais ----------
def coin_heap(cx, cy, z, n, rmax, hmax):
    for _ in range(n):
        r = rmax * math.sqrt(random.random()); a = random.uniform(0, math.tau)
        x, y = cx + r * math.cos(a), cy + r * math.sin(a)
        h = max(0.0, hmax * (1 - r / rmax)) * random.uniform(0.6, 1.0)
        bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=0.2, depth=0.05, location=(x, y, z + h + 0.03),
                                            rotation=(random.uniform(-0.45, 0.45), random.uniform(-0.45, 0.45), random.uniform(0, 3)))
        PARTS.append(bpy.context.active_object); bpy.context.active_object.data.materials.append(MATS['gold'])
coin_heap(-2.6, -face(6.6) + 0.55, 1.8, 70, 1.2, 0.55)
coin_heap(2.7, -face(6.6) + 0.6, 1.8, 60, 1.1, 0.45)
coin_heap(-3.4, -face(8.0) + 0.5, 0.9, 50, 0.9, 0.3)
coin_heap(3.1, -face(8.0) + 0.45, 0.9, 40, 0.8, 0.25)
coin_heap(-1.5, -1.6, TOP, 45, 0.9, 0.4)
coin_heap(1.6, -1.8, TOP, 30, 0.7, 0.3)
coin_heap(-4.6, -face(8.0) - 0.2, 0.0, 30, 0.9, 0.2)
coin_heap(0.9, y0 - 0.4, 0.0, 22, 0.7, 0.15)

# ---------- join by material, export ----------
bpy.ops.object.select_all(action='DESELECT')
by = {}
for o in PARTS:
    if o.name not in bpy.data.objects: continue
    by.setdefault(o.data.materials[0].name, []).append(o)
for name, objs in by.items():
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1: bpy.ops.object.join()
    objs[0].name = f'throne-{name}'
tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in bpy.data.objects if o.type == 'MESH')
print(f'THRONE: {len(by)} meshes, {tris} triangles; braziers at {BRAZIERS}')

if mode in ('glb', 'all'):
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'throne.glb'), use_selection=True, export_apply=True, export_format='GLB')

if mode in ('still', 'all'):
    sc = bpy.context.scene
    try: sc.render.engine = 'BLENDER_EEVEE'
    except TypeError: sc.render.engine = 'BLENDER_EEVEE_NEXT'
    world = bpy.data.worlds.new('w'); sc.world = world; world.use_nodes = True
    bg = next(n for n in world.node_tree.nodes if n.type == 'BACKGROUND'); bg.inputs[0].default_value = hexc('#b8a58a'); bg.inputs[1].default_value = 0.55
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); bpy.context.collection.objects.link(sun)
    sun.data.energy = 4.0; sun.data.color = hexc('#ffd2a0')[:3]; sun.rotation_euler = Euler((math.radians(55), 0, math.radians(-35)))
    bpy.ops.mesh.primitive_plane_add(size=80); put(bpy.context.active_object, 'stone')
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); bpy.context.collection.objects.link(cam); sc.camera = cam
    sc.render.resolution_x, sc.render.resolution_y = 1200, 900
    for name, loc, look, lens in [('front', (9, -26, 7), (0, 0, 7.5), 40), ('low', (-5, -13, 2.2), (0, 0, 8.5), 24)]:
        cam.location = loc; cam.data.lens = lens
        cam.rotation_euler = (Vector(look) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = os.path.join(HERE, f'throne-{name}.png')
        bpy.ops.render.render(write_still=True)
