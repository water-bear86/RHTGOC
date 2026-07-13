"""Report disconnected component bounds in the supplied Robin source mesh."""
import argparse
import pathlib
import sys

import bpy
import bmesh
from mathutils import Vector


parser = argparse.ArgumentParser()
parser.add_argument("--source", required=True)
args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
bpy.ops.wm.open_mainfile(filepath=str(pathlib.Path(args.source).resolve()))

for obj in [candidate for candidate in bpy.context.scene.objects if candidate.type == "MESH"]:
    mesh = bmesh.new()
    mesh.from_mesh(obj.data)
    unseen = set(mesh.verts)
    components = []
    while unseen:
        seed = unseen.pop()
        stack = [seed]
        vertices = [seed]
        while stack:
            current = stack.pop()
            for edge in current.link_edges:
                neighbor = edge.other_vert(current)
                if neighbor not in unseen:
                    continue
                unseen.remove(neighbor)
                stack.append(neighbor)
                vertices.append(neighbor)
        world = [obj.matrix_world @ vertex.co for vertex in vertices]
        minimum = Vector((min(point.x for point in world), min(point.y for point in world), min(point.z for point in world)))
        maximum = Vector((max(point.x for point in world), max(point.y for point in world), max(point.z for point in world)))
        components.append((len(vertices), minimum, maximum))
    mesh.free()
    components.sort(key=lambda item: item[0], reverse=True)
    print(f"OBJECT {obj.name} vertices={len(obj.data.vertices)} components={len(components)}")
    for index, (count, minimum, maximum) in enumerate(components[:40]):
        center = (minimum + maximum) / 2
        size = maximum - minimum
        print(
            f"COMPONENT {index:02d} vertices={count} "
            f"center=({center.x:.4f},{center.y:.4f},{center.z:.4f}) "
            f"size=({size.x:.4f},{size.y:.4f},{size.z:.4f})"
        )
