from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

MODEL_VERSION = "arkgrid-flood-logistic-synthetic-v1"
MODEL_PATH = Path(__file__).with_name("flood_demo_model.json")
HORIZONS = (0, 1, 3, 6)


@dataclass(frozen=True)
class FloodInputs:
    rainfall_mm: float
    water_level_m: float
    river_level_m: float
    terrain_elevation_m: float
    water_level_trend_m_per_hour: float
    horizon_hours: Literal[0, 1, 3, 6]


def _features(
    rainfall_mm: float,
    water_level_m: float,
    river_level_m: float,
    elevation_m: float,
    trend_m_per_hour: float,
    horizon_hours: int,
) -> list[float]:
    forecast_water = max(0.0, water_level_m + trend_m_per_hour * horizon_hours)
    return [
        1.0,
        rainfall_mm / 200.0,
        forecast_water / 5.0,
        river_level_m / 8.0,
        max(0.0, elevation_m) / 20.0,
        horizon_hours / 6.0,
    ]


def _synthetic_examples() -> list[tuple[list[float], int]]:
    examples: list[tuple[list[float], int]] = []
    for rainfall in (0, 25, 50, 75, 100, 150, 200, 250):
        for water in (0, 1, 2, 4, 6):
            for river in (0, 2, 4, 6, 8):
                for elevation in (0.5, 2, 4, 8, 12, 20):
                    for horizon in HORIZONS:
                        load = (
                            0.7 * rainfall / 100
                            + 0.9 * water / 5
                            + 0.8 * river / 5
                            + 0.5 * horizon / 6
                            - 0.65 * elevation / 10
                        )
                        features = _features(rainfall, water, river, elevation, 0, horizon)
                        examples.append((features, int(load >= 1.1)))
    return examples


def train_demo_model() -> dict[str, Any]:
    """Fit a deterministic, class-weighted logistic model to synthetic labels."""
    examples = _synthetic_examples()
    train = [(x, y) for index, (x, y) in enumerate(examples) if index % 5 != 0]
    held_out = [(x, y) for index, (x, y) in enumerate(examples) if index % 5 == 0]
    positives = sum(y for _, y in train)
    negatives = len(train) - positives
    positive_weight = len(train) / (2 * positives)
    negative_weight = len(train) / (2 * negatives)
    weights = [0.0] * len(train[0][0])

    for _ in range(1800):
        gradients = [0.0] * len(weights)
        for features, label in train:
            score = _sigmoid(sum(weight * value for weight, value in zip(weights, features)))
            sample_weight = positive_weight if label else negative_weight
            for index, value in enumerate(features):
                gradients[index] += (score - label) * value * sample_weight
        for index, gradient in enumerate(gradients):
            weights[index] -= 0.08 * (gradient / len(train) + (0.002 * weights[index] if index else 0.0))

    counts = {"tp": 0, "fp": 0, "fn": 0}
    for features, label in held_out:
        predicted = _sigmoid(sum(weight * value for weight, value in zip(weights, features))) >= 0.5
        if predicted and label:
            counts["tp"] += 1
        elif predicted:
            counts["fp"] += 1
        elif label:
            counts["fn"] += 1
    precision = counts["tp"] / max(1, counts["tp"] + counts["fp"])
    recall = counts["tp"] / max(1, counts["tp"] + counts["fn"])
    f1 = 2 * precision * recall / max(1e-12, precision + recall)
    return {
        "model_version": MODEL_VERSION,
        "algorithm": "class-weighted logistic regression",
        "training_data": "Deterministic synthetic feature combinations and threshold-generated labels; not observed flood data.",
        "features": [
            "bias",
            "rainfall_mm / 200",
            "forecast_water_level_m / 5",
            "river_level_m / 8",
            "terrain_elevation_m / 20",
            "horizon_hours / 6",
        ],
        "synthetic_training_rows": len(train),
        "synthetic_held_out_rows": len(held_out),
        "held_out_synthetic_metrics": {"precision": precision, "recall": recall, "f1": f1},
        "weights": weights,
        "is_probability_calibrated": False,
    }


def load_model() -> dict[str, Any]:
    try:
        model = json.loads(MODEL_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError(f"Flood demonstration model artifact is unavailable: {error}") from error
    if model.get("model_version") != MODEL_VERSION or len(model.get("weights", [])) != 6:
        raise RuntimeError("Flood demonstration model artifact is invalid or incompatible.")
    return model


def _sigmoid(value: float) -> float:
    if value >= 0:
        return 1 / (1 + math.exp(-value))
    exponent = math.exp(value)
    return exponent / (1 + exponent)


def _risk_score(model: dict[str, Any], inputs: FloodInputs, elevation: float) -> float:
    features = _features(
        inputs.rainfall_mm,
        inputs.water_level_m,
        inputs.river_level_m,
        elevation,
        inputs.water_level_trend_m_per_hour,
        inputs.horizon_hours,
    )
    return _sigmoid(sum(weight * value for weight, value in zip(model["weights"], features)))


def run_demo_scenario(inputs: FloodInputs) -> dict[str, Any]:
    model = load_model()
    terrain_offsets = (
        (2.0, 5.0, 1.0, 6.0),
        (0.0, -3.0, -2.0, 3.0),
        (4.0, -4.0, -1.0, 7.0),
    )
    cells: list[dict[str, Any]] = []
    for row, offsets in enumerate(terrain_offsets):
        for column, offset in enumerate(offsets):
            elevation = max(0.0, inputs.terrain_elevation_m + offset)
            score = _risk_score(model, inputs, elevation)
            risk_class = "high" if score >= 0.7 else "moderate" if score >= 0.45 else "low"
            cells.append({
                "id": f"cell-{row}-{column}",
                "latitude": 26.75 - row * 0.035,
                "longitude": 87.20 + column * 0.045,
                "elevation_m": elevation,
                "risk_score": round(score, 4),
                "risk_class": risk_class,
            })

    timeline: list[dict[str, Any]] = []
    for hour in HORIZONS:
        future_inputs = FloodInputs(
            rainfall_mm=inputs.rainfall_mm,
            water_level_m=inputs.water_level_m,
            river_level_m=inputs.river_level_m,
            terrain_elevation_m=inputs.terrain_elevation_m,
            water_level_trend_m_per_hour=inputs.water_level_trend_m_per_hour,
            horizon_hours=hour,
        )
        scores = [_risk_score(model, future_inputs, cell["elevation_m"]) for cell in cells]
        timeline.append({
            "hour": hour,
            "high_risk_cells": sum(score >= 0.7 for score in scores),
            "moderate_or_high_cells": sum(score >= 0.45 for score in scores),
        })

    current_scores = {cell["id"]: cell["risk_score"] for cell in cells}
    routes = [
        {
            "id": "short-lowbank",
            "label": "Short east-bank demo road",
            "cell_ids": ["cell-1-1", "cell-1-2", "cell-1-3"],
            "geometry": [[26.735, 87.19], [26.735, 87.245], [26.735, 87.31], [26.735, 87.37]],
            "distance_km": 4.2,
        },
        {
            "id": "raised-detour",
            "label": "Raised-ground demo detour",
            "cell_ids": ["cell-0-0", "cell-0-1", "cell-0-2", "cell-0-3"],
            "geometry": [[26.79, 87.19], [26.79, 87.245], [26.79, 87.31], [26.79, 87.37]],
            "distance_km": 5.8,
        },
    ]
    for route in routes:
        exposures = [current_scores[cell_id] for cell_id in route["cell_ids"]]
        route["mean_exposure_score"] = round(sum(exposures) / len(exposures), 4)
        route["high_risk_segments"] = sum(score >= 0.7 for score in exposures)
        route["illustrative_route_score"] = round(
            route["mean_exposure_score"] + route["distance_km"] * 0.06,
            4,
        )
    routes.sort(key=lambda route: (route["high_risk_segments"] > 0, route["illustrative_route_score"]))
    no_candidate_avoids_high_risk = bool(routes) and all(
        route["high_risk_segments"] > 0 for route in routes
    )

    return {
        "scenario_id": "koshi-synthetic-demo",
        "data_mode": "DEMO SIMULATION",
        "risk_class": "high" if max(current_scores.values()) >= 0.7 else "moderate" if max(current_scores.values()) >= 0.45 else "low",
        "horizon_hours": inputs.horizon_hours,
        "inputs": {
            "rainfall_mm": inputs.rainfall_mm,
            "water_level_m": inputs.water_level_m,
            "river_level_m": inputs.river_level_m,
            "terrain_elevation_m": inputs.terrain_elevation_m,
            "water_level_trend_m_per_hour": inputs.water_level_trend_m_per_hour,
        },
        "cells": cells,
        "timeline": timeline,
        "routes": routes,
        "selected_route_id": routes[0]["id"] if routes else None,
        "route_warning": (
            "All synthetic route candidates intersect a higher-risk simulation cell; no candidate avoids the modeled hazard."
            if no_candidate_avoids_high_risk
            else None
        ),
        "model": {
            "version": model["model_version"],
            "algorithm": model["algorithm"],
            "score_kind": "uncalibrated synthetic-risk score; not a flood probability",
            "synthetic_training_rows": model["synthetic_training_rows"],
            "synthetic_held_out_rows": model["synthetic_held_out_rows"],
            "held_out_synthetic_metrics": model["held_out_synthetic_metrics"],
        },
        "source": "ArkGrid deterministic synthetic scenario; no live rainfall, gauge, elevation, or flood observations.",
        "limitations": [
            "Synthetic demonstration—not a validated real-world flood forecast.",
            "Cell elevations and the road graph are invented scenario fixtures, not surveyed terrain or operational roads.",
            "Route scores are illustrative hazard exposure only; no route is verified or guaranteed safe.",
        ],
    }
