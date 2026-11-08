# The racing chariot, modelled in code: a D-shaped car with a tall painted breastwork that falls away to the
# sides, bronze rails, a planked floor, an upswept pole with a yoke and two saddle pads, and an eight-spoke wheel.
# Exports public/env/props/chariot.glb with three meshes: "wood" (wood, bronze, iron, leather by colour),
# "paint" (light; the game tints it with the house colour) and "wheel" (centred on its hub, axle along x).
# Same frame as the old code chariot: forward is glTF +z (Blender -y), up y, axle at 0.75 m, wheel radius 0.75 m.
import bpy, math, os, random
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, '..', '..', 'web', 'public', 'env', 'props'))
random.seed(11)
lin = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
def hexc(h): h = h.lstrip('#'); return tuple(lin(int(h[i:i+2], 16) / 255) for i in (0, 2, 4))

bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete()
GROUPS = {'wood': [], 'paint': [], 'wheel': []}

MATS = {'wood': 1.0, 'stone': 0.75, 'cloth': 0.5, 'plain': 0.0}
def colour(o, color, jitter, m='wood'):
    attr = o.data.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT'); base = hexc(color)
    for i in range(len(o.data.vertices)):
        k = 1 + (random.random() - 0.5) * jitter * 2
        attr.data[i].color = (min(1, base[0] * k), min(1, base[1] * k), min(1, base[2] * k), MATS[m])

def part(group, kind, size, loc=(0, 0, 0), rot=(0, 0, 0), color='#888888', jitter=0.08, mat=None, **kw):
    """loc/size in the game frame (x right, y up, z forward); converted to Blender (x, -z, y)."""
    if kind == 'box': bpy.ops.mesh.primitive_cube_add(size=1)
    elif kind == 'cyl': bpy.ops.mesh.primitive_cylinder_add(vertices=kw.get('n', 12), radius=0.5, depth=1)
    elif kind == 'torus': bpy.ops.mesh.primitive_torus_add(major_radius=0.5, minor_radius=kw.get('minor', 0.05), major_segments=kw.get('n', 24), minor_segments=kw.get('m', 6))
    elif kind == 'sphere': bpy.ops.mesh.primitive_uv_sphere_add(segments=kw.get('n', 10), ring_count=6, radius=0.5)
    o = bpy.context.active_object
    o.scale = (size[0], size[2], size[1]); o.rotation_euler = rot
    o.location = (loc[0], -loc[2], loc[1])
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    mat = mat or ('plain' if color in (BRONZE, IRON) else 'cloth' if color == LEATHER else 'wood')
    colour(o, color, jitter, mat); GROUPS[group].append(o); return o

WOOD, DARKW, BRONZE, IRON, LEATHER = '#7a5232', '#4f3420', '#b0823a', '#2e2c2a', '#5a3a26'

# --- The breastwork: a curved wall round the front half of a D, tallest at the front, falling to the back corners.
R, FLOOR = 0.82, 0.86
def breastwork():
    bpy.ops.mesh.primitive_cylinder_add(vertices=40, radius=1, depth=1, end_fill_type='NOTHING')
    o = bpy.context.active_object
    # keep the front half (Blender -y is forward)
    import bmesh
    bm = bmesh.new(); bm.from_mesh(o.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.y > 0.02], context='VERTS')
    for v in bm.verts:
        a = math.atan2(v.co.x, -v.co.y)  # 0 at the front, ±pi/2 at the sides
        top = 0.62 * math.cos(a) ** 0.7 + 0.34 if abs(a) < math.pi / 2 else 0.34
        x, y = v.co.x * R, v.co.y * R * 0.92
        z = FLOOR + (top if v.co.z > 0 else 0.02)
        v.co = Vector((x, y, z))
    bm.to_mesh(o.data); bm.free()
    mod = o.modifiers.new('s', 'SOLIDIFY'); mod.thickness = 0.04
    bpy.ops.object.modifier_apply(modifier='s')
    colour(o, '#efe9dc', 0.05, 'wood'); GROUPS['paint'].append(o)
    # a bronze rail along the top edge and a bronze band at the floor
    pts = []
    for i in range(25):
        a = -math.pi / 2 + math.pi * i / 24
        top = 0.62 * max(0, math.cos(a)) ** 0.7 + 0.34
        pts.append((math.sin(a) * R, FLOOR + top + 0.02, math.cos(a) * R * 0.92))
    for p0, p1 in zip(pts, pts[1:]):
        mid = [(p0[i] + p1[i]) / 2 for i in range(3)]; d = [p1[i] - p0[i] for i in range(3)]
        L = math.sqrt(sum(c * c for c in d))
        o = part('wood', 'cyl', (0.055, L + 0.01, 0.055), mid, color=BRONZE, jitter=0.05, n=6)
        # aim the cylinder (Blender z) along the segment
        o.rotation_mode = 'QUATERNION'
    return pts
breastwork()
# re-aim rail segments: simpler to rebuild them as small spheres strung along the edge
for o in [o for o in GROUPS['wood'] if o.rotation_mode == 'QUATERNION']:
    bpy.data.objects.remove(o); GROUPS['wood'].remove(o)
for i in range(49):
    a = -math.pi / 2 + math.pi * i / 48
    top = 0.62 * max(0, math.cos(a)) ** 0.7 + 0.34
    part('wood', 'sphere', (0.085, 0.085, 0.085), (math.sin(a) * R, FLOOR + top + 0.02, math.cos(a) * R * 0.92), color=BRONZE, jitter=0.04, n=6)
    part('wood', 'box', (0.06, 0.07, 0.06), (math.sin(a) * R * 1.01, FLOOR + 0.06, math.cos(a) * R * 0.93), rot=(0, 0, a), color=BRONZE, jitter=0.04)
# a gilded boss at the front of the breastwork
part('wood', 'sphere', (0.22, 0.22, 0.08), (0, FLOOR + 0.62, R * 0.94), color=BRONZE, jitter=0.03, n=12)

# --- Floor: planks across a D, the back edge open.
for i in range(7):
    z = -0.5 + i * 0.2
    w = 2 * math.sqrt(max(0.05, R * R - max(0, z) ** 2 / 0.85)) if z > 0 else 2 * R
    part('wood', 'box', (w, 0.06, 0.18), (0, FLOOR - 0.03, z), color=random.choice([WOOD, '#83593a', '#6f4a2c']), jitter=0.1)
part('wood', 'box', (1.75, 0.08, 0.1), (0, FLOOR - 0.04, -0.52), color=DARKW)          # back sill
# hand rails curving back along the sides
for s in (-1, 1):
    part('wood', 'box', (0.05, 0.05, 0.75), (s * R * 0.98, FLOOR + 0.62, -0.22), rot=(math.radians(8), 0, 0), color=BRONZE, jitter=0.04)
    part('wood', 'box', (0.05, 0.36, 0.05), (s * R * 0.98, FLOOR + 0.45, -0.55), color=BRONZE, jitter=0.04)
# --- Axle and the axle-tree under the floor.
part('wood', 'cyl', (0.1, 2.1, 0.1), (0, 0.75, 0), rot=(0, math.radians(90), 0), color=IRON, n=8)
part('wood', 'box', (0.16, 0.14, 1.3), (0, 0.8, 0.1), color=DARKW)
# --- The pole: it sweeps up from under the floor to the yoke at the horses' withers.
segs = 8
for i in range(segs):
    t0, t1 = i / segs, (i + 1) / segs
    def at(t): return (0, 0.8 + 0.86 * t ** 1.6, 0.5 + 3.85 * t)
    p0, p1 = at(t0), at(t1); mid = [(p0[k] + p1[k]) / 2 for k in range(3)]
    L = math.dist(p0, p1); pitch = math.atan2(p1[1] - p0[1], p1[2] - p0[2])
    part('wood', 'box', (0.11, 0.11, L + 0.02), mid, rot=(-pitch, 0, 0), color=WOOD, jitter=0.06)
part('wood', 'cyl', (0.14, 0.14, 0.12), (0, 1.66, 4.35), rot=(math.radians(90), 0, 0), color=BRONZE, n=10)   # pole cap
# the yoke: a beam with two saddle pads and bronze terrets
part('wood', 'box', (1.75, 0.1, 0.12), (0, 1.66, 4.3), color=DARKW)
for s in (-1, 1):
    part('wood', 'box', (0.34, 0.12, 0.3), (s * 0.55, 1.6, 4.3), color=LEATHER)
    part('wood', 'torus', (0.16, 0.16, 0.16), (s * 0.55, 1.78, 4.3), rot=(math.radians(90), 0, 0), color=BRONZE, minor=0.18, n=10, m=5)
    part('wood', 'box', (0.04, 0.04, 3.1), (s * 0.28, 1.45, 2.75), rot=(math.radians(6), 0, 0), color=LEATHER)  # traces

# --- The wheel (separate, so the game can spin it). Axle along x.
for i in range(8):
    a = i / 8 * math.tau
    o = part('wheel', 'box', (0.05, 0.62, 0.06), (0, math.cos(a) * 0.36, math.sin(a) * 0.36), rot=(a, 0, 0), color=WOOD, jitter=0.06)
part('wheel', 'torus', (1.42, 1.42, 1.42), (0, 0, 0), rot=(0, math.radians(90), 0), color=WOOD, minor=0.045, n=28, m=6)
part('wheel', 'torus', (1.52, 1.52, 1.52), (0, 0, 0), rot=(0, math.radians(90), 0), color=IRON, minor=0.025, n=28, m=5)
part('wheel', 'cyl', (0.22, 0.22, 0.3), (0, 0, 0), rot=(0, math.radians(90), 0), color=DARKW, n=12)
part('wheel', 'cyl', (0.12, 0.12, 0.36), (0, 0, 0), rot=(0, math.radians(90), 0), color=BRONZE, n=10)

def surf_uv(o):
    """glTF drops colour alpha, so copy each vertex's surface tag (the alpha) into the UV u: the game reads uv.x."""
    me = o.data
    while me.uv_layers: me.uv_layers.remove(me.uv_layers[0])
    uv = me.uv_layers.new(name='UVMap'); col = me.color_attributes['Col']
    for loop in me.loops: uv.data[loop.index].uv = (col.data[loop.vertex_index].color[3], 0.0)

def join(name):
    objs = GROUPS[name]
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: surf_uv(o); o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.active_object; o.name = name; o.data.name = name
    m = bpy.data.materials.new(name); m.use_nodes = True
    bsdf = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Roughness'].default_value = 0.6 if name == 'paint' else 0.75
    vc = m.node_tree.nodes.new('ShaderNodeVertexColor'); vc.layer_name = 'Col'
    m.node_tree.links.new(vc.outputs['Color'], bsdf.inputs['Base Color'])
    o.data.materials.clear(); o.data.materials.append(m)
    bpy.ops.object.shade_flat()
    return o
objs = [join(n) for n in ('wood', 'paint', 'wheel')]
bpy.ops.object.select_all(action='DESELECT')
for o in objs: o.select_set(True)
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'chariot.glb'), use_selection=True, export_apply=True, export_format='GLB')

# A look: the car with two wheels in place.
import sys
if 'sheet' in sys.argv:
    w = objs[2]
    for x in (-0.92, 0.92):
        c = w.copy(); c.data = w.data; c.location = (x, 0, 0.75); bpy.context.scene.collection.objects.link(c)
    w.hide_render = True
    bpy.ops.mesh.primitive_plane_add(size=40)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); bpy.context.scene.collection.objects.link(cam)
    cam.location = (5.5, 1.5, 2.6); cam.rotation_euler = (math.radians(72), 0, math.radians(108)); cam.data.lens = 40
    bpy.context.scene.camera = cam
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 3.5
    sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(-30)); bpy.context.scene.collection.objects.link(sun)
    wd = bpy.data.worlds.new('w'); bpy.context.scene.world = wd; wd.use_nodes = True
    wd.node_tree.nodes['Background'].inputs['Color'].default_value = (0.6, 0.58, 0.52, 1)
    sc = bpy.context.scene
    try: sc.render.engine = 'BLENDER_EEVEE'
    except TypeError: sc.render.engine = 'BLENDER_EEVEE_NEXT'
    sc.render.resolution_x, sc.render.resolution_y = 1000, 700
    sc.render.filepath = os.path.join(HERE, 'chariot-sheet.png')
    bpy.ops.render.render(write_still=True)
