"""Build a grounded, textured nature-dressing catalog from the CC0 MegaKit.

Run with Blender 5.1 or newer:

    blender --background --factory-startup \
      --python tools/build-stylized-nature-dressing.py -- \
      "/path/to/Stylized Nature MegaKit[Standard]/glTF" \
      public/assets/environment/sherwood-nature-dressing.glb
"""

from pathlib import Path
import re
import sys

import bpy
from mathutils import Matrix, Vector


VARIANTS = (
    ("Grass_Wispy_Short", "Nature_Grass_Wispy_Short", None),
    ("Grass_Common_Tall", "Nature_Grass_Common_Tall", None),
    ("Grass_Common_Tall", "Nature_Wheat_Tall", (0.95, 0.64, 0.2, 1.0)),
    ("Fern_1", "Nature_Fern_1", None),
    ("Bush_Common", "Nature_Bush_Common", None),
    ("Flower_3_Group", "Nature_Flower_3_Group", None),
    ("Mushroom_Common", "Nature_Mushroom_Common", None),
    ("Rock_Medium_2", "Nature_Rock_Medium_2", None),
    ("Pebble_Round_3", "Nature_Pebble_Round_3", None),
)


def normalized_material_name(name: str) -> str:
    return re.sub(r"\.\d{3}$", "", name)


def world_bounds(objects: list[bpy.types.Object]) -> tuple[Vector, Vector]:
    points = [obj.matrix_world @ Vector(corner) for obj in objects for corner in obj.bound_box]
    return (
        Vector(tuple(min(point[axis] for point in points) for axis in range(3))),
        Vector(tuple(max(point[axis] for point in points) for axis in range(3))),
    )


def tint_material(material: bpy.types.Material, tint: tuple[float, float, float, float]) -> bpy.types.Material:
    tinted = material.copy()
    tinted.name = "Nature_Wheat"
    tinted.diffuse_color = tint
    tinted.use_nodes = True
    principled = next((node for node in tinted.node_tree.nodes if node.type == "BSDF_PRINCIPLED"), None)
    if principled is None:
        raise RuntimeError(f"Material has no Principled BSDF: {material.name}")
    base_color = principled.inputs.get("Base Color")
    if base_color is None:
        raise RuntimeError(f"Material has no Base Color input: {material.name}")
    base_color.default_value = tint
    if base_color.is_linked:
        source = base_color.links[0].from_socket
        tinted.node_tree.links.remove(base_color.links[0])
        multiply = tinted.node_tree.nodes.new("ShaderNodeMixRGB")
        multiply.name = "SherwoodWheatTint"
        multiply.blend_type = "MULTIPLY"
        multiply.inputs[0].default_value = 1.0
        multiply.inputs[2].default_value = tint
        tinted.node_tree.links.new(source, multiply.inputs[1])
        tinted.node_tree.links.new(multiply.outputs[0], base_color)
    return tinted


def main() -> None:
    source_dir_arg, destination_arg = sys.argv[sys.argv.index("--") + 1 :]
    source_dir = Path(source_dir_arg).expanduser().resolve()
    destination = Path(destination_arg).expanduser().resolve()

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)

    catalog_objects: list[bpy.types.Object] = []
    canonical_materials: dict[str, bpy.types.Material] = {}

    for source_name, runtime_name, tint in VARIANTS:
        source = source_dir / f"{source_name}.gltf"
        if not source.is_file():
            raise FileNotFoundError(f"Missing source nature model: {source}")

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
            raise RuntimeError(f"Nature model has invalid height: {source}")
        center = Vector(((minimum.x + maximum.x) / 2, (minimum.y + maximum.y) / 2, minimum.z))
        normalize = Matrix.Scale(1 / height, 4) @ Matrix.Translation(-center)

        for obj in imported_meshes:
            obj.data.transform(normalize @ obj.matrix_world)
            obj.matrix_world = Matrix.Identity(4)
            for slot in obj.material_slots:
                if slot.material is None:
                    continue
                if tint is not None:
                    slot.material = tint_material(slot.material, tint)
                    continue
                name = normalized_material_name(slot.material.name)
                canonical = canonical_materials.get(name)
                if canonical is None:
                    canonical = slot.material
                    canonical.name = name
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

    for image in bpy.data.images:
        if image.source == "FILE" and max(image.size) > 512:
            scale = 512 / max(image.size)
            image.scale(max(1, round(image.size[0] * scale)), max(1, round(image.size[1] * scale)))

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
        export_image_format="WEBP",
        export_image_add_webp=True,
        export_image_webp_fallback=False,
    )

    print({
        "output": str(destination),
        "variants": [obj.name for obj in catalog_objects],
        "materials": sorted(material.name for material in bpy.data.materials if material.users > 0),
        "images": sorted(image.name for image in bpy.data.images if image.users > 0),
    })


if __name__ == "__main__":
    main()
