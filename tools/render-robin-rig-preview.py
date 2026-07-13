"""Render a compact contact sheet for Robin's authored actions."""
import argparse
import pathlib
import sys

import bpy
from mathutils import Vector


parser = argparse.ArgumentParser()
parser.add_argument("--source", required=True)
parser.add_argument("--output-dir", required=True)
args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
bpy.ops.wm.open_mainfile(filepath=str(pathlib.Path(args.source).resolve()))
output_dir = pathlib.Path(args.output_dir).resolve()
output_dir.mkdir(parents=True, exist_ok=True)

rig = bpy.data.objects.get("Ranger_Rig")
if rig is None:
    raise RuntimeError("Ranger_Rig not found")

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 640
scene.render.resolution_y = 640
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.world.color = (0.055, 0.07, 0.05)

bpy.ops.mesh.primitive_plane_add(size=8, location=(0, 0, -1.08))
floor = bpy.context.object
floor.data.materials.append(bpy.data.materials.new("PreviewFloor"))
floor.data.materials[0].diffuse_color = (0.08, 0.12, 0.07, 1)

bpy.ops.object.light_add(type="AREA", location=(-2.8, -3.5, 4.5))
key = bpy.context.object
key.data.energy = 1100
key.data.shape = "DISK"
key.data.size = 4
bpy.ops.object.light_add(type="AREA", location=(3, 1, 2.8))
fill = bpy.context.object
fill.data.energy = 700
fill.data.size = 3

bpy.ops.object.camera_add(location=(0, -4.2, -0.02))
camera = bpy.context.object
camera.data.lens = 58
camera.rotation_euler = ((Vector((0, 0, -0.04)) - camera.location).to_track_quat("-Z", "Y")).to_euler()
scene.camera = camera

for action_name, frame in (("Ranger_Idle", 24), ("Ranger_Walk", 7), ("Ranger_Attack", 18)):
    action = bpy.data.actions.get(action_name)
    if action is None:
        raise RuntimeError(f"{action_name} not found")
    rig.animation_data.action = action
    scene.frame_set(frame)
    scene.render.filepath = str(output_dir / f"{action_name.lower()}.png")
    bpy.ops.render.render(write_still=True)
    print(f"RENDERED {scene.render.filepath}")
