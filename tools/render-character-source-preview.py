"""Render a deterministic visual-audition image for a Blender, GLB, or FBX character source."""
import argparse
import pathlib
import sys

import bpy
from mathutils import Vector


parser = argparse.ArgumentParser()
parser.add_argument("--source", required=True)
parser.add_argument("--output", required=True)
parser.add_argument("--animation")
parser.add_argument("--frame", type=int, default=1)
args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])

source = pathlib.Path(args.source).resolve()
output = pathlib.Path(args.output).resolve()
output.parent.mkdir(parents=True, exist_ok=True)

if source.suffix.lower() == ".blend":
    bpy.ops.wm.open_mainfile(filepath=str(source))
else:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    if source.suffix.lower() in {".glb", ".gltf"}:
        bpy.ops.import_scene.gltf(filepath=str(source))
    elif source.suffix.lower() == ".fbx":
        bpy.ops.import_scene.fbx(filepath=str(source))
    else:
        raise RuntimeError(f"Unsupported character source: {source.suffix}")

meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
if not meshes:
    raise RuntimeError("No mesh objects found")

if args.animation:
    action = bpy.data.actions.get(args.animation)
    armature = next((obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"), None)
    if action is None or armature is None:
        raise RuntimeError(f"Animation {args.animation} or its armature was not found")
    armature.animation_data_create()
    armature.animation_data.action = action
    bpy.context.scene.frame_set(args.frame)

corners = [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]
minimum = Vector((min(point.x for point in corners), min(point.y for point in corners), min(point.z for point in corners)))
maximum = Vector((max(point.x for point in corners), max(point.y for point in corners), max(point.z for point in corners)))
center = (minimum + maximum) / 2
height = max(maximum.z - minimum.z, 0.001)

preview_root = bpy.data.objects.new("Character_Preview_Root", None)
bpy.context.scene.collection.objects.link(preview_root)
top_level = [obj for obj in bpy.context.scene.objects if obj is not preview_root and obj.parent is None]
for obj in top_level:
    obj.parent = preview_root
preview_root.location = (-center.x, -center.y, -minimum.z)

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 720
scene.render.resolution_y = 720
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = str(output)
scene.world.color = (0.025, 0.035, 0.025)

bpy.ops.mesh.primitive_plane_add(size=height * 4, location=(0, 0, 0))
floor = bpy.context.object
floor.name = "PreviewFloor"
floor_material = bpy.data.materials.new("PreviewFloorMaterial")
floor_material.diffuse_color = (0.06, 0.09, 0.055, 1)
floor.data.materials.append(floor_material)

bpy.ops.object.light_add(type="AREA", location=(-height * 1.2, -height * 1.5, height * 2.0))
key = bpy.context.object
key.data.energy = 900
key.data.shape = "DISK"
key.data.size = height * 1.8
bpy.ops.object.light_add(type="AREA", location=(height * 1.4, height * 0.7, height * 1.2))
fill = bpy.context.object
fill.data.energy = 550
fill.data.size = height * 1.5

camera_target = Vector((0, 0, height * 0.48))
camera_location = Vector((height * 0.72, -height * 2.25, height * 0.58))
bpy.ops.object.camera_add(location=camera_location)
camera = bpy.context.object
camera.name = "PreviewCamera"
camera.data.lens = 62
camera.rotation_euler = (camera_target - camera.location).to_track_quat("-Z", "Y").to_euler()
scene.camera = camera

for obj in meshes:
    obj.select_set(False)
    obj.visible_camera = True

scene.render.film_transparent = False
bpy.ops.render.render(write_still=True)
print(
    f"PREVIEW source={source.name} output={output} meshes={len(meshes)} "
    f"vertices={sum(len(obj.data.vertices) for obj in meshes)} triangles={sum(len(obj.data.loop_triangles) for obj in meshes)}"
)
