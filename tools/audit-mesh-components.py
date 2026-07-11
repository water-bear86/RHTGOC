"""Print connected mesh islands with bounds for authored-asset auditing."""
import bpy
from mathutils import Vector

for obj in [item for item in bpy.context.scene.objects if item.type == "MESH"]:
    adjacency = [set() for _ in obj.data.vertices]
    for edge in obj.data.edges:
        left, right = edge.vertices
        adjacency[left].add(right)
        adjacency[right].add(left)
    unseen = set(range(len(obj.data.vertices)))
    islands = []
    while unseen:
        seed = unseen.pop()
        stack = [seed]
        component = [seed]
        while stack:
            current = stack.pop()
            for neighbor in adjacency[current]:
                if neighbor not in unseen:
                    continue
                unseen.remove(neighbor)
                stack.append(neighbor)
                component.append(neighbor)
        points = [obj.matrix_world @ obj.data.vertices[index].co for index in component]
        minimum = Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
        maximum = Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
        islands.append((len(component), tuple(round(value, 4) for value in (maximum - minimum)), tuple(round(value, 4) for value in ((maximum + minimum) / 2))))
    print("COMPONENTS", obj.name, len(islands))
    for index, result in enumerate(sorted(islands, reverse=True)[:40]):
        print(index, "vertices", result[0], "dimensions", result[1], "center", result[2])
