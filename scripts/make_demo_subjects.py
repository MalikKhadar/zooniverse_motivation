"""Build the demo subjects from a folder of example cutouts.

Each image is named <class><number>.jpg (e.g. ring3.jpg). The script copies
the images into demo/morphology/, invents an AI prediction for each one, draws
a saliency map, and writes src/demo-data.js.

The predictions and saliency maps are made up. They only exist so the
interface can be tried before a real model is available. Some predictions are
deliberately wrong so that rejecting the AI is a sensible choice.

    python3 scripts/make_demo_subjects.py path/to/malik_demo
"""
import argparse
import json
import random
import re
import shutil
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
OUT_IMAGES = ROOT / "demo" / "morphology"
OUT_JS = ROOT / "src" / "demo-data.js"
MODEL = "demo-tidal-cnn (fake predictions)"

CLASSES = ["longtail", "onearm", "twoarm", "ring", "shell", "stream"]

# The feature each class leans on, used for the attribution bars.
FEATURES = {
    "longtail": "Long tail extending away",
    "onearm": "Single curved arm",
    "twoarm": "Arms on opposite sides",
    "ring": "Closed loop around the galaxy",
    "shell": "Sharp-edged arcs (shells)",
    "stream": "Narrow band of light",
}

RATIONALE = {
    "longtail": "The model found a single long, faint tail of light reaching well away from the galaxy.",
    "onearm": "The model found one curved arm of light wrapping partway around the galaxy.",
    "twoarm": "The model found curved features on opposite sides of the galaxy.",
    "ring": "The model found faint light forming a loop that encircles the galaxy.",
    "shell": "The model found sharp-edged arcs of faint light on the galaxy's outskirts, like nested shells.",
    "stream": "The model found a narrow band of light running alongside or away from the galaxy.",
}

# Wrong guesses are drawn from the class the model most plausibly confuses.
CONFUSED_WITH = {
    "longtail": "onearm",
    "onearm": "longtail",
    "twoarm": "onearm",
    "ring": "shell",
    "shell": "ring",
    "stream": "longtail",
}

# Which demo images get a wrong AI answer.
WRONG = {"longtail3", "onearm2", "ring4", "shell2", "stream2"}

NAME = re.compile(r"^([a-z]+?)(\d+)\.jpe?g$", re.IGNORECASE)


def blur(array, radius):
    image = Image.fromarray(np.uint8(np.clip(array, 0, 1) * 255))
    return np.asarray(image.filter(ImageFilter.GaussianBlur(radius)), dtype=float) / 255


def saliency(path, focus_on_core):
    """A plausible-looking attention map: faint outer structure, or the core."""
    gray = np.asarray(Image.open(path).convert("L"), dtype=float) / 255
    h, w = gray.shape
    yy, xx = np.mgrid[0:h, 0:w]
    # Cutouts are centred on the target, so look for its core near the middle
    # rather than at a bright foreground star.
    centred = np.exp(-(np.hypot(yy - h / 2, xx - w / 2) / (0.2 * max(h, w))) ** 2)
    cy, cx = np.unravel_index(np.argmax(blur(gray, max(h, w) / 30) * centred), gray.shape)
    r = np.hypot(yy - cy, xx - cx) / max(h, w)

    if focus_on_core:
        weights = np.exp(-(r / 0.12) ** 2) * blur(gray, 2)
    else:
        stretched = np.log1p(30 * gray) / np.log1p(30)
        structure = np.clip(blur(stretched, 1.5) - blur(stretched, max(h, w) / 12), 0, None)
        weights = structure * np.clip((r - 0.08) / 0.1, 0, 1) * np.exp(-(r / 0.45) ** 2)
        weights = blur(weights / max(weights.max(), 1e-6), max(h, w) / 40)

    w_norm = np.clip(weights / max(weights.max(), 1e-6), 0, 1)
    rgba = np.stack([
        np.clip(1.5 * w_norm, 0, 1),
        np.clip(1.5 * w_norm - 0.5, 0, 1),
        np.clip(0.6 - np.abs(w_norm - 0.3) * 2, 0, 1) * 0.6,
        np.clip(w_norm * 1.1, 0, 1) ** 0.8,
    ], axis=-1)
    return Image.fromarray(np.uint8(rgba * 255), mode="RGBA")


def probabilities(label, runner_up, confidence, rng):
    rest = [c for c in CLASSES if c not in (label, runner_up)]
    second = round((1 - confidence) * rng.uniform(0.55, 0.8), 2)
    remaining = 1 - confidence - second
    shares = np.array([rng.random() for _ in rest])
    shares = shares / shares.sum() * remaining
    probs = {label: confidence, runner_up: second}
    probs.update({c: round(float(s), 2) for c, s in zip(rest, shares)})
    return dict(sorted(probs.items(), key=lambda kv: -kv[1]))


def features(label, runner_up, wrong, rng):
    items = [{"name": FEATURES[label], "value": round(rng.uniform(0.35, 0.6), 2)}]
    if wrong:
        # The evidence for the true class pulls against the model's answer.
        items.append({"name": FEATURES[runner_up], "value": -round(rng.uniform(0.2, 0.4), 2)})
        items.append({"name": "Bright central core", "value": round(rng.uniform(0.15, 0.3), 2)})
    else:
        items.append({"name": FEATURES[runner_up], "value": -round(rng.uniform(0.05, 0.2), 2)})
    other = rng.choice([c for c in CLASSES if c not in (label, runner_up)])
    items.append({"name": FEATURES[other], "value": round(rng.uniform(-0.1, 0.1), 2)})
    return items


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("source", type=Path, help="folder of <class><number>.jpg images")
    args = parser.parse_args(argv)

    images = {}
    for path in sorted(args.source.iterdir()):
        match = NAME.match(path.name)
        if match and match.group(1).lower() in CLASSES:
            images[path.stem.lower()] = (path, match.group(1).lower())

    if OUT_IMAGES.exists():
        shutil.rmtree(OUT_IMAGES)
    OUT_IMAGES.mkdir(parents=True)

    rng = random.Random(7)
    by_class = {c: [stem for stem, (_, cls) in images.items() if cls == c] for c in CLASSES}
    subjects = []
    for stem, (path, true_class) in images.items():
        wrong = stem in WRONG
        label = CONFUSED_WITH[true_class] if wrong else true_class
        runner_up = true_class if wrong else CONFUSED_WITH[true_class]
        confidence = round(rng.uniform(0.42, 0.6) if wrong else rng.uniform(0.62, 0.94), 2)

        shutil.copyfile(path, OUT_IMAGES / f"{stem}.jpg")
        saliency(path, focus_on_core=wrong).save(OUT_IMAGES / f"{stem}-saliency.png", optimize=True)

        same = [s for s in by_class[label] if s != stem][:2]
        other = [s for s in by_class[runner_up] if s != stem][:1]
        examples = [{"url": f"demo/morphology/{s}.jpg", "label": label, "caption": "Training example"} for s in same]
        examples += [{"url": f"demo/morphology/{s}.jpg", "label": runner_up, "caption": "Training example"} for s in other]

        rationale = RATIONALE[label]
        if wrong:
            rationale += " It was not very sure, and leaned heavily on the bright core of the galaxy."

        subjects.append({
            "id": f"demo-{stem}",
            "locations": [
                {"image/jpeg": f"demo/morphology/{stem}.jpg"},
                {"image/png": f"demo/morphology/{stem}-saliency.png"},
            ],
            "metadata": {
                "#ai_label": label,
                "#ai_confidence": str(confidence),
                "#ai_probabilities": json.dumps(probabilities(label, runner_up, confidence, rng)),
                "#ai_saliency": "1",
                "#ai_features": json.dumps(features(label, runner_up, wrong, rng)),
                "#ai_examples": json.dumps(examples),
                "#ai_rationale": rationale,
                "#ai_model": MODEL,
                "#demo_true_label": true_class,
            },
        })

    rng.shuffle(subjects)
    OUT_JS.write_text(
        "// Generated by scripts/make_demo_subjects.py. Do not edit by hand.\n"
        "// The AI predictions are made up for the demo.\n"
        f"export const DEMO_SUBJECTS = {json.dumps(subjects, indent=2)};\n",
        encoding="utf-8",
    )
    wrong_count = sum(s["id"].removeprefix("demo-") in WRONG for s in subjects)
    print(f"{len(subjects)} subjects ({wrong_count} with a wrong AI answer) -> {OUT_JS.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
