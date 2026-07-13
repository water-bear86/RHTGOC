import bpy
import json
import sys
from mathutils import Vector

source = sys.argv[sys.argv.index("--") + 1]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=source)

objects = []
for obj in bpy.context.scene.objects:
    if obj.type != "MESH":
        continue
    corners = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    objects.append({
        "name": obj.name,
        "vertices": len(obj.data.vertices),
        "location": list(obj.location),
        "dimensions": list(obj.dimensions),
        "bounds": {
            "min": [min(c[i] for c in corners) for i in range(3)],
            "max": [max(c[i] for c in corners) for i in range(3)],
        },
    })

print(json.dumps({"objects": objects}, indent=2))
