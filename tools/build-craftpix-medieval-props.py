"""Build a curated CraftPix medieval prop catalog with Blender."""
import argparse, contextlib, pathlib, sys, tempfile, zipfile
import bpy
from mathutils import Vector

SELECTION = {
    "Barrel": ("Fbx/Barrel.fbx", 1.0), "Bench": ("Fbx/Bench.fbx", .9),
    "Box": ("Fbx/Box.fbx", .7), "Bucket": ("Fbx/Bucket.fbx", .5),
    "Chest": ("Fbx/Chest.fbx", .8), "Firewood": ("Fbx/Firewood.fbx", .45),
    "Haystack": ("Fbx/Haystack_01.fbx", 1.2), "Pot": ("Fbx/Pot_01.fbx", .4),
    "Signpost": ("Fbx/Signpost_01.fbx", 2.2), "Well": ("Fbx/Well.fbx", 1.5),
}

def arguments():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--output", required=True)
    return parser.parse_args(sys.argv[sys.argv.index("--") + 1:])

def bounds(objects):
    points = [obj.matrix_world @ Vector(corner) for obj in objects for corner in obj.bound_box]
    return min(p.x for p in points), max(p.x for p in points), min(p.y for p in points), max(p.y for p in points), min(p.z for p in points), max(p.z for p in points)

args = arguments()
output = pathlib.Path(args.output).resolve()
output.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
with contextlib.ExitStack() as stack:
    source = pathlib.Path(args.source).expanduser().resolve()
    if source.is_dir():
        extracted = source
    else:
        temporary = stack.enter_context(tempfile.TemporaryDirectory(prefix="sherwood-props-"))
        extracted = pathlib.Path(temporary)
        with zipfile.ZipFile(source) as archive:
            for member, _ in SELECTION.values(): archive.extract(member, extracted)
            archive.extract("Textures/T_Medieval_ Props.png", extracted)
    atlas = bpy.data.images.load(str(extracted / "Textures/T_Medieval_ Props.png"), check_existing=True)
    atlas.name = "CraftPix_Medieval_Props_Atlas"
    material = bpy.data.materials.new("CraftPix_Medieval_Props")
    material.use_nodes = True
    material.metallic = 0
    material.roughness = .9
    principled = material.node_tree.nodes.get("Principled BSDF")
    texture = material.node_tree.nodes.new("ShaderNodeTexImage")
    texture.name = "CraftPixAtlas"
    texture.image = atlas
    texture.interpolation = "Closest"
    material.node_tree.links.new(texture.outputs["Color"], principled.inputs["Base Color"])
    for name, (member, target_height) in SELECTION.items():
        before = set(bpy.data.objects)
        bpy.ops.import_scene.fbx(filepath=str(extracted / member), use_image_search=True)
        imported = [obj for obj in bpy.data.objects if obj not in before and obj.type == "MESH"]
        if not imported: raise RuntimeError(f"No mesh imported for {name}")
        bpy.ops.object.select_all(action="DESELECT")
        for obj in imported: obj.select_set(True)
        bpy.context.view_layer.objects.active = imported[0]
        if len(imported) > 1:
            bpy.ops.object.join()
            imported = [bpy.context.active_object]
        obj = imported[0]
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        _, _, _, _, low, high = bounds(imported)
        scale = target_height / max(high - low, .0001)
        obj.scale = (scale, scale, scale)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        low_x, high_x, low_y, high_y, low_z, _ = bounds([obj])
        obj.location.x -= (low_x + high_x) / 2
        obj.location.y -= (low_y + high_y) / 2
        obj.location.z -= low_z
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        obj.data.materials.clear()
        obj.data.materials.append(material)
        obj.name = f"Prop_{name}"
        obj.data.name = f"Prop_{name}_Mesh"
        obj["sherwoodAssetId"] = f"prop.craftpix.{name.lower()}"
bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(filepath=str(output), export_format="GLB", export_yup=True, export_apply=True, export_extras=True, export_materials="EXPORT", export_image_format="WEBP", export_image_add_webp=True, export_image_webp_fallback=False)
print(f"Built {output} with {len(SELECTION)} curated props")
