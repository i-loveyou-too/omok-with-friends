#!/usr/bin/env python3
"""Generate the small original WAV cues shared by the yut and secret-card game rooms.

Same approach as generate_sound_effects.py: pure stdlib synthesis, no external
assets, so these are original, license-free cues.
"""

from __future__ import annotations

import math
import random
import struct
import wave
from pathlib import Path

SAMPLE_RATE = 44_100
OUTPUT_DIR = Path(__file__).resolve().parents[1] / "public" / "audio" / "cues"


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


def turn_alert(time: float, duration: float) -> float:
    progress = time / duration
    envelope = math.sin(math.pi * progress) ** 1.4
    first = math.sin(2 * math.pi * 780 * time)
    second = math.sin(2 * math.pi * 1040 * max(0.0, time - 0.1))
    return (first * 0.5 + second * 0.5) * envelope * 0.6


def check(time: float, duration: float) -> float:
    envelope = math.exp(-16 * time)
    return math.sin(2 * math.pi * 520 * time) * envelope * 0.55


def call(time: float, duration: float) -> float:
    progress = time / duration
    envelope = math.sin(math.pi * progress) ** 1.5
    frequency = 440 + 220 * progress
    return math.sin(2 * math.pi * frequency * time) * envelope * 0.58


def raise_bet(time: float, duration: float) -> float:
    progress = time / duration
    envelope = math.sin(math.pi * progress) ** 1.2
    frequency = 380 + 460 * progress
    return math.sin(2 * math.pi * frequency * time) * envelope * 0.62


def all_in(time: float, duration: float) -> float:
    random.seed(int(time * SAMPLE_RATE) + 7)
    envelope = math.exp(-4.2 * time) if time > 0.28 else (time / 0.28)
    tone = math.sin(2 * math.pi * 220 * time) * 0.5 + math.sin(2 * math.pi * 330 * time) * 0.3
    shimmer = (random.random() * 2 - 1) * 0.12
    return (tone + shimmer) * envelope * 0.7


def fold(time: float, duration: float) -> float:
    progress = time / duration
    envelope = math.exp(-6 * time)
    frequency = 300 - 180 * progress
    return math.sin(2 * math.pi * frequency * time) * envelope * 0.5


def win(time: float, duration: float) -> float:
    notes = [523.25, 659.25, 783.99, 1046.5]
    step = duration / len(notes)
    index = min(len(notes) - 1, int(time / step))
    local = time - index * step
    envelope = math.exp(-6 * local)
    return math.sin(2 * math.pi * notes[index] * time) * envelope * 0.55


def lose(time: float, duration: float) -> float:
    notes = [392.0, 349.23, 293.66]
    step = duration / len(notes)
    index = min(len(notes) - 1, int(time / step))
    local = time - index * step
    envelope = math.exp(-5 * local)
    return math.sin(2 * math.pi * notes[index] * time) * envelope * 0.5


def timer_warning(time: float, duration: float) -> float:
    beep_len = 0.11
    gap = 0.14
    cycle = beep_len + gap
    local = time % cycle
    if local > beep_len:
        return 0.0
    envelope = math.sin(math.pi * (local / beep_len))
    return math.sin(2 * math.pi * 980 * time) * envelope * 0.55


if __name__ == "__main__":
    write_wav("turn-alert.wav", 0.34, turn_alert)
    write_wav("check.wav", 0.16, check)
    write_wav("call.wav", 0.22, call)
    write_wav("raise.wav", 0.26, raise_bet)
    write_wav("all-in.wav", 0.5, all_in)
    write_wav("fold.wav", 0.3, fold)
    write_wav("win.wav", 0.9, win)
    write_wav("lose.wav", 0.85, lose)
    write_wav("timer-warning.wav", 0.62, timer_warning)
