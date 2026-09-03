"""Expand Sherwood's normalized tree catalog with supplied CC0 FBX variants.

Run with Blender after extracting the project-owner supplied tree archive:

    blender --background --factory-startup \
      --python tools/expand-stylized-tree-catalog.py -- \
      --source-dir "/path/to/tree objects" \
      --nature-catalog public/assets/environment/sherwood-nature-dressing.glb \
      --output /tmp/sherwood-tree-catalog.raw.glb
"""

import argparse
import math
from pathlib import Path
import re
import sys

import bpy
from mathutils import Matrix, Vector


EXTRA_VARIANTS = (
    *(f"TwistedTree_{index}" for index in (1, 5)),
    "Pine_3",
    "Stump",
)

BASE_VARIANTS = {
    *(f"TreeVariant_Common_{index}" for index in range(1, 5)),
    "TreeVariant_Pine_2",
    "TreeVariant_Pine_5",
    "TreeVariant_Dead_3",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-dir", type=Path, required=True)
    parser.add_argument("--nature-catalog", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args(sys.argv[sys.argv.index("--") + 1 :])


def normalized_material_name(name: str) -> str:
    return re.sub(r"\.\d{3}$", "", name)


def imported_meshes(before: set[bpy.types.Object]) -> list[bpy.types.Object]:
    return [obj for obj in bpy.context.scene.objects if obj not in before and obj.type == "MESH"]


def import_gltf(path: Path) -> list[bpy.types.Object]:
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    return imported_meshes(before)


def import_fbx(path: Path) -> list[bpy.types.Object]:
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.fbx(filepath=str(path))
    return imported_meshes(before)


def transformed_bounds(objects: list[bpy.types.Object], transform: Matrix) -> tuple[Vector, Vector]:
    points = [transform @ obj.matrix_world @ Vector(corner) for obj in objects for corner in obj.bound_box]
    return (
        Vector(tuple(min(point[axis] for point in points) for axis in range(3))),
        Vector(tuple(max(point[axis] for point in points) for axis in range(3))),
    )


def normalize_variant(objects: list[bpy.types.Object]) -> None:
    minimum, maximum = transformed_bounds(objects, Matrix.Identity(4))
    dimensions = maximum - minimum
    axis_fix = Matrix.Rotation(math.pi / 2, 4, "X") if dimensions.y > dimensions.z * 1.15 else Matrix.Identity(4)
    minimum, maximum = transformed_bounds(objects, axis_fix)
    height = maximum.z - minimum.z
    if height <= 0:
        raise RuntimeError("Tree variant has no positive height")
    center = Vector(((minimum.x + maximum.x) / 2, (minimum.y + maximum.y) / 2, minimum.z))
    normalize = Matrix.Scale(1 / height, 4) @ Matrix.Translation(-center)
    for obj in objects:
        obj.data.transform(normalize @ axis_fix @ obj.matrix_world)
        obj.matrix_world = Matrix.Identity(4)


def join_variant(objects: list[bpy.types.Object], name: str) -> bpy.types.Object:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    if len(objects) > 1:
        bpy.ops.object.join()
    variant = bpy.context.active_object
    variant.name = name
    variant.data.name = f"{name}_Geometry"
    return variant


def main() -> None:
    args = parse_args()
    source_dir = args.source_dir.expanduser().resolve()
    nature_catalog_path = args.nature_catalog.expanduser().resolve()
    output = args.output.expanduser().resolve()
    base_catalog_path = source_dir / "sherwood-tree-catalog.glb"
    for required in (base_catalog_path, nature_catalog_path, *(source_dir / f"{name}.fbx" for name in EXTRA_VARIANTS)):
        if not required.is_file():
            raise FileNotFoundError(required)

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)

    catalog_objects = import_gltf(base_catalog_path)
    for obj in tuple(catalog_objects):
        if obj.name not in BASE_VARIANTS:
            catalog_objects.remove(obj)
            bpy.data.objects.remove(obj, do_unlink=True)
    canonical_materials = {
        normalized_material_name(material.name): material
        for material in bpy.data.materials
        if normalized_material_name(material.name) in {"Bark_NormalTree", "Leaves_NormalTree", "Leaves_Pine", "Bark_DeadTree"}
    }

    nature_objects = import_gltf(nature_catalog_path)
    twisted_leaves = next((material for material in bpy.data.materials if normalized_material_name(material.name) == "Leaves_TwistedTree"), None)
    if twisted_leaves is None:
        raise RuntimeError("Nature catalog is missing Leaves_TwistedTree")
    twisted_leaves.name = "Leaves_TwistedTree"
    canonical_materials["Leaves_TwistedTree"] = twisted_leaves
    for obj in nature_objects:
        bpy.data.objects.remove(obj, do_unlink=True)

    for source_name in EXTRA_VARIANTS:
        meshes = import_fbx(source_dir / f"{source_name}.fbx")
        if not meshes:
            raise RuntimeError(f"No mesh imported from {source_name}.fbx")
        normalize_variant(meshes)
        for obj in meshes:
            for slot in obj.material_slots:
                if slot.material is None:
                    continue
                imported_name = normalized_material_name(slot.material.name)
                if source_name.startswith("TwistedTree"):
                    target_name = "Leaves_TwistedTree" if imported_name.startswith("Leaves") else "Bark_NormalTree"
                elif source_name.startswith("Pine"):
                    target_name = "Leaves_Pine" if imported_name.startswith("Leaves") else "Bark_NormalTree"
                else:
                    target_name = "Bark_NormalTree"
                slot.material = canonical_materials[target_name]
        catalog_objects.append(join_variant(meshes, f"TreeVariant_{source_name.replace('Tree_', '_')}"))

    bpy.ops.object.select_all(action="DESELECT")
    for obj in catalog_objects:
        obj.select_set(True)
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(output),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_cameras=False,
        export_lights=False,
        export_animations=False,
    )
    print({
        "output": str(output),
        "variants": [obj.name for obj in catalog_objects],
        "materials": sorted({slot.material.name for obj in catalog_objects for slot in obj.material_slots if slot.material}),
    })


if __name__ == "__main__":
    main()
