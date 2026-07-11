"""Import a GLB, replace lit materials with Toon BSDFs, and save a Blender preview."""
import argparse
import pathlib
import sys

import bpy


parser = argparse.ArgumentParser()
parser.add_argument("--source", required=True)
parser.add_argument("--output", required=True)
args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(pathlib.Path(args.source).resolve()))

for material in bpy.data.materials:
    material.use_nodes = True
    base = tuple(material.diffuse_color[:3])
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    toon = nodes.new("ShaderNodeBsdfToon")
    toon.inputs["Color"].default_value = (*base, 1.0)
    toon.inputs["Size"].default_value = 0.62
    toon.inputs["Smooth"].default_value = 0.035
    links.new(toon.outputs["BSDF"], output.inputs["Surface"])

world = bpy.context.scene.world or bpy.data.worlds.new("Sherwood Preview")
bpy.context.scene.world = world
world.color = (0.035, 0.055, 0.04)
bpy.context.scene.render.engine = "BLENDER_EEVEE"
bpy.ops.wm.save_as_mainfile(filepath=str(pathlib.Path(args.output).resolve()))
print(f"Saved cel-shaded preview to {args.output}")
