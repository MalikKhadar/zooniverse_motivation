"""Upload subjects with AI predictions and explanations to a Zooniverse project.

Reads a CSV with one row per subject and creates a subject set whose subject
metadata holds the model output in the format Second Look expects (see the
README, "Subject metadata"). The saliency map, if given, is uploaded as the
subject's second image so Zooniverse hosts it alongside the subject.

    pip install -r scripts/requirements.txt
    python3 scripts/upload_subjects.py predictions.csv --project 12345 \\
        --workflow 67890 --set-name "Model v1 predictions"

Check a CSV without uploading anything:

    python3 scripts/upload_subjects.py scripts/example_predictions.csv --dry-run

Credentials come from PANOPTES_USERNAME / PANOPTES_PASSWORD, or a prompt.

CSV columns (only `image` and `label` are required):
    image          path to the subject image
    label          the model's predicted class
    confidence     0-1 or 0-100
    saliency       path to a saliency/heatmap image (same size as the image,
                   transparent PNG recommended)
    probabilities  JSON object, e.g. {"spiral": 0.9, "elliptical": 0.1}
    features       JSON list, e.g. [{"name": "Arms", "value": 0.6}]
    examples       JSON list of {"url": ..., "label": ..., "caption": ...}
    rationale      free text
    model          model name/version
Any other column is copied into the subject metadata unchanged.
"""
import argparse
import csv
import getpass
import json
import os
import sys
from pathlib import Path

AI_COLUMNS = ("label", "confidence", "probabilities", "features", "examples", "rationale", "model")
JSON_COLUMNS = ("probabilities", "features", "examples")
PREFIX = "#ai_"


def build_metadata(row, has_saliency):
    """Map a CSV row to subject metadata. Raises ValueError on bad input."""
    if not (row.get("label") or "").strip():
        raise ValueError("missing label")

    metadata = {}
    for column in AI_COLUMNS:
        value = (row.get(column) or "").strip()
        if not value:
            continue
        if column in JSON_COLUMNS:
            try:
                json.loads(value)
            except json.JSONDecodeError as err:
                raise ValueError(f"{column} is not valid JSON: {err}") from err
        if column == "confidence":
            try:
                float(value.rstrip("%"))
            except ValueError as err:
                raise ValueError(f"confidence is not a number: {value!r}") from err
        metadata[PREFIX + column] = value

    if has_saliency:
        # Index into subject.locations: 0 is the image, 1 the saliency map.
        metadata[PREFIX + "saliency"] = "1"

    reserved = set(AI_COLUMNS) | {"image", "saliency"}
    for column, value in row.items():
        if column not in reserved and value not in (None, ""):
            metadata[column] = value
    return metadata


def read_rows(csv_path):
    base = csv_path.parent
    rows = []
    with open(csv_path, newline="", encoding="utf-8") as handle:
        for line, row in enumerate(csv.DictReader(handle), start=2):
            try:
                image = base / (row.get("image") or "").strip()
                if not image.is_file():
                    raise ValueError(f"image not found: {image}")
                saliency = (row.get("saliency") or "").strip()
                saliency = base / saliency if saliency else None
                if saliency and not saliency.is_file():
                    raise ValueError(f"saliency image not found: {saliency}")
                rows.append((image, saliency, build_metadata(row, saliency is not None)))
            except ValueError as err:
                raise SystemExit(f"{csv_path}:{line}: {err}")
    return rows


def upload(rows, args):
    from panoptes_client import Panoptes, Project, Subject, SubjectSet, Workflow

    username = os.environ.get("PANOPTES_USERNAME") or input("Zooniverse username: ")
    password = os.environ.get("PANOPTES_PASSWORD") or getpass.getpass("Zooniverse password: ")
    endpoint = "https://panoptes-staging.zooniverse.org" if args.staging else "https://www.zooniverse.org"
    Panoptes.connect(username=username, password=password, endpoint=endpoint)

    project = Project.find(args.project)
    subject_set = SubjectSet()
    subject_set.links.project = project
    subject_set.display_name = args.set_name
    subject_set.save()
    print(f"Created subject set {subject_set.id} ({args.set_name})")

    subjects = []
    for image, saliency, metadata in rows:
        subject = Subject()
        subject.links.project = project
        subject.add_location(str(image))
        if saliency:
            subject.add_location(str(saliency))
        subject.metadata.update(metadata)
        subject.save()
        subjects.append(subject)
        print(f"  subject {subject.id}: {image.name} -> {metadata[PREFIX + 'label']}")

    subject_set.add(subjects)
    if args.workflow:
        Workflow.find(args.workflow).add_subject_sets([subject_set])
        print(f"Linked subject set {subject_set.id} to workflow {args.workflow}")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("csv", type=Path)
    parser.add_argument("--project", help="Zooniverse project ID")
    parser.add_argument("--workflow", help="workflow to link the new subject set to")
    parser.add_argument("--set-name", default="AI predictions")
    parser.add_argument("--staging", action="store_true", help="use the Panoptes staging server")
    parser.add_argument("--dry-run", action="store_true", help="validate the CSV and print metadata only")
    args = parser.parse_args(argv)

    rows = read_rows(args.csv)
    if args.dry_run:
        for image, saliency, metadata in rows:
            locations = [image.name] + ([saliency.name] if saliency else [])
            print(json.dumps({"locations": locations, "metadata": metadata}, indent=2))
        print(f"{len(rows)} subjects OK", file=sys.stderr)
        return
    if not args.project:
        parser.error("--project is required unless --dry-run is given")
    upload(rows, args)


if __name__ == "__main__":
    main()
