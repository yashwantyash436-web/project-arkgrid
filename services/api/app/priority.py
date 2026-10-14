from __future__ import annotations

from datetime import UTC, datetime
from math import floor
from typing import Any


def calculate_priority(
    incident: dict[str, Any],
    *,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Calculate a deterministic, explainable 0–100 demo triage score."""
    current_time = now or datetime.now(UTC)
    created_at = datetime.fromisoformat(incident["created_at"].replace("Z", "+00:00"))
    age_hours = max(0.0, (current_time - created_at).total_seconds() / 3600)

    factors = [
        {
            "key": "immediate_life_threat",
            "points": 25 if incident.get("immediate_life_threat") else 0,
            "explanation": "Immediate threat to life reported." if incident.get("immediate_life_threat") else "No immediate threat to life reported.",
        },
    ]
    severity_points = {"Critical": 25, "High": 16, "Moderate": 8}
    severity = incident.get("severity")
    factors.append({
        "key": "reported_severity",
        "points": severity_points.get(severity, 0),
        "explanation": f"Reported severity: {severity or 'unknown'}.",
    })

    people = incident.get("people_affected")
    people_points = min(12, people) if isinstance(people, int) and people > 0 else 0
    factors.append({
        "key": "people_affected",
        "points": people_points,
        "explanation": f"{people} people reported." if people is not None else "Number of people is unknown.",
    })

    medical_urgency = incident.get("medical_urgency")
    factors.append({
        "key": "medical_urgency",
        "points": 15 if medical_urgency else 0,
        "explanation": "Urgent medical need reported." if medical_urgency else "No urgent medical need reported.",
    })

    recency_points = max(0, 10 - floor(age_hours / 6))
    factors.append({
        "key": "report_recency",
        "points": recency_points,
        "explanation": f"Report is {age_hours:.1f} hours old; recency decays by one point every six hours.",
    })

    location_points = {"high": 10, "medium": 6, "low": 3}.get(incident.get("location_confidence"), 0)
    factors.append({
        "key": "location_confidence",
        "points": location_points,
        "explanation": f"Location confidence: {incident.get('location_confidence') or 'unknown'}.",
    })

    missing_information: list[str] = []
    if medical_urgency is None:
        missing_information.append("medical urgency")
    if incident.get("immediate_life_threat") is None:
        missing_information.append("immediate threat assessment")
    if people is None:
        missing_information.append("people affected")
    if incident.get("latitude") is None or incident.get("longitude") is None:
        if not incident.get("manual_location"):
            missing_information.append("location")
    if incident.get("location_confidence") in (None, "unknown"):
        missing_information.append("location confidence")
    penalty = min(15, len(missing_information) * 3)
    factors.append({
        "key": "missing_information",
        "points": -penalty,
        "explanation": (
            f"{len(missing_information)} information item(s) unknown; {penalty} point(s) deducted."
            if missing_information
            else "No configured key information is missing."
        ),
    })

    score = max(0, min(100, sum(factor["points"] for factor in factors)))
    band = "immediate" if score >= 75 else "high" if score >= 50 else "elevated" if score >= 25 else "routine"
    uncertainty = [
        f"Missing {field}." for field in missing_information
    ]
    if incident.get("data_class") == "simulation":
        uncertainty.append("This is a demonstration record, not a verified emergency.")
    elif incident.get("data_class") == "citizen_report":
        uncertainty.append("This is an unverified citizen-submitted report, not an independently confirmed emergency.")
    return {
        "score": score,
        "band": band,
        "factors": factors,
        "uncertainty": uncertainty,
        "explanation": (
            f"{band.title()} review band, calculated from the listed rule factors. "
            "This score is a triage aid only and must not determine real-world rescue decisions."
        ),
        "method": "arkgrid-rules-v1",
    }
