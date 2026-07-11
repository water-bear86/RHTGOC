"""Normalize the supplied low-poly tree pack for the browser runtime."""

import os
import sys
import bpy
from mathutils import Vector


def world_bounds(objects):
    points = [obj.matrix_world @ Vector(corner) for obj in objects for corner in obj.bound_box]
    minimum = Vector((min(point.x for point in points), min(point.y for point in points), min(point.z for point in points)))
    maximum = Vector((max(point.x for point in points), max(point.y for point in points), max(point.z for point in points)))
    return minimum, maximum


source, destination = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=source)

meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
ground = max(meshes, key=lambda obj: obj.dimensions.x * obj.dimensions.y / max(obj.dimensions.z, 0.0001))
bpy.data.objects.remove(ground, do_unlink=True)
meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]

minimum, maximum = world_bounds(meshes)
height = maximum.z - minimum.z
center = Vector(((minimum.x + maximum.x) / 2, (minimum.y + maximum.y) / 2, minimum.z))
scale = 1 / height
for obj in meshes:
    obj.location = (obj.location - center) * scale
    obj.scale *= scale
    obj.select_set(True)
    obj.name = f"SherwoodTreePart_{len([candidate for candidate in meshes if candidate.name < obj.name]):02d}"
    for material in obj.data.materials:
        material.roughness = 0.9

bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.join()
grove = bpy.context.active_object
grove.name = "SherwoodTreeGrove"
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

os.makedirs(os.path.dirname(destination), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=destination,
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_yup=True,
    export_cameras=False,
    export_lights=False,
)
