"""Build a normalized tree-variant catalog from the Quaternius nature pack.

Run with Blender so the source glTF materials and alpha-tested foliage survive:

    blender --background --factory-startup --python tools/build-stylized-tree-catalog.py \
      -- <source glTF directory> <output GLB>
"""

from pathlib import Path
import re
import sys

import bpy
from mathutils import Matrix, Vector


VARIANTS = (
    ("CommonTree_1", "TreeVariant_Common_1"),
    ("CommonTree_2", "TreeVariant_Common_2"),
    ("CommonTree_3", "TreeVariant_Common_3"),
    ("CommonTree_4", "TreeVariant_Common_4"),
    ("CommonTree_5", "TreeVariant_Common_5"),
    ("Pine_2", "TreeVariant_Pine_2"),
    ("Pine_5", "TreeVariant_Pine_5"),
    ("DeadTree_3", "TreeVariant_Dead_3"),
)


def normalized_material_name(name: str) -> str:
    return re.sub(r"\.\d{3}$", "", name)


def world_bounds(objects: list[bpy.types.Object]) -> tuple[Vector, Vector]:
    points = [obj.matrix_world @ Vector(corner) for obj in objects for corner in obj.bound_box]
    return (
        Vector(tuple(min(point[axis] for point in points) for axis in range(3))),
        Vector(tuple(max(point[axis] for point in points) for axis in range(3))),
    )


def main() -> None:
    source_dir_arg, destination_arg = sys.argv[sys.argv.index("--") + 1 :]
    source_dir = Path(source_dir_arg).expanduser().resolve()
    destination = Path(destination_arg).expanduser().resolve()

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)

    catalog_objects: list[bpy.types.Object] = []
    canonical_materials: dict[str, bpy.types.Material] = {}

    for source_name, runtime_name in VARIANTS:
        source = source_dir / f"{source_name}.gltf"
        if not source.is_file():
            raise FileNotFoundError(f"Missing source tree: {source}")

        before = set(bpy.context.scene.objects)
        bpy.ops.import_scene.gltf(filepath=str(source))
        imported_meshes = [
            obj for obj in bpy.context.scene.objects if obj not in before and obj.type == "MESH"
        ]
        if not imported_meshes:
            raise RuntimeError(f"No mesh imported from {source}")

        minimum, maximum = world_bounds(imported_meshes)
        height = maximum.z - minimum.z
        if height <= 0:
            raise RuntimeError(f"Tree has invalid height: {source}")
        center = Vector(((minimum.x + maximum.x) / 2, (minimum.y + maximum.y) / 2, minimum.z))
        normalize = Matrix.Scale(1 / height, 4) @ Matrix.Translation(-center)

        for obj in imported_meshes:
            obj.data.transform(normalize @ obj.matrix_world)
            obj.matrix_world = Matrix.Identity(4)
            for slot in obj.material_slots:
                if slot.material is None:
                    continue
                name = normalized_material_name(slot.material.name)
                canonical = canonical_materials.get(name)
                if canonical is None:
                    canonical = slot.material
                    canonical.name = name
                    canonical.diffuse_color[3] = 1.0
                    canonical.metallic = 0.0
                    canonical.roughness = 0.92
                    canonical_materials[name] = canonical
                slot.material = canonical

        bpy.ops.object.select_all(action="DESELECT")
        for obj in imported_meshes:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = imported_meshes[0]
        if len(imported_meshes) > 1:
            bpy.ops.object.join()
        variant = bpy.context.active_object
        variant.name = runtime_name
        variant.data.name = f"{runtime_name}_Geometry"
        catalog_objects.append(variant)

    bpy.ops.object.select_all(action="DESELECT")
    for obj in catalog_objects:
        obj.select_set(True)

    destination.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(destination),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_cameras=False,
        export_lights=False,
        export_animations=False,
    )

    print(
        {
            "output": str(destination),
            "variants": [obj.name for obj in catalog_objects],
            "materials": sorted(canonical_materials),
        }
    )


if __name__ == "__main__":
    main()
