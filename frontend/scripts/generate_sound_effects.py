#!/usr/bin/env python3
"""Generate the small original WAV cues used by the game UI."""

from __future__ import annotations

import math
import random
import struct
import wave
from pathlib import Path


SAMPLE_RATE = 44_100
OUTPUT_DIR = Path(__file__).resolve().parents[1] / "public" / "audio"


def write_wav(name: str, duration: float, sample) -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    frame_count = int(SAMPLE_RATE * duration)
    with wave.open(str(OUTPUT_DIR / name), "wb") as target:
        target.setnchannels(1)
        target.setsampwidth(2)
        target.setframerate(SAMPLE_RATE)
        frames = bytearray()
        for index in range(frame_count):
            time = index / SAMPLE_RATE
            value = max(-1.0, min(1.0, sample(time, duration)))
            frames.extend(struct.pack("<h", int(value * 32767)))
        target.writeframes(frames)


def chat_pop(time: float, duration: float) -> float:
    progress = time / duration
    envelope = math.sin(math.pi * progress) ** 1.8
    frequency = 680 + 520 * progress
    return math.sin(2 * math.pi * frequency * time) * envelope * 0.55


def stone_place(time: float, duration: float) -> float:
    random.seed(int(time * SAMPLE_RATE))
    envelope = math.exp(-30 * time)
    tone = math.sin(2 * math.pi * 185 * time) * 0.45
    noise = (random.random() * 2 - 1) * 0.35
    return (tone + noise) * envelope


def undo_request(time: float, duration: float) -> float:
    first = math.sin(2 * math.pi * 660 * time) * math.exp(-11 * time)
    delayed_time = max(0.0, time - 0.13)
    second = 0 if time < 0.13 else math.sin(2 * math.pi * 880 * delayed_time) * math.exp(-12 * delayed_time)
    return (first + second) * 0.4


if __name__ == "__main__":
    write_wav("chat-pop.wav", 0.18, chat_pop)
    write_wav("stone-place.wav", 0.15, stone_place)
    write_wav("undo-request.wav", 0.38, undo_request)
