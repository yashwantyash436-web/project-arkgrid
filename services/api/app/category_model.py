from __future__ import annotations

import math
import re
from collections import Counter, defaultdict

CATEGORY_EXAMPLES = {
    "Medical assistance": (
        "injured person needs a doctor and urgent medical care",
        "someone is bleeding and needs first aid",
        "we need medicine insulin and medical supplies",
        "a sick person is having trouble breathing",
        "people are hurt and need an ambulance",
        "urgent health problem please send medical help",
    ),
    "Rescue": (
        "we are trapped inside a collapsed building",
        "people are stuck on a roof surrounded by flood water",
        "someone is missing and needs to be rescued",
        "we are stranded and cannot get out safely",
        "please rescue people trapped under rubble",
        "a family is stuck upstairs and needs help getting out",
    ),
    "Evacuation": (
        "flood water is rising and we need to evacuate",
        "help us leave this unsafe area",
        "people need transport to evacuate",
        "we must move to a safer place immediately",
        "the road is flooding and residents need evacuation",
        "please help everyone escape the dangerous area",
    ),
    "Shelter": (
        "our house is damaged and we need temporary shelter",
        "we need a safe place to stay tonight",
        "families need emergency accommodation",
        "please provide tents and shelter for displaced people",
        "we have nowhere to sleep after the disaster",
        "a safe shelter is needed for these residents",
    ),
    "Food or water": (
        "we need clean drinking water",
        "families are hungry and need food supplies",
        "please bring bottled water and meals",
        "there is no food or safe water here",
        "people need drinking water and basic supplies",
        "urgent food assistance is needed",
    ),
    "Other": (
        "the bridge and road are damaged",
        "power lines are down and the electricity is out",
        "there is debris blocking the road",
        "report damage to public infrastructure",
        "we need information about the situation",
        "a communication tower is damaged",
    ),
}

_TOKEN_PATTERN = re.compile(r"[a-z0-9]+")


def _tokenize(text: str) -> list[str]:
    return _TOKEN_PATTERN.findall(text.lower())


def suggest_category(text: str) -> dict[str, str | float | None]:
    """Train a small multinomial Naive Bayes model on demo examples and predict a category."""
    tokens = _tokenize(text)
    if not tokens:
        return {"category": None, "score": 0.0, "model": "demo_multinomial_naive_bayes"}

    vocabulary: set[str] = set()
    word_counts: dict[str, Counter[str]] = defaultdict(Counter)
    token_totals: Counter[str] = Counter()
    for category, examples in CATEGORY_EXAMPLES.items():
        for example in examples:
            example_tokens = _tokenize(example)
            vocabulary.update(example_tokens)
            word_counts[category].update(example_tokens)
            token_totals[category] += len(example_tokens)

    known_tokens = [token for token in tokens if token in vocabulary]
    if not known_tokens:
        return {"category": None, "score": 0.0, "model": "demo_multinomial_naive_bayes"}

    category_count = len(CATEGORY_EXAMPLES)
    vocabulary_size = len(vocabulary)
    log_scores: dict[str, float] = {}
    for category in CATEGORY_EXAMPLES:
        log_score = math.log(1 / category_count)
        denominator = token_totals[category] + vocabulary_size
        for token in known_tokens:
            likelihood = (word_counts[category][token] + 1) / denominator
            log_score += math.log(likelihood)
        log_scores[category] = log_score

    maximum = max(log_scores.values())
    exponentials = {category: math.exp(score - maximum) for category, score in log_scores.items()}
    total = sum(exponentials.values())
    category = max(log_scores, key=log_scores.__getitem__)
    return {
        "category": category,
        "score": exponentials[category] / total,
        "model": "demo_multinomial_naive_bayes",
    }
