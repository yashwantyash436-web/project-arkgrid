from __future__ import annotations

import json
from pathlib import Path

from app.flood_risk import MODEL_PATH, train_demo_model


def main() -> None:
    model = train_demo_model()
    MODEL_PATH.write_text(json.dumps(model, indent=2) + "\n", encoding="utf-8")
    metrics = model["held_out_synthetic_metrics"]
    print(
        f"Wrote {MODEL_PATH}; version={model['model_version']}; "
        f"synthetic held-out precision={metrics['precision']:.3f}, "
        f"recall={metrics['recall']:.3f}, F1={metrics['f1']:.3f}."
    )
    print("These metrics measure only agreement with synthetic labels; they are not real-world validation.")


if __name__ == "__main__":
    main()
