# Crownfall town props, modelled in code: market stalls, barrels, crates, a cart, a well, the rookery tower,
# signposts and hay. Each prop is joined into ONE mesh coloured by a colour attribute (so the web can instance
# it with one material), exported as public/env/props/<name>.glb, with its size in metres in props.json.
# Run: /Applications/Blender.app/Contents/MacOS/Blender -b -P props.py -- [sheet]
import bpy, bmesh, math, json, os, random, sys
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, '..', '..', 'web', 'public', 'env', 'props'))
os.makedirs(OUT, exist_ok=True)
random.seed(7)

def hexc(h, a=1.0):
    h = h.lstrip('#'); lin = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return tuple(lin(int(h[i:i+2], 16) / 255) for i in (0, 2, 4)) + (a,)

def clear():
    bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete()
    for m in list(bpy.data.meshes): bpy.data.meshes.remove(m)

PARTS = []
# The surface each part is made of rides in the colour's alpha, for the game's shader: wood grain, stone, woven
# cloth, or plain (iron, fruit, glaze).
MATS = {'wood': 1.0, 'stone': 0.75, 'cloth': 0.5, 'plain': 0.0}
STONES = {'#9a9284', '#857d70', '#6b6457', '#8d8576', '#7f7769', '#958c7b', '#86806f', '#1d2a33'}
def guess(color):
    if color in STONES: return 'stone'
    r, g, b = (int(color.lstrip('#')[i:i+2], 16) for i in (0, 2, 4))
    mx, mn = max(r, g, b), min(r, g, b)
    if mx < 70: return 'plain'                      # iron, ravens, dark slits
    if r > g > b and (mx - mn) < 140 and r < 200: return 'wood'
    return 'cloth' if mx - mn > 60 else 'plain'

def part(kind, size=(1, 1, 1), loc=(0, 0, 0), rot=(0, 0, 0), color='#888888', jitter=0.06, m=None, **kw):
    """Add a primitive, colour every vertex (with a little variation so flat colours don't look plastic)."""
    if kind == 'box': bpy.ops.mesh.primitive_cube_add(size=1)
    elif kind == 'cyl': bpy.ops.mesh.primitive_cylinder_add(vertices=kw.get('n', 16), radius=0.5, depth=1)
    elif kind == 'cone': bpy.ops.mesh.primitive_cone_add(vertices=kw.get('n', 12), radius1=0.5, radius2=kw.get('top', 0), depth=1)
    elif kind == 'sphere': bpy.ops.mesh.primitive_uv_sphere_add(segments=kw.get('n', 10), ring_count=max(4, kw.get('n', 10) // 2), radius=0.5)
    elif kind == 'torus': bpy.ops.mesh.primitive_torus_add(major_radius=0.5, minor_radius=kw.get('minor', 0.06), major_segments=kw.get('n', 20), minor_segments=6)
    o = bpy.context.active_object
    o.scale = size; o.location = loc; o.rotation_euler = rot
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    me = o.data
    attr = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    base = hexc(color)
    for i, v in enumerate(me.vertices):
        k = 1 + (random.random() - 0.5) * jitter * 2
        attr.data[i].color = (min(1, base[0] * k), min(1, base[1] * k), min(1, base[2] * k), MATS[m or guess(color)])
    PARTS.append(o)
    return o

def surf_uv(o):
    """glTF drops colour alpha, so copy each vertex's surface tag (the alpha) into the UV u: the game reads uv.x."""
    me = o.data
    while me.uv_layers: me.uv_layers.remove(me.uv_layers[0])
    uv = me.uv_layers.new(name='UVMap'); col = me.color_attributes['Col']
    for loop in me.loops: uv.data[loop.index].uv = (col.data[loop.vertex_index].color[3], 0.0)

def finish(name):
    """Join the parts, put the base on the ground and the middle at the origin, give it the vertex-colour material, export."""
    global PARTS
    bpy.ops.object.select_all(action='DESELECT')
    for p in PARTS: surf_uv(p); p.select_set(True)
    bpy.context.view_layer.objects.active = PARTS[0]
    bpy.ops.object.join()
    o = bpy.context.active_object; o.name = name
    bb = [o.matrix_world @ Vector(c) for c in o.bound_box]
    mn = Vector((min(v.x for v in bb), min(v.y for v in bb), min(v.z for v in bb)))
    mx = Vector((max(v.x for v in bb), max(v.y for v in bb), max(v.z for v in bb)))
    o.data.transform(Matrix.Translation(Vector((-(mn.x + mx.x) / 2, -(mn.y + mx.y) / 2, -mn.z))))
    m = bpy.data.materials.new(name + '-mat'); m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']; bsdf.inputs['Roughness'].default_value = 0.85
    vc = m.node_tree.nodes.new('ShaderNodeVertexColor'); vc.layer_name = 'Col'
    m.node_tree.links.new(vc.outputs['Color'], bsdf.inputs['Base Color'])
    o.data.materials.clear(); o.data.materials.append(m)
    bpy.ops.object.shade_flat()
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, name + '.glb'), use_selection=True, export_apply=True, export_format='GLB')
    size = [round(mx.x - mn.x, 3), round(mx.z - mn.z, 3), round(mx.y - mn.y, 3)]  # x, height, depth (Blender z is up)
    PARTS = []
    return o, size

WOOD, DARK, STONE, IRON = '#7a5434', '#4a3220', '#9a9284', '#3b3b3e'
sizes = {}

def stall(name, a, b):
    part('box', (3.0, 1.0, 0.9), (0, -0.2, 0.45), color=WOOD)                  # the counter
    part('box', (3.1, 1.1, 0.08), (0, -0.2, 0.94), color=DARK)                 # its top
    for x in (-1.45, 1.45):
        for y in (-0.75, 0.85): part('box', (0.12, 0.12, 2.6), (x, y, 1.3), color=DARK)
    # The awning: striped canvas sloping to the front.
    for i in range(8):
        x = -1.5 + 0.1875 + i * 0.375
        part('box', (0.375, 2.0, 0.05), (x, 0.0, 2.55), rot=(math.radians(-14), 0, 0), color=a if i % 2 else b, jitter=0.03, m='cloth')
    for i in range(8):  # a scalloped valance along the front edge
        x = -1.5 + 0.1875 + i * 0.375
        part('box', (0.36, 0.04, 0.28), (x, -1.0, 2.2), color=a if i % 2 else b, jitter=0.03, m='cloth')
    # Goods: fruit, rolls of cloth, jars.
    for i in range(14):
        part('sphere', (0.16, 0.16, 0.16), (-1.2 + (i % 7) * 0.4, -0.45 + (i // 7) * 0.25, 1.06), color=random.choice(['#c8362a', '#e0a020', '#6c9a2c', '#d96a1e']), n=8, m='plain')
    for i in range(3): part('cyl', (0.22, 0.22, 0.5), (0.6 + i * 0.32, 0.15, 1.2), color=random.choice(['#3d5a8a', '#8a2d46', '#e6d7b0']), n=10, m='cloth')
    part('box', (0.6, 0.45, 0.45), (1.0, 0.75, 0.22), color=WOOD)
    return finish(name)

def barrel():
    o = part('cyl', (0.62, 0.62, 0.9), (0, 0, 0.45), color='#8a5a33', n=14)
    for v in o.data.vertices:  # the bulge
        k = 1 + 0.12 * math.cos((v.co.z - 0.45) / 0.45 * math.pi / 2)
        v.co.x *= k; v.co.y *= k
    for z in (0.12, 0.78): part('torus', (0.68, 0.68, 0.7), (0, 0, z), color=IRON, minor=0.05, n=16)
    part('torus', (0.73, 0.73, 0.7), (0, 0, 0.45), color=IRON, minor=0.05, n=16)
    return finish('barrel')

def crate():
    part('box', (0.8, 0.8, 0.8), (0, 0, 0.4), color='#a07a4a')
    for z in (0.04, 0.76):
        for (sx, sy, x, y) in ((0.84, 0.1, 0, 0.37), (0.84, 0.1, 0, -0.37), (0.1, 0.84, 0.37, 0), (0.1, 0.84, -0.37, 0)):
            part('box', (sx, sy, 0.1), (x, y, z), color=DARK)
    for (x, y) in ((0.37, 0.37), (-0.37, 0.37), (0.37, -0.37), (-0.37, -0.37)): part('box', (0.1, 0.1, 0.84), (x, y, 0.4), color=DARK)
    part('box', (0.06, 1.05, 0.06), (0.42, 0, 0.4), rot=(math.radians(45), 0, 0), color=DARK)
    return finish('crate')

def cart():
    part('box', (1.4, 2.2, 0.12), (0, 0, 0.75), color=WOOD)
    for x in (-0.68, 0.68): part('box', (0.06, 2.2, 0.45), (x, 0, 1.0), color=WOOD)
    part('box', (1.4, 0.06, 0.45), (0, -1.08, 1.0), color=WOOD)
    for x in (-0.82, 0.82):
        part('cyl', (1.15, 1.15, 0.1), (x, -0.2, 0.58), rot=(0, math.radians(90), 0), color=DARK, n=16)
        part('cyl', (0.25, 0.25, 0.16), (x, -0.2, 0.58), rot=(0, math.radians(90), 0), color=IRON, n=10)
    for x in (-0.45, 0.45): part('box', (0.07, 1.8, 0.07), (x, 1.9, 0.62), rot=(math.radians(-8), 0, 0), color=DARK)
    for i in range(3): part('box', (0.9, 0.5, 0.35), (0, -0.6 + i * 0.6, 1.0), color=random.choice(['#d9c27a', '#b9944e']), m='cloth')  # sacks of grain
    return finish('cart')

def well():
    part('cyl', (2.2, 2.2, 0.9), (0, 0, 0.45), color=STONE, n=18)
    part('cyl', (1.7, 1.7, 0.05), (0, 0, 0.9), color='#1d2a33', n=18)
    for x in (-1.0, 1.0): part('box', (0.14, 0.14, 2.2), (x, 0, 1.9), color=DARK)
    part('cyl', (0.12, 0.12, 2.1), (0, 0, 2.5), rot=(0, math.radians(90), 0), color=DARK, n=8)
    for s in (-1, 1): part('box', (2.5, 0.9, 0.06), (0, s * 0.42, 3.15), rot=(s * math.radians(35), 0, 0), color='#8a3a26', m='wood')
    part('cyl', (0.35, 0.35, 0.35), (0.2, 0, 1.6), color=WOOD, n=10)
    return finish('well')

def rookery():
    # Stone courses, each a slightly different shade and width, so it reads as masonry; a corbelled ledge,
    # an open timber loft where the ravens roost, and a shingled cone roof.
    for i in range(11):
        k = 1 - 0.1 * (i / 11)
        shade = random.choice(['#8d8576', '#7f7769', '#958c7b', '#86806f'])
        part('cyl', (4.4 * k + random.uniform(-0.05, 0.05), 4.4 * k + random.uniform(-0.05, 0.05), 1.0), (0, 0, i + 0.5), rot=(0, 0, random.uniform(0, 0.4)), color=shade, n=16, jitter=0.05)
        if i % 4 == 0: part('cyl', (4.6 * k, 4.6 * k, 0.18), (0, 0, i + 0.05), color='#6b6457', n=16)
    part('cyl', (5.1, 5.1, 0.6), (0, 0, 11.1), color='#6b6457', n=16)                      # the corbelled ledge
    for i in range(16):
        a = i / 16 * math.tau
        part('box', (0.5, 0.5, 0.5), (math.cos(a) * 2.35, math.sin(a) * 2.35, 10.7), rot=(0, 0, a), color='#6b6457')
    for i in range(8):                                                                      # the loft's posts
        a = i / 8 * math.tau
        part('box', (0.22, 0.22, 2.5), (math.cos(a) * 2.15, math.sin(a) * 2.15, 12.6), color=DARK)
    part('cyl', (4.5, 4.5, 0.25), (0, 0, 12.0), color=WOOD, n=16)                          # loft floor rail
    part('cyl', (4.5, 4.5, 0.18), (0, 0, 13.7), color=WOOD, n=16)                          # loft top rail
    part('cyl', (3.2, 3.2, 2.0), (0, 0, 12.8), color='#1a1a1c', n=12)                       # dark inside
    part('cone', (5.6, 5.6, 3.0), (0, 0, 15.3), color='#5b3a25', n=10, jitter=0.12)
    part('cone', (0.5, 0.5, 1.2), (0, 0, 17.2), color='#3b2a1e', n=6)
    part('box', (1.4, 0.3, 2.4), (0, -2.08, 1.2), color='#4a2f1c')                          # the door
    part('box', (1.7, 0.32, 0.25), (0, -2.1, 2.5), color='#6b6457')                         # its lintel
    for z, a in ((3.8, 0), (6.6, 1.6), (9.0, 3.4), (5.2, 4.6)):                             # slit windows round the tower
        part('box', (0.35, 0.3, 0.9), (math.sin(a) * 2.15, -math.cos(a) * 2.15, z), rot=(0, 0, a), color='#161616')
    for i in range(9):                                                                      # ravens on the ledge and rail
        a = i / 9 * math.tau + 0.3
        r = 2.45 if i % 2 else 2.25
        x, y, z = math.cos(a) * r, math.sin(a) * r, 11.55 if i % 2 else 13.9
        part('sphere', (0.4, 0.55, 0.4), (x, y, z), color='#121216', n=8)
        part('sphere', (0.26, 0.26, 0.26), (x * 1.06, y * 1.06, z + 0.3), color='#121216', n=8)
        part('cone', (0.09, 0.09, 0.26), (x * 1.14, y * 1.14, z + 0.28), rot=(0, math.radians(90), a), color='#2b2b2b', n=6)
    return finish('rookery')

def signpost():
    part('box', (0.16, 0.16, 3.2), (0, 0, 1.6), color=DARK)
    part('box', (1.4, 0.08, 0.32), (0.6, 0, 2.7), rot=(0, 0, math.radians(8)), color='#b08a56')
    part('box', (1.2, 0.08, 0.3), (-0.5, 0, 2.2), rot=(0, 0, math.radians(-6)), color='#b08a56')
    return finish('signpost')

def hay():
    o = part('box', (1.4, 0.9, 0.8), (0, 0, 0.4), color='#d8b85a', jitter=0.12, m='cloth')
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o
    bpy.ops.object.modifier_add(type='BEVEL'); o.modifiers[-1].width = 0.12; o.modifiers[-1].segments = 2
    bpy.ops.object.modifier_apply(modifier=o.modifiers[-1].name)
    for x in (-0.35, 0.35): part('box', (0.04, 0.94, 0.84), (x, 0, 0.4), color='#7a5a2a')
    return finish('hay')

clear()
for fn in (lambda: stall('stall-red', '#b8322a', '#efe2c4'), lambda: stall('stall-blue', '#2f5d8a', '#efe2c4'), lambda: stall('stall-green', '#3d6b35', '#e9d27a'),
           barrel, crate, cart, well, rookery, signpost, hay):
    o, size = fn()
    sizes[o.name] = size
    bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete()
json.dump(sizes, open(os.path.join(OUT, 'props.json'), 'w'), indent=1)
print('sizes', sizes)

if 'sheet' in sys.argv:
    # A contact sheet: every prop in a row, to look at.
    for name in sizes:
        bpy.ops.import_scene.gltf(filepath=os.path.join(OUT, name + '.glb'))
    objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    x = 0
    for o in sorted(objs, key=lambda o: o.name):
        w = o.dimensions.x
        o.location.x = x + w / 2; x += w + 0.8
    bpy.ops.mesh.primitive_plane_add(size=200, location=(x / 2, 0, 0))
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); bpy.context.scene.collection.objects.link(cam)
    cam.location = (x / 2, -24, 9); cam.rotation_euler = (math.radians(72), 0, 0); cam.data.lens = 38
    bpy.context.scene.camera = cam
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 3.5
    sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(-30)); bpy.context.scene.collection.objects.link(sun)
    w = bpy.context.scene.world or bpy.data.worlds.new('w'); bpy.context.scene.world = w; w.use_nodes = True
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.75, 0.72, 0.66, 1)
    sc = bpy.context.scene
    try: sc.render.engine = 'BLENDER_EEVEE'
    except TypeError: sc.render.engine = 'BLENDER_EEVEE_NEXT'
    sc.render.resolution_x, sc.render.resolution_y = 1600, 600
    sc.render.filepath = os.path.join(HERE, 'props-sheet.png')
    bpy.ops.render.render(write_still=True)
