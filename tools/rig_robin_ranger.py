import bpy
import math
import os
import sys
from mathutils import Vector


def arg_after_separator(index):
    args = sys.argv[sys.argv.index("--") + 1:]
    return args[index]


SOURCE = arg_after_separator(0)
OUTPUT = arg_after_separator(1)
PREVIEW = arg_after_separator(2)


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def create_material(name, color, metallic=0.0, roughness=0.7):
    material = bpy.data.materials.new(name)
    material.diffuse_color = (*color, 1.0)
    material.use_nodes = True
    principled = material.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = (*color, 1.0)
    principled.inputs["Roughness"].default_value = roughness
    principled.inputs["Metallic"].default_value = metallic
    return material


def add_cube(name, location, scale, material, bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        modifier = obj.modifiers.new("Soft edges", "BEVEL")
        modifier.width = bevel
        modifier.segments = 2
    obj.data.materials.append(material)
    return obj


def add_cylinder(name, location, radius, depth, material, vertices=10):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(material)
    return obj


def add_cone(name, location, radius_1, radius_2, depth, material, vertices=10):
    bpy.ops.mesh.primitive_cone_add(
        vertices=vertices,
        radius1=radius_1,
        radius2=radius_2,
        depth=depth,
        location=location,
    )
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(material)
    return obj


def parent_to_bone(obj, armature, bone_name):
    world_matrix = obj.matrix_world.copy()
    obj.parent = armature
    obj.parent_type = "BONE"
    obj.parent_bone = bone_name
    bone_matrix = armature.matrix_world @ armature.pose.bones[bone_name].matrix
    obj.matrix_parent_inverse = bone_matrix.inverted()
    obj.matrix_world = world_matrix


def create_bow(material_wood, material_string):
    curve = bpy.data.curves.new("RobinBowCurve", "CURVE")
    curve.dimensions = "3D"
    curve.bevel_depth = 0.012
    curve.bevel_resolution = 2
    spline = curve.splines.new("BEZIER")
    spline.bezier_points.add(2)
    points = [(-0.05, 0.0, -0.28), (0.16, 0.0, 0.0), (-0.05, 0.0, 0.28)]
    for point, coordinate in zip(spline.bezier_points, points):
        point.co = coordinate
        point.handle_left_type = "AUTO"
        point.handle_right_type = "AUTO"
    bow = bpy.data.objects.new("RobinBow", curve)
    bpy.context.collection.objects.link(bow)
    bow.data.materials.append(material_wood)

    string = bpy.data.curves.new("RobinBowStringCurve", "CURVE")
    string.dimensions = "3D"
    string.bevel_depth = 0.003
    line = string.splines.new("POLY")
    line.points.add(2)
    for point, coordinate in zip(line.points, [(-0.05, 0.0, -0.28), (0.08, 0.0, 0.0), (-0.05, 0.0, 0.28)]):
        point.co = (*coordinate, 1.0)
    string_object = bpy.data.objects.new("RobinBowString", string)
    bpy.context.collection.objects.link(string_object)
    string_object.data.materials.append(material_string)
    return bow, string_object


def create_quiver(material_leather, material_wood, material_metal):
    parts = []
    quiver = add_cone("RobinQuiver", (0.0, 0.0, 0.0), 0.075, 0.09, 0.34, material_leather, vertices=12)
    parts.append(quiver)
    rim = add_cylinder("RobinQuiverRim", (0.0, 0.0, 0.17), 0.095, 0.025, material_metal, vertices=12)
    parts.append(rim)
    for index, x_offset in enumerate((-0.045, -0.015, 0.015, 0.045)):
        arrow = add_cylinder(f"RobinQuiverArrow{index}", (x_offset, 0.0, 0.26), 0.008, 0.40, material_wood, vertices=8)
        arrow.rotation_euler = (0.10 * index, 0.0, 0.04 * index)
        tip = add_cone(f"RobinQuiverArrowTip{index}", (x_offset, 0.0, 0.47), 0.022, 0.0, 0.06, material_metal, vertices=6)
        tip.rotation_euler = arrow.rotation_euler
        parts.extend((arrow, tip))
    return parts


def create_armature():
    bpy.ops.object.armature_add(enter_editmode=True, location=(0, 0, 0))
    armature = bpy.context.object
    armature.name = "RobinArmature"
    armature.data.name = "RobinRig"
    armature.show_in_front = True
    edit_bones = armature.data.edit_bones
    edit_bones.remove(edit_bones[0])

    bones = {}

    def bone(name, head, tail, parent=None):
        value = edit_bones.new(name)
        value.head = head
        value.tail = tail
        if parent:
            value.parent = bones[parent]
            value.use_connect = head == bones[parent].tail
        bones[name] = value
        return value

    bone("root", (0, 0, 0.00), (0, 0, 0.10))
    bone("hips", (0, 0, 0.10), (0, 0, 0.28), "root")
    bone("spine", (0, 0, 0.28), (0, 0, 0.48), "hips")
    bone("chest", (0, 0, 0.48), (0, 0, 0.64), "spine")
    bone("neck", (0, 0, 0.64), (0, 0, 0.75), "chest")
    bone("head", (0, 0, 0.75), (0, 0, 0.94), "neck")

    for side, sign in (("L", -1), ("R", 1)):
        shoulder = bone(f"shoulder.{side}", (0.12 * sign, 0, 0.62), (0.22 * sign, 0, 0.61), "chest")
        upper = bone(f"upper_arm.{side}", shoulder.tail, (0.34 * sign, 0, 0.49), f"shoulder.{side}")
        fore = bone(f"forearm.{side}", upper.tail, (0.41 * sign, 0.005, 0.35), f"upper_arm.{side}")
        bone(f"hand.{side}", fore.tail, (0.43 * sign, 0.005, 0.29), f"forearm.{side}")
        upper_leg = bone(f"thigh.{side}", (0.10 * sign, 0, 0.27), (0.13 * sign, 0.01, 0.10), "hips")
        shin = bone(f"shin.{side}", upper_leg.tail, (0.15 * sign, 0.005, 0.02), f"thigh.{side}")
        bone(f"foot.{side}", shin.tail, (0.15 * sign, -0.11, 0.01), f"shin.{side}")

    bpy.ops.object.mode_set(mode="POSE")
    for pose_bone in armature.pose.bones:
        pose_bone.rotation_mode = "XYZ"
    bpy.ops.object.mode_set(mode="OBJECT")
    return armature


def auto_weight(mesh, armature):
    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")


def set_rotation(armature, bone_name, frame, rotation):
    pose_bone = armature.pose.bones[bone_name]
    pose_bone.rotation_euler = rotation
    pose_bone.keyframe_insert(data_path="rotation_euler", frame=frame)


def new_action(armature, name, frame_end):
    action = bpy.data.actions.new(name)
    armature.animation_data_create()
    armature.animation_data.action = action
    bpy.context.scene.frame_start = 1
    bpy.context.scene.frame_end = frame_end
    return action


def create_idle(armature):
    new_action(armature, "Robin_Idle", 40)
    for frame, chest_z, head_z, arm_l, arm_r in ((1, 0.00, 0.00, 0.05, -0.05), (20, 0.025, -0.015, 0.08, -0.08), (40, 0.00, 0.00, 0.05, -0.05)):
        set_rotation(armature, "chest", frame, (0.0, 0.0, chest_z))
        set_rotation(armature, "head", frame, (0.0, 0.0, head_z))
        set_rotation(armature, "upper_arm.L", frame, (0.0, arm_l, 0.0))
        set_rotation(armature, "upper_arm.R", frame, (0.0, arm_r, 0.0))


def create_walk(armature):
    new_action(armature, "Robin_Walk", 24)
    poses = ((1, 0.55), (7, -0.55), (13, 0.55), (19, -0.55), (24, 0.55))
    for frame, swing in poses:
        set_rotation(armature, "thigh.L", frame, (swing, 0.0, 0.0))
        set_rotation(armature, "thigh.R", frame, (-swing, 0.0, 0.0))
        set_rotation(armature, "shin.L", frame, (-max(0.0, swing) * 0.8, 0.0, 0.0))
        set_rotation(armature, "shin.R", frame, (-max(0.0, -swing) * 0.8, 0.0, 0.0))
        set_rotation(armature, "upper_arm.L", frame, (-swing * 0.55, 0.0, 0.0))
        set_rotation(armature, "upper_arm.R", frame, (swing * 0.55, 0.0, 0.0))
        set_rotation(armature, "chest", frame, (0.0, 0.0, swing * 0.06))


def create_shoot(armature):
    new_action(armature, "Robin_Shoot", 28)
    for frame in (1, 28):
        set_rotation(armature, "upper_arm.L", frame, (0.0, 0.0, 0.0))
        set_rotation(armature, "forearm.L", frame, (0.0, 0.0, 0.0))
        set_rotation(armature, "upper_arm.R", frame, (0.0, 0.0, 0.0))
        set_rotation(armature, "forearm.R", frame, (0.0, 0.0, 0.0))
        set_rotation(armature, "chest", frame, (0.0, 0.0, 0.0))
    set_rotation(armature, "chest", 12, (0.0, 0.0, -0.18))
    set_rotation(armature, "upper_arm.L", 12, (-0.75, 0.0, 0.18))
    set_rotation(armature, "forearm.L", 12, (-0.45, 0.0, 0.0))
    set_rotation(armature, "upper_arm.R", 12, (0.85, 0.0, -0.16))
    set_rotation(armature, "forearm.R", 12, (0.60, 0.0, 0.0))


def setup_preview(armature):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 640
    scene.render.resolution_y = 640
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = PREVIEW
    if scene.world is None:
        scene.world = bpy.data.worlds.new("RobinPreviewWorld")
    scene.world.color = (0.045, 0.065, 0.05)

    bpy.ops.object.light_add(type="AREA", location=(2.3, -3.2, 3.6))
    key = bpy.context.object
    key.data.energy = 800
    key.data.shape = "DISK"
    key.data.size = 4.0
    key.rotation_euler = (math.radians(38), 0, math.radians(30))

    bpy.ops.object.light_add(type="AREA", location=(-2.0, 1.8, 2.2))
    fill = bpy.context.object
    fill.data.energy = 450
    fill.data.size = 3.0
    fill.rotation_euler = (math.radians(-45), 0, math.radians(-145))

    bpy.ops.object.camera_add(location=(2.1, -3.6, 1.55))
    camera = bpy.context.object
    camera.data.lens = 55
    direction = Vector((0.0, 0.0, 0.50)) - camera.location
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    scene.camera = camera
    bpy.context.scene.frame_set(1)
    bpy.ops.render.render(write_still=True)


def main():
    reset_scene()
    bpy.ops.import_scene.gltf(filepath=SOURCE)
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if len(meshes) != 1:
        raise RuntimeError(f"Expected one source mesh, found {len(meshes)}")
    body = meshes[0]
    body.name = "RobinBody"
    body.data.name = "RobinBodyMesh"

    leather = create_material("RobinLeather", (0.18, 0.07, 0.025), roughness=0.86)
    wood = create_material("RobinYewWood", (0.12, 0.045, 0.012), roughness=0.72)
    string = create_material("RobinBowString", (0.74, 0.68, 0.48), roughness=0.5)
    metal = create_material("RobinArrowheads", (0.28, 0.30, 0.26), metallic=0.65, roughness=0.36)

    armature = create_armature()
    auto_weight(body, armature)
    body.parent = None

    bow, bow_string = create_bow(wood, string)
    bow.location = (0.37, -0.10, 0.49)
    bow.rotation_euler = (math.radians(3), math.radians(18), math.radians(8))
    bow_string.location = bow.location
    bow_string.rotation_euler = bow.rotation_euler
    bow.parent = body
    bow_string.parent = body

    quiver_parts = create_quiver(leather, wood, metal)
    for part in quiver_parts:
        part.location += Vector((-0.17, 0.09, 0.54))
        part.rotation_euler = (math.radians(-8), math.radians(12), math.radians(-8))
        part.parent = body

    create_idle(armature)
    create_walk(armature)
    create_shoot(armature)
    armature.animation_data.action = bpy.data.actions["Robin_Idle"]

    setup_preview(armature)
    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=OUTPUT,
        export_format="GLB",
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_force_sampling=True,
        export_yup=True,
        export_materials="EXPORT",
        export_cameras=False,
        export_lights=False,
    )
    print(f"Exported {OUTPUT}")


if __name__ == "__main__":
    main()
