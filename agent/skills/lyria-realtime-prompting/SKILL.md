---
name: lyria-realtime-prompting
description: "How to prompt and steer Lyria RealTime, the live music stream behind the music_* tools: weighted prompt structure, genre/instrument/mood vocabularies, blending, cross-fading, and which config changes need a context reset. Activate before the first music_set_weighted_prompts call and whenever the user asks to change the music."
license: Apache-2.0
compatibility: Ron Live agent (BidiAgent) with the music_* tools; instrumental output only.
metadata:
  source: https://ai.google.dev/gemini-api/docs/lyria-prompt-guide#realtime-prompting
  model: models/lyria-realtime-exp
allowed-tools: music_set_weighted_prompts music_set_generation_config music_playback_control music_status music_take_status music_save music_discard_take music_close
---

# Prompting Lyria RealTime

Lyria RealTime is a persistent, bidirectional music stream. You steer it with **weighted prompts**
(`music_set_weighted_prompts`), shape it with the **generation config**
(`music_set_generation_config`), and control it with **playback controls**
(`music_playback_control`). Output is instrumental, 48 kHz stereo PCM, always watermarked. The
browser plays the audio; you never receive it.

## Workflow

1. Build the opening prompt set from what the user asked for: lead with the primary genre, then
   instruments, then mood. Two to four prompts is a good start. Call `music_set_weighted_prompts`
   **immediately**: on first use it connects and plays at once, so the user hears music a few
   seconds later without further calls.
2. Optionally call `music_set_generation_config` (bpm, scale, density, brightness, mode). Changing
   bpm or scale on a playing stream needs `music_playback_control("reset_context")`.
3. To change the music, **steer gradually**: resend the full prompt list with adjusted weights, or
   add one element at a time. Never send a completely different list in one step. Steering is
   forward-only: Lyria RealTime has no seek or regenerate; a "[music edit at m:ss]" request from the
   deck means change the music from now on in that direction.
4. `music_status` tells you what is in effect. `music_take_status` shows what has been recorded;
   `music_save` keeps it in the user's library (signed in only) and `music_discard_take` starts a
   fresh take. `music_close` ends the stream when the user is done.

## Weighted prompt structure

Every prompt is `{text, weight}`. The weight is relative importance; all weights are normalized and
**must not all be 0**. `1.0` is a good starting point. The list you send **replaces** the previous
list, so repeat the prompts you want to keep.

```json
[
  {"text": "minimal techno", "weight": 1.0},
  {"text": "deep sub bass", "weight": 0.6},
  {"text": "shimmering hi-hats", "weight": 0.4}
]
```

## Steering strategies

- **Blending genres**: balanced weights blend distinct styles, e.g. `ambient synth pads` 0.8 +
  `lo-fi hip-hop drums` 0.6; `flamenco guitar` 0.7 + `deep house groove` 0.5.
- **Dynamic transitions (cross-fade)**: move weights over several calls. Start with
  `chill jazz piano` 1.0; add `electronic breakbeat` 0.3; then raise breakbeat to 0.8 while lowering
  piano to 0.3. Drastic prompt changes sound abrupt; intermediate weights smooth them.
- **Layering**: keep instrument tags and mood tags as separate prompts so each can be adjusted
  independently (`bossa nova guitar` 0.9, `warm acoustic bass` 0.7, `subtle vinyl crackle` 0.3).
- **Removing an element**: lower its weight across calls (0.6 → 0.3 → 0.1) and then drop it from
  the list; do not send weight 0.

Example steering set:

```text
# Initial high-energy groove
techno groove 1.0, acid 303 bass 0.8

# Transition to a melodic breakdown
ambient synth pads 1.0, subtle reverberant piano 0.7, techno groove 0.2
```

## Writing the prompt text

Be descriptive: adjectives for mood, genre and instrumentation. Lead with the primary genre; hybrids
work (`a fusion of metal and hip-hop`, `classical chamber music with dark electronic drone`). Eras and
regional variants work (`early 1990s boom-bap hip-hop`, `Berlin minimal techno`, `1960s French yé-yé`).
Describe how instruments sound and interact (`a distorted 303 bassline cutting through crisp, tight
hi-hats`; `warm analog synth pads swelling beneath a dry, intimate acoustic guitar`).

Recognized vocabularies (full lists in `references/prompt-guide.md`):

- **Genres**: Acid House, Afrobeat, Bluegrass, Boom-Bap, Bossa Nova, Chillout, Chiptune, Cumbia,
  Deep House, Disco Funk, Drum & Bass, Dubstep, Electro Swing, Funk, Glitch Hop, Grime, Hyperpop,
  Indie Folk, Jazz Fusion, Latin Jazz, Lo-Fi Hip Hop, Minimal Techno, Neo-Soul, Orchestral Score,
  Piano Ballad, Post-Punk, Psytrance, Reggaeton, Salsa, Shoegaze, Surf Rock, Synthpop, Techno,
  Trance, Trap Beat, Trip Hop, Vaporwave.
- **Instruments**: 303 Acid Bass, 808 Hip Hop Beat, Alto Saxophone, Banjo, Buchla Synths, Cello,
  Conga Drums, Didgeridoo, Dirty Synths, Djembe, Flamenco Guitar, Funk Drums, Hang Drum, Harmonica,
  Harp, Kalimba, Koto, Marimba, Mellotron, Moog Oscillations, Rhodes Piano, Shredding Guitar, Sitar,
  Slide Guitar, Spacey Synths, Steel Drum, Synth Pads, Tabla, TR-909 Drum Machine, Trumpet,
  Vibraphone, Warm Acoustic Guitar, Woodwinds.
- **Moods**: Ambient, Bright, Chill, Dark, Dreamy, Emotional, Ethereal, Euphoric, Funky, Groovy,
  Melancholic, Nostalgic, Ominous, Psychedelic, Relaxed, Soulful, Triumphant, Upbeat, Whimsical.

## Generation config rules

`music_set_generation_config` sends the **whole** config each time: a field you omit reverts to the
model default, so repeat every field you want to keep.

- `bpm` 60–200 and `scale` (12 relative major/minor enums, or `SCALE_UNSPECIFIED`) are **hard
  transitions**: after changing either, call `music_playback_control("reset_context")` (or `stop`
  then `play`). The other fields apply without a reset.
- `density` 0–1 (sparse → busy), `brightness` 0–1 (darker → brighter), `guidance` 0–6 (default 4.0;
  higher follows prompts more closely but transitions more abruptly), `temperature` 0–3 (default 1.1),
  `top_k` 1–1000 (default 40), `seed` (random by default).
- `mute_bass`, `mute_drums`, `only_bass_and_drums` are booleans.
- `music_generation_mode`: `QUALITY` (default), `DIVERSITY`, or `VOCALIZATION` (vocalizations as an
  extra instrument; add them as prompts).
- When `bpm`, `density`, `brightness` or `scale` are omitted, the model picks them from the prompts.

## Playback controls

`play` starts or resumes; `pause` holds (play resumes from the same place); `stop` stops and resets
the context while keeping prompts and config (play restarts); `reset_context` resets the context
without stopping — a hard transition, used after bpm/scale changes.

## Limits and honesty

- Instrumental only. Prompts that trip the safety filter are ignored and arrive as a
  `music_filtered_prompt`; `music_status` lists them — tell the user and rephrase.
- Tell the user what you changed in one short sentence; do not claim the music changed until the
  tool returned success.
