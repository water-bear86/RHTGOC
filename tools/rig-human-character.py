"""Fit Blender's Rigify Basic Human metarig to a T-pose game character.

The adjusted metarig is deliberately used as the deformation rig. Generating
Rigify's animator control rig would add controller widgets and hundreds of
non-shipping bones without improving this small browser-game animation set.
"""
import argparse
import math
import pathlib
import sys

import bpy
from mathutils import Quaternion, Vector


parser = argparse.ArgumentParser()
parser.add_argument("--source", required=True)
parser.add_argument("--blend-output", required=True)
parser.add_argument("--glb-output", required=True)
parser.add_argument("--clip-prefix", default="Ranger")
parser.add_argument("--rig-name", default="Robin_Human_Rig")
parser.add_argument("--root-name", default="Robin_Game_Root")
parser.add_argument("--decimate-ratio", type=float, default=0.30)
args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])


def open_source(path: pathlib.Path) -> None:
    if path.suffix.lower() == ".blend":
        bpy.ops.wm.open_mainfile(filepath=str(path))
        return
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    if path.suffix.lower() in {".glb", ".gltf"}:
        bpy.ops.import_scene.gltf(filepath=str(path))
    elif path.suffix.lower() == ".fbx":
        bpy.ops.import_scene.fbx(filepath=str(path))
    else:
        raise RuntimeError(f"Unsupported humanoid source: {path.suffix}")


source = pathlib.Path(args.source).resolve()
open_source(source)

# Remove source-file presentation objects while preserving every source mesh.
for item in list(bpy.context.scene.objects):
    if item.type in {"CAMERA", "LIGHT", "ARMATURE", "EMPTY"}:
        bpy.data.objects.remove(item, do_unlink=True)
meshes = [item for item in bpy.context.scene.objects if item.type == "MESH"]
if not meshes:
    raise RuntimeError("No mesh objects found")
if not 0 < args.decimate_ratio <= 1:
    raise ValueError("--decimate-ratio must be greater than zero and at most one")

for mesh in meshes:
    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    if args.decimate_ratio < 1:
        modifier = mesh.modifiers.new(name="Sherwood_Web_Decimate", type="DECIMATE")
        modifier.ratio = args.decimate_ratio
        bpy.ops.object.modifier_apply(modifier=modifier.name)

corners = [mesh.matrix_world @ Vector(corner) for mesh in meshes for corner in mesh.bound_box]
min_x, max_x = min(p.x for p in corners), max(p.x for p in corners)
min_y, max_y = min(p.y for p in corners), max(p.y for p in corners)
min_z, max_z = min(p.z for p in corners), max(p.z for p in corners)
width, depth, height = max_x - min_x, max_y - min_y, max_z - min_z
center_x, center_y = (min_x + max_x) / 2, (min_y + max_y) / 2
at_z = lambda ratio: min_z + height * ratio

# Rigify is bundled with Blender. The operator creates the small 29-bone human
# metarig, not the large generated animation-control rig.
try:
    bpy.ops.preferences.addon_enable(module="rigify")
except Exception:
    pass
if not hasattr(bpy.ops.object, "armature_basic_human_metarig_add"):
    raise RuntimeError("Blender's Rigify Basic Human metarig is unavailable")
bpy.ops.object.armature_basic_human_metarig_add()
rig = bpy.context.object
rig.location = (0, 0, 0)
rig.name = args.rig_name
rig.data.name = args.rig_name
rig.show_in_front = True
rig.data.display_type = "STICK"

# These landmarks are fitted to Robin's T-pose rather than leaving the stock
# metarig at its default proportions. Positive X is anatomical left in Blender.
hip_z, knee_z, ankle_z = at_z(.49), at_z(.265), at_z(.055)
shoulder_z, neck_z, crown_z = at_z(.675), at_z(.755), at_z(.965)
hip_x = width * .055
shoulder_x, elbow_x, wrist_x, hand_x = width * .165, width * .335, width * .445, width * .495
front_y = center_y - max(depth * .30, height * .035)

bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="EDIT")
edit = rig.data.edit_bones


def fit(name: str, head, tail) -> None:
    bone = edit.get(name)
    if bone is None:
        raise RuntimeError(f"Basic Human metarig is missing bone {name}")
    bone.head = head
    bone.tail = tail


# Pelvis, five-part torso, neck, and head.
spine_points = (
    (center_x, center_y, hip_z - height * .025),
    (center_x, center_y, at_z(.525)),
    (center_x, center_y, at_z(.575)),
    (center_x, center_y, at_z(.625)),
    (center_x, center_y, at_z(.68)),
    (center_x, center_y, at_z(.715)),
    (center_x, center_y, neck_z),
    (center_x, center_y, crown_z),
)
for index, name in enumerate(("spine", "spine.001", "spine.002", "spine.003", "spine.004", "spine.005", "spine.006")):
    fit(name, spine_points[index], spine_points[index + 1])

for suffix, sign in (("L", 1), ("R", -1)):
    fit(f"pelvis.{suffix}", (center_x, center_y, hip_z), (center_x + sign * hip_x, center_y, hip_z))
    fit(f"shoulder.{suffix}", (center_x, center_y, at_z(.705)), (center_x + sign * shoulder_x, center_y, shoulder_z))
    fit(f"upper_arm.{suffix}", (center_x + sign * shoulder_x, center_y, shoulder_z), (center_x + sign * elbow_x, center_y, shoulder_z))
    fit(f"forearm.{suffix}", (center_x + sign * elbow_x, center_y, shoulder_z), (center_x + sign * wrist_x, center_y, shoulder_z))
    fit(f"hand.{suffix}", (center_x + sign * wrist_x, center_y, shoulder_z), (center_x + sign * hand_x, center_y, shoulder_z))
    fit(f"breast.{suffix}", (center_x + sign * width * .06, center_y, at_z(.65)), (center_x + sign * width * .11, front_y, at_z(.65)))
    fit(f"thigh.{suffix}", (center_x + sign * hip_x, center_y, hip_z), (center_x + sign * width * .065, center_y, knee_z))
    fit(f"shin.{suffix}", (center_x + sign * width * .065, center_y, knee_z), (center_x + sign * width * .065, center_y, ankle_z))
    fit(f"foot.{suffix}", (center_x + sign * width * .065, center_y, ankle_z), (center_x + sign * width * .065, front_y, at_z(.025)))
    fit(f"toe.{suffix}", (center_x + sign * width * .065, front_y, at_z(.025)), (center_x + sign * width * .065, center_y - depth * .48, at_z(.02)))
    fit(f"heel.02.{suffix}", (center_x + sign * width * .065, center_y, ankle_z), (center_x + sign * width * .065, center_y + depth * .22, at_z(.025)))

# The pelvis, breast, and heel markers help define a metarig but should not
# deform this fused game mesh.
for name in ("pelvis.L", "pelvis.R", "breast.L", "breast.R", "heel.02.L", "heel.02.R"):
    edit[name].use_deform = False
bpy.ops.object.mode_set(mode="OBJECT")
for pose_bone in rig.pose.bones:
    pose_bone.custom_shape = None

# Automatic heat weights are a strong baseline for fused clothing and props.
# Then explicitly constrain each exposed limb to its anatomical chain so the
# hands, elbows, knees, and feet cannot borrow weights from the torso/opposite
# side. This is deterministic and inspectable, unlike a nearest-bone fallback.
bpy.ops.object.select_all(action="DESELECT")
for mesh in meshes:
    mesh.select_set(True)
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.parent_set(type="ARMATURE_AUTO")


def segment_weight(value: float, start: float, joint: float, end: float):
    blend = max((end - start) * .09, height * .012)
    if value <= joint - blend:
        return 1.0, 0.0
    if value >= joint + blend:
        return 0.0, 1.0
    second = (value - (joint - blend)) / (2 * blend)
    return 1.0 - second, second


for mesh in meshes:
    groups = {bone.name: mesh.vertex_groups.get(bone.name) or mesh.vertex_groups.new(name=bone.name)
              for bone in rig.data.bones if bone.use_deform}
    arm_root = width * .14
    leg_ceiling = at_z(.515)
    for vertex in mesh.data.vertices:
        point = mesh.matrix_world @ vertex.co
        side = "L" if point.x >= center_x else "R"
        side_sign = 1 if side == "L" else -1
        lateral = side_sign * (point.x - center_x)
        assignments = None
        if lateral >= arm_root and point.z >= at_z(.57):
            if lateral <= elbow_x:
                a, b = segment_weight(lateral, shoulder_x, elbow_x, wrist_x)
                assignments = ((f"upper_arm.{side}", a), (f"forearm.{side}", b))
            elif lateral <= wrist_x:
                a, b = segment_weight(lateral, elbow_x, wrist_x, hand_x)
                assignments = ((f"forearm.{side}", a), (f"hand.{side}", b))
            else:
                assignments = ((f"hand.{side}", 1.0),)
        elif point.z <= leg_ceiling and lateral >= width * .018:
            if point.z >= knee_z:
                a, b = segment_weight(point.z, knee_z, hip_z, hip_z + height * .02)
                assignments = ((f"thigh.{side}", max(a, b)),)
            elif point.z >= ankle_z:
                # Blend thigh to shin around the knee while descending Z.
                blend = height * .035
                shin_weight = min(1.0, max(0.0, (knee_z + blend - point.z) / (2 * blend)))
                assignments = ((f"thigh.{side}", 1 - shin_weight), (f"shin.{side}", shin_weight))
            else:
                assignments = ((f"foot.{side}", .8), (f"toe.{side}", .2))
        if assignments is None:
            continue
        for group in groups.values():
            group.remove([vertex.index])
        total = sum(weight for _, weight in assignments)
        for name, weight in assignments:
            if weight > 1e-5:
                groups[name].add([vertex.index], weight / total, "REPLACE")

    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    bpy.ops.object.vertex_group_clean(group_select_mode="BONE_DEFORM", limit=.001, keep_single=True)
    bpy.ops.object.vertex_group_limit_total(group_select_mode="BONE_DEFORM", limit=4)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode="BONE_DEFORM", lock_active=False)


def world_rotation(pose_bone, rotations):
    basis = pose_bone.bone.matrix_local.to_3x3().inverted()
    result = Quaternion()
    for axis, angle in rotations:
        result = Quaternion((basis @ Vector(axis)).normalized(), angle) @ result
    return result


def make_action(name, end_frame, frames):
    action = bpy.data.actions.new(name)
    action.use_fake_user = True
    rig.animation_data_create()
    rig.animation_data.action = action
    for frame, transforms in frames.items():
        for pose_bone in rig.pose.bones:
            pose_bone.rotation_mode = "QUATERNION"
            pose_bone.rotation_quaternion = Quaternion()
            pose_bone.location = (0, 0, 0)
            pose_bone.scale = (1, 1, 1)
        for bone_name, rotations in transforms.items():
            rig.pose.bones[bone_name].rotation_quaternion = world_rotation(rig.pose.bones[bone_name], rotations)
        for pose_bone in rig.pose.bones:
            pose_bone.keyframe_insert("rotation_quaternion", frame=frame, group=pose_bone.name)
    action.frame_start, action.frame_end = 1, end_frame
    return action


axis_x, axis_y, axis_z = (1, 0, 0), (0, 1, 0), (0, 0, 1)
left_down = [(axis_y, math.radians(72)), (axis_x, math.radians(-3))]
right_down = [(axis_y, math.radians(-72)), (axis_x, math.radians(3))]

idle = make_action(f"{args.clip_prefix}_Idle", 48, {
    1: {"upper_arm.L": left_down, "upper_arm.R": right_down},
    24: {"upper_arm.L": [(axis_y, math.radians(69))], "upper_arm.R": [(axis_y, math.radians(-69))],
         "spine.003": [(axis_z, math.radians(1.5))], "spine.006": [(axis_z, math.radians(-1.5))]},
    48: {"upper_arm.L": left_down, "upper_arm.R": right_down},
})
walk = make_action(f"{args.clip_prefix}_Walk", 24, {
    1: {"upper_arm.L": left_down + [(axis_x, math.radians(-12))], "upper_arm.R": right_down + [(axis_x, math.radians(12))],
        "thigh.L": [(axis_x, math.radians(-22))], "thigh.R": [(axis_x, math.radians(22))], "shin.L": [(axis_x, math.radians(18))]},
    7: {"upper_arm.L": left_down, "upper_arm.R": right_down},
    13: {"upper_arm.L": left_down + [(axis_x, math.radians(12))], "upper_arm.R": right_down + [(axis_x, math.radians(-12))],
         "thigh.L": [(axis_x, math.radians(22))], "thigh.R": [(axis_x, math.radians(-22))], "shin.R": [(axis_x, math.radians(18))]},
    19: {"upper_arm.L": left_down, "upper_arm.R": right_down},
    24: {"upper_arm.L": left_down + [(axis_x, math.radians(-12))], "upper_arm.R": right_down + [(axis_x, math.radians(12))],
         "thigh.L": [(axis_x, math.radians(-22))], "thigh.R": [(axis_x, math.radians(22))], "shin.L": [(axis_x, math.radians(18))]},
})
attack = make_action(f"{args.clip_prefix}_Attack", 30, {
    1: {"upper_arm.L": left_down, "upper_arm.R": right_down},
    10: {"upper_arm.L": left_down, "upper_arm.R": [(axis_y, math.radians(-28)), (axis_x, math.radians(-35))],
         "forearm.R": [(axis_y, math.radians(-55))], "spine.003": [(axis_z, math.radians(-9))]},
    18: {"upper_arm.L": left_down, "upper_arm.R": [(axis_y, math.radians(-52)), (axis_x, math.radians(24))],
         "forearm.R": [(axis_y, math.radians(-18))], "spine.003": [(axis_z, math.radians(7))]},
    30: {"upper_arm.L": left_down, "upper_arm.R": right_down},
})

rig.animation_data.action = idle
game_root = bpy.data.objects.new(args.root_name, None)
bpy.context.scene.collection.objects.link(game_root)
rig.parent = game_root
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = 48

blend_output = pathlib.Path(args.blend_output).resolve()
glb_output = pathlib.Path(args.glb_output).resolve()
blend_output.parent.mkdir(parents=True, exist_ok=True)
glb_output.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(blend_output))
bpy.ops.export_scene.gltf(
    filepath=str(glb_output), export_format="GLB", export_yup=True,
    export_skins=True, export_animations=True, export_animation_mode="ACTIONS",
    export_def_bones=True, export_extras=True,
)
print(
    f"HUMAN_RIGGED meshes={len(meshes)} bones={len(rig.data.bones)} "
    f"deform={sum(bone.use_deform for bone in rig.data.bones)} "
    f"custom_shapes={sum(pose.custom_shape is not None for pose in rig.pose.bones)} "
    f"actions={[action.name for action in bpy.data.actions]}"
)
