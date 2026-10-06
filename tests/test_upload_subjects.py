"""python3 -m unittest discover tests"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
from upload_subjects import build_metadata, read_rows  # noqa: E402


class BuildMetadataTest(unittest.TestCase):
    def test_maps_ai_columns_and_keeps_extra_columns(self):
        metadata = build_metadata(
            {"image": "a.jpg", "saliency": "", "label": "spiral", "confidence": "0.9",
             "probabilities": '{"spiral": 0.9}', "features": "", "object_id": "X1"},
            has_saliency=True,
        )
        self.assertEqual(metadata, {
            "#ai_label": "spiral",
            "#ai_confidence": "0.9",
            "#ai_probabilities": '{"spiral": 0.9}',
            "#ai_saliency": "1",
            "object_id": "X1",
        })

    def test_rejects_bad_rows(self):
        with self.assertRaisesRegex(ValueError, "missing label"):
            build_metadata({"label": " "}, has_saliency=False)
        with self.assertRaisesRegex(ValueError, "not valid JSON"):
            build_metadata({"label": "a", "features": "[oops"}, has_saliency=False)
        with self.assertRaisesRegex(ValueError, "not a number"):
            build_metadata({"label": "a", "confidence": "high"}, has_saliency=False)

    def test_example_csv_is_valid(self):
        rows = read_rows(Path(__file__).resolve().parent.parent / "scripts" / "example_predictions.csv")
        self.assertEqual(len(rows), 3)
        self.assertIsNotNone(rows[0][1])
        self.assertIsNone(rows[2][1])


if __name__ == "__main__":
    unittest.main()
