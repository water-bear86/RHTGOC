"""Build Sherwood-ready KayKit hero GLBs without modifying the source pack.

Run with Blender 5.1 or newer:

    blender --background --factory-startup \
      --python tools/build-kaykit-characters.py -- \
      --source-dir /path/to/KayKit_Adventurers_2.0_FREE \
      --animation-dir /path/to/KayKit_Character_Animations_1.1/Animations \
      --output-dir public/assets/characters

KayKit ships character meshes and animation libraries separately. This builder
keeps each native Rig_Medium skin, equips each hero with a native KayKit bow,
assembles four compatible animation clips, applies a role palette, and emits
one self-contained GLB per Sherwood hero. Both downloaded source directories
are read-only throughout.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from math import ceil, floor, pi
from pathlib import Path
import sys
import tempfile

import bpy
from mathutils import Matrix, Vector
import numpy as np


EXPECTED_BONES = {
    "root",
    "hips",
    "upperleg.l",
    "lowerleg.l",
    "foot.l",
    "toes.l",
    "upperleg.r",
    "lowerleg.r",
    "foot.r",
    "toes.r",
    "spine",
    "chest",
    "head",
    "upperarm.l",
    "lowerarm.l",
    "wrist.l",
    "hand.l",
    "handslot.l",
    "upperarm.r",
    "lowerarm.r",
    "wrist.r",
    "hand.r",
    "handslot.r",
}

ATTACK_SECONDS = 1.0
ATTACK_DRAW_SECONDS = 0.6
ROBIN_SIGNATURE_SECONDS = 0.8
ROBIN_SIGNATURE_DRAW_SECONDS = 0.12
EXPORT_FPS = 30
BOW_ROTATION_XYZ = (-pi / 2.0, 0.0, -pi)
BOW_SCALE = 0.91


@dataclass(frozen=True)
class RoleSpec:
    role: str
    source_name: str
    mesh_prefix: str
    output_name: str
    signature_action: str | None
    source_hue: str | None
    target_hue_rgb: tuple[float, float, float] | None
    saturation_floor: float = 0.25
    join_into_body: tuple[str, ...] = ()


@dataclass(frozen=True)
class BowClipTiming:
    total_seconds: float
    draw_seconds: float
    use_complete_draw: bool


ATTACK_TIMING = BowClipTiming(
    total_seconds=ATTACK_SECONDS,
    draw_seconds=ATTACK_DRAW_SECONDS,
    use_complete_draw=True,
)
ROBIN_SIGNATURE_TIMING = BowClipTiming(
    total_seconds=ROBIN_SIGNATURE_SECONDS,
    draw_seconds=ROBIN_SIGNATURE_DRAW_SECONDS,
    use_complete_draw=False,
)


ROLE_SPECS = (
    RoleSpec(
        role="robin",
        source_name="Ranger",
        mesh_prefix="Ranger_",
        output_name="robin-kaykit-ranger.glb",
        signature_action=None,
        source_hue="blue",
        target_hue_rgb=(0.18, 1.0, 0.28),
        saturation_floor=0.28,
        join_into_body=("Ranger_Cape",),
    ),
    RoleSpec(
        role="marian",
        source_name="Rogue",
        mesh_prefix="Rogue_",
        output_name="marian-kaykit-rogue.glb",
        signature_action="Use_Item",
        source_hue="green",
        target_hue_rgb=(1.0, 0.18, 0.55),
    ),
    RoleSpec(
        role="little-john",
        source_name="Barbarian",
        mesh_prefix="Barbarian_",
        output_name="little-john-kaykit-barbarian.glb",
        signature_action="Use_Item",
        source_hue=None,
        target_hue_rgb=None,
    ),
    RoleSpec(
        role="much",
        source_name="Rogue_Hooded",
        mesh_prefix="RogueHooded_",
        output_name="much-kaykit-rogue-hooded.glb",
        signature_action="Throw",
        source_hue="green",
        target_hue_rgb=(0.75, 1.0, 0.12),
        join_into_body=("RogueHooded_Cape",),
    ),
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-dir", required=True)
    parser.add_argument("--animation-dir", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument(
        "--roles",
        nargs="*",
        choices=[spec.role for spec in ROLE_SPECS],
        help="Build only these roles; defaults to all four.",
    )
    return parser.parse_args(sys.argv[sys.argv.index("--") + 1 :])


def import_gltf(path: Path) -> list[bpy.types.Object]:
    if not path.is_file():
        raise FileNotFoundError(path)
    before = set(bpy.context.scene.objects)
    result = bpy.ops.import_scene.gltf(filepath=str(path))
    if "FINISHED" not in result:
        raise RuntimeError(f"Blender failed to import {path}")
    return [obj for obj in bpy.context.scene.objects if obj not in before]


def remove_objects(objects: list[bpy.types.Object]) -> None:
    for obj in objects:
        if obj.name in bpy.data.objects:
            bpy.data.objects.remove(obj, do_unlink=True)


def character_material(meshes: list[bpy.types.Object]) -> bpy.types.Material:
    materials = {
        slot.material
        for mesh in meshes
        for slot in mesh.material_slots
        if slot.material is not None
    }
    if len(materials) != 1:
        raise RuntimeError(f"Expected one shared KayKit material, found {[m.name for m in materials]}")
    material = next(iter(materials))
    material.metallic = 0.0
    material.roughness = 0.92
    return material


def material_image(material: bpy.types.Material) -> bpy.types.Image:
    if material.node_tree is None:
        raise RuntimeError(f"KayKit material {material.name} has no node tree")
    images = {
        node.image
        for node in material.node_tree.nodes
        if node.type == "TEX_IMAGE" and node.image is not None
    }
    if len(images) != 1:
        raise RuntimeError(f"Expected one image in {material.name}, found {len(images)}")
    return next(iter(images))


def hue_mask(rgb: np.ndarray, source_hue: str, saturation_floor: float) -> np.ndarray:
    maximum = rgb.max(axis=1)
    minimum = rgb.min(axis=1)
    saturation = np.divide(
        maximum - minimum,
        maximum,
        out=np.zeros_like(maximum),
        where=maximum > 1e-6,
    )
    if source_hue == "blue":
        dominant = (rgb[:, 2] > rgb[:, 0] + 0.035) & (rgb[:, 2] > rgb[:, 1] + 0.012)
    elif source_hue == "green":
        dominant = (rgb[:, 1] > rgb[:, 0] + 0.035) & (rgb[:, 1] > rgb[:, 2] + 0.01)
    else:
        raise ValueError(f"Unsupported source hue: {source_hue}")
    return dominant & (saturation >= saturation_floor) & (maximum > 0.08)


def apply_role_palette(
    material: bpy.types.Material,
    spec: RoleSpec,
    temp_dir: Path,
) -> None:
    source = material_image(material)
    image = source.copy()
    image.name = f"{spec.role}_kaykit_palette"

    selected_count = 0
    if spec.source_hue and spec.target_hue_rgb:
        pixels = np.empty(len(image.pixels), dtype=np.float32)
        image.pixels.foreach_get(pixels)
        rgba = pixels.reshape((-1, 4))
        rgb = rgba[:, :3]
        selected = hue_mask(rgb, spec.source_hue, spec.saturation_floor)
        selected_count = int(np.count_nonzero(selected))
        if selected_count == 0:
            raise RuntimeError(f"Palette mask selected no {spec.source_hue} pixels for {spec.role}")
        chosen = rgb[selected]
        maximum = chosen.max(axis=1)
        minimum = chosen.min(axis=1)
        saturation = np.divide(
            maximum - minimum,
            maximum,
            out=np.zeros_like(maximum),
            where=maximum > 1e-6,
        )
        target = np.asarray(spec.target_hue_rgb, dtype=np.float32)
        target /= target.max()
        rgb[selected] = maximum[:, None] * (
            1.0 - saturation[:, None] + saturation[:, None] * target[None, :]
        )
        np.clip(rgba, 0.0, 1.0, out=rgba)
        image.pixels.foreach_set(pixels)
        image.update()

    texture_path = temp_dir / f"{spec.role}-palette.png"
    image.file_format = "PNG"
    image.filepath_raw = str(texture_path)
    image.save()

    # The glTF exporter may reuse the packed bytes from an imported image even
    # after its pixel buffer changes. Reload the saved palette as a new file-backed
    # image so the exported WebP always contains the recolour we just authored.
    exported_image = bpy.data.images.load(str(texture_path), check_existing=False)
    exported_image.name = f"{spec.role}_kaykit_palette_export"
    for node in material.node_tree.nodes:
        if node.type == "TEX_IMAGE" and node.image is source:
            node.image = exported_image
    print({"role": spec.role, "palette_pixels_recoloured": selected_count})


def copy_library_action(source_name: str, target_name: str) -> bpy.types.Action:
    source_action = bpy.data.actions.get(source_name)
    if source_action is None:
        raise RuntimeError(f"Animation library is missing {source_name}")
    action = source_action.copy()
    action.name = target_name
    action.use_fake_user = True
    return action


def add_action_track(
    animation_data: bpy.types.AnimData,
    clip_name: str,
    action: bpy.types.Action,
) -> None:
    track = animation_data.nla_tracks.new()
    track.name = clip_name
    start = float(action.frame_range[0])
    strip = track.strips.new(clip_name, floor(start), action)
    strip.name = clip_name
    strip.frame_start = start
    strip.extrapolation = "NOTHING"


def add_bow_attack_track(
    animation_data: bpy.types.AnimData,
    clip_name: str,
    draw_action: bpy.types.Action,
    release_action: bpy.types.Action,
    timing: BowClipTiming,
) -> None:
    fps = bpy.context.scene.render.fps / bpy.context.scene.render.fps_base
    total_frames = timing.total_seconds * fps
    draw_target_frames = timing.draw_seconds * fps
    release_target_frames = total_frames - draw_target_frames
    if draw_target_frames <= 0.0 or release_target_frames <= 0.0:
        raise RuntimeError(f"Invalid {clip_name} bow timing: {timing}")

    draw_source_start, draw_source_end = (
        float(value) for value in draw_action.frame_range
    )
    release_source_start, release_source_end = (
        float(value) for value in release_action.frame_range
    )
    draw_source_frames = draw_source_end - draw_source_start
    release_source_frames = release_source_end - release_source_start
    if draw_source_frames <= 0.0 or release_source_frames <= 0.0:
        raise RuntimeError(f"Bow source actions are too short to assemble {clip_name}")

    if timing.use_complete_draw:
        selected_draw_start = draw_source_start
        selected_draw_frames = draw_source_frames
    else:
        if draw_source_frames < draw_target_frames:
            raise RuntimeError(
                f"Bow draw source is too short to assemble the legacy {clip_name} clip"
            )
        selected_draw_start = draw_source_end - draw_target_frames
        selected_draw_frames = draw_target_frames

    track = animation_data.nla_tracks.new()
    track.name = clip_name

    draw_strip = track.strips.new(f"{clip_name}_Draw", 0, draw_action)
    draw_strip.name = f"{clip_name}_Draw"
    draw_strip.action_frame_start = selected_draw_start
    draw_strip.action_frame_end = draw_source_end
    draw_strip.frame_start = 0.0
    draw_strip.scale = draw_target_frames / selected_draw_frames
    draw_strip.extrapolation = "NOTHING"

    release_strip = track.strips.new(
        f"{clip_name}_Release",
        ceil(draw_target_frames),
        release_action,
    )
    release_strip.name = f"{clip_name}_Release"
    release_strip.action_frame_start = release_source_start
    release_strip.action_frame_end = release_source_end
    release_strip.frame_start = draw_target_frames
    release_strip.scale = release_target_frames / release_source_frames
    release_strip.extrapolation = "NOTHING"

    if abs(draw_strip.frame_end - draw_target_frames) > 1e-4:
        raise RuntimeError(
            f"{clip_name} draw timing drifted: expected {draw_target_frames} frames, "
            f"got {draw_strip.frame_end}"
        )
    if abs(release_strip.frame_end - total_frames) > 1e-4:
        raise RuntimeError(
            f"{clip_name} timing drifted: expected {total_frames} frames, "
            f"got {release_strip.frame_end}"
        )
    print(
        {
            "clip": clip_name,
            "seconds": timing.total_seconds,
            "draw_seconds": timing.draw_seconds,
            "complete_draw": timing.use_complete_draw,
            "release_normalized": round(
                timing.draw_seconds / timing.total_seconds, 5
            ),
            "release_frame": round(draw_target_frames, 5),
            "end_frame": round(release_strip.frame_end, 5),
        }
    )


def configure_animation_tracks(
    armature: bpy.types.Object,
    animation_dir: Path,
    spec: RoleSpec,
) -> tuple[list[bpy.types.Action], list[str]]:
    rig_dir = animation_dir / "gltf/Rig_Medium"
    general = rig_dir / "Rig_Medium_General.glb"
    ranged = rig_dir / "Rig_Medium_CombatRanged.glb"
    movement = rig_dir / "Rig_Medium_MovementAdvanced.glb"
    imported_animation_objects = (
        import_gltf(general) + import_gltf(ranged) + import_gltf(movement)
    )

    idle = copy_library_action("Ranged_Bow_Idle", "Idle")
    walk = copy_library_action("Running_HoldingBow", "Walk")
    draw = copy_library_action("Ranged_Bow_Draw", "Attack_DrawSource")
    release = copy_library_action("Ranged_Bow_Release", "Attack_ReleaseSource")
    copied = [idle, walk, draw, release]

    signature = None
    if spec.signature_action is not None:
        signature = copy_library_action(spec.signature_action, "Signature")
        copied.append(signature)

    remove_objects(imported_animation_objects)

    animation_data = armature.animation_data_create()
    animation_data.action = None
    for track in list(animation_data.nla_tracks):
        animation_data.nla_tracks.remove(track)
    add_action_track(animation_data, "Idle", idle)
    add_action_track(animation_data, "Walk", walk)
    add_bow_attack_track(animation_data, "Attack", draw, release, ATTACK_TIMING)
    if signature is None:
        # Robin's existing signature timing is gameplay-significant and remains
        # independent from the longer basic-attack loading animation.
        add_bow_attack_track(
            animation_data,
            "Signature",
            draw,
            release,
            ROBIN_SIGNATURE_TIMING,
        )
    else:
        add_action_track(animation_data, "Signature", signature)

    for action in list(bpy.data.actions):
        if action not in copied:
            bpy.data.actions.remove(action)
    return copied, ["Idle", "Walk", "Attack", "Signature"]


def join_role_parts(
    meshes: list[bpy.types.Object],
    spec: RoleSpec,
) -> list[bpy.types.Object]:
    if not spec.join_into_body:
        return meshes
    body_name = f"{spec.mesh_prefix}Body"
    body = next((mesh for mesh in meshes if mesh.name == body_name), None)
    if body is None:
        raise RuntimeError(f"Could not find body mesh for {spec.role}")
    body_vertices_before = [
        body.matrix_world @ vertex.co for vertex in body.data.vertices
    ]
    parts = [
        next((mesh for mesh in meshes if mesh.name == name), None)
        for name in spec.join_into_body
    ]
    if any(part is None for part in parts):
        raise RuntimeError(
            f"Could not find join parts {spec.join_into_body} for {spec.role}"
        )

    bpy.ops.object.select_all(action="DESELECT")
    body.select_set(True)
    for part in parts:
        part.select_set(True)
    bpy.context.view_layer.objects.active = body
    result = bpy.ops.object.join()
    if "FINISHED" not in result:
        raise RuntimeError(f"Could not consolidate meshes for {spec.role}")
    body.name = body_name
    body_vertex_displacement = max(
        (
            (body.matrix_world @ body.data.vertices[index].co) - position
        ).length
        for index, position in enumerate(body_vertices_before)
    )
    if body_vertex_displacement > 1e-6:
        raise RuntimeError(
            f"Consolidating {spec.role} moved body vertices by "
            f"{body_vertex_displacement} Blender units"
        )
    print(
        {
            "role": spec.role,
            "body_vertex_displacement": round(body_vertex_displacement, 9),
        }
    )
    return [mesh for mesh in meshes if mesh not in parts]


def attach_bow(
    armature: bpy.types.Object,
    material: bpy.types.Material,
    source_dir: Path,
    role: str,
) -> bpy.types.Object:
    imported = import_gltf(source_dir / "Assets/gltf/bow_withString.gltf")
    bows = [
        obj
        for obj in imported
        if obj.type == "MESH" and obj.name.startswith("bow_withString")
    ]
    if len(bows) != 1:
        raise RuntimeError(f"Expected one bow mesh, found {[obj.name for obj in imported]}")
    bow = bows[0]
    for obj in imported:
        if obj is not bow:
            bpy.data.objects.remove(obj, do_unlink=True)
    for slot in bow.material_slots:
        slot.material = material
    bow.name = "KayKitBowString"
    bow.data.name = "KayKitBowString_Geometry"
    keys = bow.data.shape_keys
    draw_key = keys.key_blocks.get("Draw") if keys is not None else None
    if draw_key is None:
        raise RuntimeError("KayKit bow lost its Draw morph target")
    draw_key.value = 0.0

    bow.parent = armature
    bow.parent_type = "BONE"
    bow.parent_bone = "handslot.l"
    bow.matrix_parent_inverse = Matrix.Identity(4)
    bow.location = (0.0, 0.0, 0.0)
    # Native KayKit bow actions expect this equipment-space orientation.
    bow.rotation_mode = "XYZ"
    bow.rotation_euler = BOW_ROTATION_XYZ
    bow.scale = (BOW_SCALE, BOW_SCALE, BOW_SCALE)
    bpy.context.view_layer.update()
    world_corners = [bow.matrix_world @ Vector(corner) for corner in bow.bound_box]
    world_min = tuple(
        round(min(corner[axis] for corner in world_corners), 5) for axis in range(3)
    )
    world_max = tuple(
        round(max(corner[axis] for corner in world_corners), 5) for axis in range(3)
    )
    print(
        {
            "role": role,
            "bow_world_bounds_blender": {"min": world_min, "max": world_max},
        }
    )
    return bow


def export_role(
    source_dir: Path,
    animation_dir: Path,
    output_dir: Path,
    spec: RoleSpec,
    temp_dir: Path,
) -> dict[str, object]:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = EXPORT_FPS
    bpy.context.scene.render.fps_base = 1.0
    imported = import_gltf(source_dir / f"Characters/gltf/{spec.source_name}.glb")
    armatures = [obj for obj in imported if obj.type == "ARMATURE"]
    meshes = [
        obj
        for obj in imported
        if obj.type == "MESH" and obj.name.startswith(spec.mesh_prefix)
    ]
    helpers = [obj for obj in imported if obj not in armatures and obj not in meshes]
    remove_objects(helpers)
    if len(armatures) != 1 or not meshes:
        raise RuntimeError(f"Invalid {spec.source_name} character structure")
    armature = armatures[0]
    bones = {bone.name for bone in armature.data.bones}
    if bones != EXPECTED_BONES:
        raise RuntimeError(
            f"Unexpected {spec.source_name} skeleton: missing={sorted(EXPECTED_BONES - bones)} "
            f"extra={sorted(bones - EXPECTED_BONES)}"
        )

    material = character_material(meshes)
    apply_role_palette(material, spec, temp_dir)
    retained_actions, clip_names = configure_animation_tracks(
        armature, animation_dir, spec
    )
    meshes = join_role_parts(meshes, spec)
    meshes.append(attach_bow(armature, material, source_dir, spec.role))
    if len(meshes) > 8:
        raise RuntimeError(
            f"{spec.role} exceeds the eight-primitive hero budget: {len(meshes)}"
        )

    armature.name = f"{spec.role.replace('-', '_')}_Rig_Medium"
    armature.data.name = f"{spec.role.replace('-', '_')}_Rig_Medium"
    strips = [
        strip
        for track in armature.animation_data.nla_tracks
        for strip in track.strips
    ]
    bpy.context.scene.frame_start = floor(min(strip.frame_start for strip in strips))
    bpy.context.scene.frame_end = ceil(max(strip.frame_end for strip in strips))

    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    for mesh in meshes:
        mesh.select_set(True)
    bpy.context.view_layer.objects.active = armature

    output = output_dir / spec.output_name
    output.parent.mkdir(parents=True, exist_ok=True)
    result = bpy.ops.export_scene.gltf(
        filepath=str(output),
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=False,
        export_cameras=False,
        export_lights=False,
        export_materials="EXPORT",
        export_image_format="WEBP",
        export_image_quality=85,
        export_skins=True,
        export_def_bones=False,
        export_animations=True,
        # NLA tracks make all four named clips explicit. Exporting loose actions
        # can omit the action that Blender considers active.
        export_animation_mode="NLA_TRACKS",
        export_merge_animation="NLA_TRACK",
        export_anim_single_armature=True,
        export_optimize_animation_size=True,
        export_morph=True,
        export_morph_normal=True,
        export_morph_tangent=False,
        export_extras=True,
    )
    if "FINISHED" not in result or not output.is_file():
        raise RuntimeError(f"Blender failed to export {output}")
    return {
        "role": spec.role,
        "output": str(output),
        "bytes": output.stat().st_size,
        "bones": len(bones),
        "meshes": len(meshes),
        "actions": clip_names,
        "source_actions": [action.name for action in retained_actions],
        "bow": True,
    }


def main() -> None:
    args = parse_args()
    source_dir = Path(args.source_dir).expanduser().resolve()
    animation_dir = Path(args.animation_dir).expanduser().resolve()
    output_dir = Path(args.output_dir).expanduser().resolve()
    if not source_dir.is_dir():
        raise FileNotFoundError(source_dir)
    if not animation_dir.is_dir():
        raise FileNotFoundError(animation_dir)
    selected = set(args.roles or [spec.role for spec in ROLE_SPECS])

    results: list[dict[str, object]] = []
    with tempfile.TemporaryDirectory(prefix="sherwood-kaykit-") as temp:
        temp_root = Path(temp)
        for spec in ROLE_SPECS:
            if spec.role not in selected:
                continue
            role_temp = temp_root / spec.role
            role_temp.mkdir(parents=True, exist_ok=True)
            results.append(
                export_role(source_dir, animation_dir, output_dir, spec, role_temp)
            )
    print({"kaykit_characters": results})


if __name__ == "__main__":
    main()
