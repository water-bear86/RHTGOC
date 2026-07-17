"""Rig a T-pose humanoid source and author basic browser-game animation clips."""
import argparse
import math
import pathlib
import sys

import bpy
from mathutils import Euler, Quaternion, Vector


parser = argparse.ArgumentParser()
parser.add_argument("--source", required=True)
parser.add_argument("--blend-output", required=True)
parser.add_argument("--glb-output", required=True)
parser.add_argument("--clip-prefix", default="Ranger")
parser.add_argument("--rig-name", default="Ranger_Rig")
parser.add_argument("--root-name", default="Robin_Game_Root")
parser.add_argument("--decimate-ratio", type=float, default=1.0)
parser.add_argument("--hip-height", type=float, default=0.49)
parser.add_argument("--knee-height", type=float, default=0.265)
parser.add_argument("--shoulder-height", type=float, default=0.665)
parser.add_argument("--neck-height", type=float, default=0.755)
args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])

source = pathlib.Path(args.source).resolve()
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
        raise RuntimeError(f"Unsupported humanoid source: {source.suffix}")
meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
if not meshes:
    raise RuntimeError("No mesh objects found")

if not 0 < args.decimate_ratio <= 1:
    raise ValueError("--decimate-ratio must be greater than zero and at most one")
if args.decimate_ratio < 1:
    for obj in meshes:
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        modifier = obj.modifiers.new(name="Sherwood_Web_Decimate", type="DECIMATE")
        modifier.ratio = args.decimate_ratio
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        obj.select_set(False)

for obj in meshes:
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

corners = [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]
min_x, max_x = min(p.x for p in corners), max(p.x for p in corners)
min_y, max_y = min(p.y for p in corners), max(p.y for p in corners)
min_z, max_z = min(p.z for p in corners), max(p.z for p in corners)
height = max_z - min_z
center_y = (min_y + max_y) / 2
z = lambda ratio: min_z + height * ratio

bpy.ops.object.select_all(action="DESELECT")
bpy.ops.object.armature_add(enter_editmode=True, location=(0, 0, 0))
rig = bpy.context.object
rig.name = args.rig_name
rig.data.name = args.rig_name
rig.show_in_front = True
edit = rig.data.edit_bones
edit.remove(edit[0])

def bone(name, head, tail, parent=None, connected=False, deform=True):
    item = edit.new(name)
    item.head, item.tail = head, tail
    item.parent = edit.get(parent) if parent else None
    item.use_connect = connected
    item.use_deform = deform
    return item

hip_z = args.hip_height
knee_z = args.knee_height
shoulder_z = args.shoulder_height
neck_z = args.neck_height
if not (0.42 < hip_z < 0.56 and 0.18 < knee_z < hip_z and hip_z < shoulder_z < neck_z < 0.86):
    raise ValueError("Anatomical height ratios are out of order")

bone("root", (0, center_y, min_z), (0, center_y, z(hip_z)), deform=False)
bone("pelvis", (0, center_y, z(hip_z - .025)), (0, center_y, z(hip_z + .065)), "root")
bone("spine", (0, center_y, z(hip_z + .065)), (0, center_y, z(.59)), "pelvis", True)
bone("chest", (0, center_y, z(.59)), (0, center_y, z(shoulder_z + .045)), "spine", True)
bone("neck", (0, center_y, z(shoulder_z + .045)), (0, center_y, z(neck_z)), "chest", True)
bone("head", (0, center_y, z(neck_z)), (0, center_y, z(.965)), "neck", True)

shoulder_x = (max_x - min_x) * .17
elbow_x = (max_x - min_x) * .34
hand_x = (max_x - min_x) * .47
for side, sign in (("L", 1), ("R", -1)):
    bone(f"clavicle.{side}", (0, center_y, z(shoulder_z + .025)), (sign * shoulder_x, center_y, z(shoulder_z)), "chest")
    bone(f"upper_arm.{side}", (sign * shoulder_x, center_y, z(shoulder_z)), (sign * elbow_x, center_y, z(shoulder_z)), f"clavicle.{side}", True)
    bone(f"forearm.{side}", (sign * elbow_x, center_y, z(shoulder_z)), (sign * hand_x, center_y, z(shoulder_z)), f"upper_arm.{side}", True)
    bone(f"hand.{side}", (sign * hand_x, center_y, z(shoulder_z)), (sign * (hand_x + height * .035), center_y, z(shoulder_z)), f"forearm.{side}", True)
    hip_x = (max_x - min_x) * .09
    knee_x = (max_x - min_x) * .1
    bone(f"thigh.{side}", (sign * hip_x, center_y, z(hip_z)), (sign * knee_x, center_y, z(knee_z)), "pelvis")
    bone(f"shin.{side}", (sign * knee_x, center_y, z(knee_z)), (sign * knee_x, center_y, z(.055)), f"thigh.{side}", True)
    bone(f"foot.{side}", (sign * knee_x, center_y, z(.055)), (sign * knee_x, center_y - height * .1, z(.025)), f"shin.{side}", True)

bone("weapon_socket.R", (-hand_x, center_y, z(shoulder_z)), (-hand_x, center_y - height * .12, z(shoulder_z)), "hand.R", deform=False)
bone("quiver_socket", (height * .05, center_y + height * .04, z(.62)), (height * .05, center_y + height * .04, z(.8)), "chest", deform=False)

bpy.ops.object.mode_set(mode="OBJECT")
for obj in meshes:
    obj.select_set(True)
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.parent_set(type="ARMATURE_AUTO")

# Preserve Blender's heat weights and fill only genuinely unweighted vertices
# with a deterministic three-nearest-bone fallback. The previous rig discarded
# all heat weights, which made clothing and the continuous equipment mesh pull
# toward whichever bone segment happened to be spatially closest.
deform_bones = [item for item in rig.data.bones if item.use_deform]
segments = [(item.name, rig.matrix_world @ item.head_local, rig.matrix_world @ item.tail_local) for item in deform_bones]
for obj in meshes:
    groups = {name: obj.vertex_groups.get(name) or obj.vertex_groups.new(name=name) for name, _, _ in segments}
    deform_group_indices = {group.index for group in groups.values()}
    fallback_count = 0
    for vertex in obj.data.vertices:
        if sum(link.weight for link in vertex.groups if link.group in deform_group_indices) > 1e-5:
            continue
        fallback_count += 1
        point = obj.matrix_world @ vertex.co
        candidates = []
        for name, head, tail in segments:
            axis = tail - head
            factor = max(0.0, min(1.0, (point - head).dot(axis) / max(axis.length_squared, 1e-8)))
            distance = (point - (head + axis * factor)).length
            candidates.append((distance, name))
        nearest = sorted(candidates)[:3]
        raw = [(1.0 / max(distance, height * .018) ** 2, name) for distance, name in nearest]
        total = sum(weight for weight, _ in raw)
        for weight, name in raw:
            groups[name].add([vertex.index], weight / total, "REPLACE")
    print(f"WEIGHTS object={obj.name} vertices={len(obj.data.vertices)} fallback={fallback_count}")

    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.vertex_group_clean(group_select_mode="BONE_DEFORM", limit=0.001, keep_single=True)
    bpy.ops.object.vertex_group_limit_total(group_select_mode="BONE_DEFORM", limit=4)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode="BONE_DEFORM", lock_active=False)

def world_rotation(pose, rotations):
    """Build a pose-space quaternion from rotations around armature axes."""
    basis = pose.bone.matrix_local.to_3x3().inverted()
    result = Quaternion()
    for axis, angle in rotations:
        local_axis = (basis @ Vector(axis)).normalized()
        result = Quaternion(local_axis, angle) @ result
    return result

def action(name, end_frame, poses, aimed_poses=None):
    clip = bpy.data.actions.new(name)
    clip.use_fake_user = True
    rig.animation_data_create()
    rig.animation_data.action = clip
    for frame, transforms in poses.items():
        # Every action frame starts from the bind pose and keys every bone.
        # Partial actions previously inherited forearm and shoulder transforms
        # from whichever clip happened to be authored last.
        for pose in rig.pose.bones:
            pose.rotation_mode = "QUATERNION"
            pose.rotation_quaternion = Quaternion()
            pose.location = (0, 0, 0)
            pose.scale = (1, 1, 1)
        for bone_name, rotation in transforms.items():
            pose = rig.pose.bones[bone_name]
            pose.rotation_quaternion = Euler(rotation, "XYZ").to_quaternion()
        for bone_name, rotations in (aimed_poses or {}).get(frame, {}).items():
            pose = rig.pose.bones[bone_name]
            pose.rotation_quaternion = world_rotation(pose, rotations)
        rig.pose.bones["root"].location.z = (0.006 * height if frame % 12 else 0)
        for pose in rig.pose.bones:
            pose.keyframe_insert("rotation_quaternion", frame=frame, group=pose.name)
        rig.pose.bones["root"].keyframe_insert("location", frame=frame, group="root")
    clip.frame_start, clip.frame_end = 1, end_frame
    return clip

# Blender sources are Z-up and their T-pose arms extend along world X. A
# shoulder drop therefore rotates around world Y into the X/Z plane.
relaxed_left = [((0, 1, 0), math.radians(72)), ((1, 0, 0), math.radians(-4))]
relaxed_right = [((0, 1, 0), math.radians(-72)), ((1, 0, 0), math.radians(5))]

idle = action(f"{args.clip_prefix}_Idle", 48, {
    1: {"chest": (0, 0, -.025), "head": (0, 0, .015), "thigh.L": (0, 0, 0), "thigh.R": (0, 0, 0)},
    24: {"chest": (.025, 0, .025), "head": (-.015, 0, -.02), "thigh.L": (0, 0, 0), "thigh.R": (0, 0, 0)},
    48: {"chest": (0, 0, -.025), "head": (0, 0, .015), "thigh.L": (0, 0, 0), "thigh.R": (0, 0, 0)},
}, {
    1: {"upper_arm.L": relaxed_left, "upper_arm.R": relaxed_right},
    24: {"upper_arm.L": [((0, 1, 0), math.radians(70)), ((1, 0, 0), math.radians(-3))],
         "upper_arm.R": [((0, 1, 0), math.radians(-70)), ((1, 0, 0), math.radians(4))],
         },
    48: {"upper_arm.L": relaxed_left, "upper_arm.R": relaxed_right},
})
walk = action(f"{args.clip_prefix}_Walk", 24, {
    1: {"thigh.L": (.55, 0, 0), "thigh.R": (-.55, 0, 0)},
    7: {"thigh.L": (0, 0, 0), "thigh.R": (0, 0, 0)},
    13: {"thigh.L": (-.55, 0, 0), "thigh.R": (.55, 0, 0)},
    19: {"thigh.L": (0, 0, 0), "thigh.R": (0, 0, 0)},
    24: {"thigh.L": (.55, 0, 0), "thigh.R": (-.55, 0, 0)},
}, {
    1: {"upper_arm.L": [((0, 1, 0), math.radians(72)), ((1, 0, 0), -.18)],
        "upper_arm.R": [((0, 1, 0), math.radians(-72)), ((1, 0, 0), .18)]},
    7: {"upper_arm.L": relaxed_left, "upper_arm.R": relaxed_right},
    13: {"upper_arm.L": [((0, 1, 0), math.radians(72)), ((1, 0, 0), .18)],
         "upper_arm.R": [((0, 1, 0), math.radians(-72)), ((1, 0, 0), -.18)]},
    19: {"upper_arm.L": relaxed_left, "upper_arm.R": relaxed_right},
    24: {"upper_arm.L": [((0, 1, 0), math.radians(72)), ((1, 0, 0), -.18)],
         "upper_arm.R": [((0, 1, 0), math.radians(-72)), ((1, 0, 0), .18)]},
})
attack = action(f"{args.clip_prefix}_Attack", 30, {
    1: {"chest": (0, 0, 0), "thigh.L": (0, 0, 0), "thigh.R": (0, 0, 0)},
    10: {"chest": (0, 0, -.18), "thigh.L": (0, 0, 0), "thigh.R": (0, 0, 0)},
    18: {"chest": (0, 0, .12), "thigh.L": (0, 0, 0), "thigh.R": (0, 0, 0)},
    30: {"chest": (0, 0, 0), "thigh.L": (0, 0, 0), "thigh.R": (0, 0, 0)},
}, {
    1: {"upper_arm.L": relaxed_left, "upper_arm.R": relaxed_right,
        "forearm.L": [], "forearm.R": []},
    10: {"upper_arm.L": relaxed_left,
         "upper_arm.R": [((0, 1, 0), math.radians(-42))]},
    18: {"upper_arm.L": relaxed_left,
         "upper_arm.R": [((0, 1, 0), math.radians(-22))]},
    30: {"upper_arm.L": relaxed_left, "upper_arm.R": relaxed_right,
         "forearm.L": [], "forearm.R": []},
})

rig.animation_data.action = idle
game_root = bpy.data.objects.new(args.root_name, None)
bpy.context.scene.collection.objects.link(game_root)
rig.parent = game_root
game_root.location.z = -height * .03
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = 48
blend_output = pathlib.Path(args.blend_output).resolve()
glb_output = pathlib.Path(args.glb_output).resolve()
bpy.ops.wm.save_as_mainfile(filepath=str(blend_output))
bpy.ops.export_scene.gltf(
    filepath=str(glb_output), export_format="GLB", export_yup=True,
    export_skins=True, export_animations=True, export_animation_mode="ACTIONS",
    export_def_bones=True, export_extras=True,
)
print(f"RIGGED meshes={len(meshes)} bones={len(rig.data.bones)} actions={[a.name for a in bpy.data.actions]}")
