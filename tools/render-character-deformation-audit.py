"""Render repeatable extreme-pose evidence for a rigged Sherwood character."""
import argparse
import pathlib
import subprocess


parser = argparse.ArgumentParser()
parser.add_argument("--source", required=True, help="Rigged Blender file to audit")
parser.add_argument("--output-dir", required=True)
parser.add_argument("--clip-prefix", required=True)
parser.add_argument(
    "--blender",
    default="/Applications/Blender.app/Contents/MacOS/Blender",
)
args = parser.parse_args()

root = pathlib.Path(__file__).resolve().parent
preview_script = root / "render-character-source-preview.py"
source = pathlib.Path(args.source).resolve()
output_dir = pathlib.Path(args.output_dir).resolve()
output_dir.mkdir(parents=True, exist_ok=True)

poses = (
    ("idle-a", f"{args.clip_prefix}_Idle", 1),
    ("idle-b", f"{args.clip_prefix}_Idle", 24),
    ("walk-left", f"{args.clip_prefix}_Walk", 1),
    ("walk-right", f"{args.clip_prefix}_Walk", 13),
    ("attack-windup", f"{args.clip_prefix}_Attack", 10),
    ("attack-release", f"{args.clip_prefix}_Attack", 18),
)

for label, animation, frame in poses:
    output = output_dir / f"{label}.png"
    subprocess.run(
        [
            args.blender,
            "--background",
            "--python",
            str(preview_script),
            "--",
            "--source",
            str(source),
            "--output",
            str(output),
            "--animation",
            animation,
            "--frame",
            str(frame),
        ],
        check=True,
    )
    print(f"AUDIT {label}={output}")
