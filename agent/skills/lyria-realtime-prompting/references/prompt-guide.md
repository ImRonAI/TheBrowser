# Lyria prompt guide (reference copy)

Source: https://ai.google.dev/gemini-api/docs/lyria-prompt-guide — the sections that apply to Lyria
RealTime (weighted prompts over the Live Music API). Lyria 3.5 batch-generation sections (song
structure tags, lyrics, vocal profiles) are omitted because RealTime is instrumental and steered live.

## Prompt fundamentals

Your prompt can be a short phrase (`minimal techno`) or a structured, detailed description
(`A 1980s-style synth-pop track with a driving beat, shimmering synthesizers, and a catchy,
anthemic chorus... Upbeat tempo around 120 BPM`). Both produce strong results.

## Genre and style

Lead with the primary genre. Combine genres for hybrids:

- A fusion of metal and hip-hop
- Death metal combined with operatic vocals
- Classical chamber music with dark electronic drone elements
- Modern electronic dance music (EDM) mixed with Europop

Specify an era or regional variant:

- Early 1990s boom-bap hip-hop
- 1960s French yé-yé pop
- 1980s post-punk and new wave
- 2000s mainstream R&B
- Berlin minimal techno or Bay Area hyphy

### Genre keywords

- **Electronic & Dance**: Acid House, Breakbeat, Chillout, Chiptune, Deep House, Drum & Bass,
  Dubstep, EDM, Electro Swing, Glitch Hop, Hyperpop, Minimal Techno, Moombahton, Psytrance, Synthpop,
  Techno, Trance, Trip Hop, Vaporwave
- **Hip-Hop & R&B**: 808 Hip Hop, Boom-Bap, Contemporary R&B, G-funk, Grime, Lo-Fi Hip Hop, Neo-Soul,
  New Jack Swing, Trap Beat
- **Rock & Alternative**: Alternative Country, Blues Rock, Classic Rock, Funk Metal, Garage Rock,
  Indie Folk, Indie Pop, Post-Punk, 60s Psychedelic Rock, Shoegaze, Surf Rock
- **Jazz, Soul & Funk**: Acid Jazz, Afrobeat, Bossa Nova, Disco Funk, Funk, Jazz Fusion, Latin Jazz
- **Folk & Traditional**: Bengal Baul, Bhangra, Bluegrass, Celtic Folk, Cumbia, Indian Classical,
  Irish Folk, Merengue, Polka, Reggae, Reggaeton, Renaissance Music, Salsa
- **Classical & Acoustic**: Baroque, Orchestral Score, Piano Ballad

## Instruments and textures

Lyria picks instrumentation for the genre automatically; declare specific or unusual instruments
explicitly. Describe how instruments sound and interact to set mood and texture:

- A distorted 303 bassline cutting through crisp, tight hi-hats
- Warm, analog synth pads swelling beneath a dry, intimate acoustic guitar
- A wall of sound built from multiple layers of fuzz guitar, with distant, reverb-soaked vocals

### Instrument keywords

- **Keyboards & Synths**: Buchla Synths, Clavichord, Dirty Synths, Harpsichord, Mellotron, Moog
  Oscillations, Ragtime Piano, Rhodes Piano, Smooth Pianos, Spacey Synths, Synth Pads
- **Bass & Drums**: 303 Acid Bass, 808 Hip Hop Beat, Boomy Bass, Conga Drums, Drumline, Funk Drums,
  Precision Bass, Tabla, TR-909 Drum Machine
- **Guitars & Strings**: Banjo, Balalaika, Bouzouki, Cello, Charango, Dulcimer, Fiddle, Flamenco
  Guitar, Guitar, Harp, Koto, Lyre, Mandolin, Pipa, Shamisen, Shredding Guitar, Sitar, Slide Guitar,
  Viola Ensemble, Warm Acoustic Guitar
- **Wind & Brass**: Alto Saxophone, Bagpipes, Bass Clarinet, Didgeridoo, Harmonica, Ocarina, Trumpet,
  Tuba, Woodwinds
- **Percussion**: Bongos, Djembe, Glockenspiel, Hang Drum, Kalimba, Maracas, Marimba, Mbira, Steel
  Drum, Vibraphone

## Musical parameters

- **Tempo (BPM)**: set directly in the prompt (`120 BPM`, `slow tempo around 72 BPM`) or with the
  `bpm` config field (60–200; needs a context reset).
- **Key and scale**: `in G major`, `in D minor`, or the `scale` config enum (relative major/minor
  pairs; needs a context reset).
- **Mood and atmosphere**: Ambient, Bright, Chill, Dark, Dreamy, Emotional, Ethereal, Euphoric,
  Funky, Groovy, Melancholic, Nostalgic, Ominous, Psychedelic, Relaxed, Soulful, Triumphant, Upbeat,
  Whimsical

## Prompting Lyria RealTime

Lyria RealTime uses weighted prompts rather than a single prompt string, so you can blend influences
and steer continuously over the WebSocket connection.

### Weighted prompt structure

```python
prompts = [
    types.WeightedPrompt(text="minimal techno", weight=1.0),
    types.WeightedPrompt(text="deep sub bass", weight=0.6),
    types.WeightedPrompt(text="shimmering hi-hats", weight=0.4),
]
```

### Real-time steering strategies

- **Blending genres**: assign balanced weights — `ambient synth pads` (0.8) + `lo-fi hip-hop drums`
  (0.6); `flamenco guitar` (0.7) + `deep house groove` (0.5).
- **Dynamic transitions**: adjust weights over time — start with `chill jazz piano` (1.0); gradually
  add `electronic breakbeat` (0.3); increase breakbeat to 0.8 while lowering piano to 0.3.
- **Layering elements**: keep instrument and mood tags separate so they adjust independently —
  `bossa nova guitar` (0.9), `warm acoustic bass` (0.7), `subtle vinyl crackle` (0.3).

### Lyria RealTime steering set

```python
# Initial high-energy groove
await session.set_weighted_prompts(prompts=[
    types.WeightedPrompt(text="techno groove", weight=1.0),
    types.WeightedPrompt(text="acid 303 bass", weight=0.8),
])

# Transition to a melodic breakdown
await session.set_weighted_prompts(prompts=[
    types.WeightedPrompt(text="ambient synth pads", weight=1.0),
    types.WeightedPrompt(text="subtle reverberant piano", weight=0.7),
    types.WeightedPrompt(text="techno groove", weight=0.2),
])
```

## Best practices (RealTime docs)

- Be descriptive: adjectives for mood, genre, and instrumentation.
- Iterate and steer gradually: add or modify elements rather than replacing the whole prompt.
- Experiment with `weight` to control how strongly a new prompt affects the ongoing generation.
- Updating the config replaces the whole config; `bpm` and `scale` changes need `reset_context`.
- Prompts are safety-filtered; filtered prompts are ignored and reported with a reason.
- Output is instrumental only and always watermarked.
