# Sherwood adaptive-music loop production brief

This brief converts the six supplied full-length tracks into a varied,
phrase-aware adaptive score. It does **not** approve automated loop edits. The
markers in [`music-loop-candidates.v1.json`](./music-loop-candidates.v1.json)
are producer-review candidates that must be adjusted by ear and exported from
the lossless source session.

## Intended runtime behavior

Each music state should own a small family of loops rather than one repeating
file. The director selects from a shuffled bag, prevents an immediate repeat,
and schedules changes at the next approved phrase boundary.

- Remain in a selected loop for at least 20–30 seconds.
- Escalate only after the new threat state persists for 3–5 seconds.
- De-escalate only after 8–12 seconds of calm.
- Prefer another loop in the current state over a new track.
- Reserve cross-track transitions for durable mission phases or outcomes.
- Let short guard-proximity changes use SFX and ambience, not a complete music
  replacement.

## Structural analysis

| State | Source duration | Source rate | Estimated tempo | Estimated centre | Production observation |
| --- | ---: | ---: | ---: | --- | --- |
| Exploration | 174.997 s | 48 kHz | 82 BPM | E minor | Broad 23.4-second phrase blocks with two strong medium-length loop candidates. |
| Stealth | 163.328 s | 48 kHz | 147.7 BPM / 73.85 half-time | A minor | Shares its phrase grid with Enemy Near, making this the cleanest matched transition family. |
| Enemy Near | 156.032 s | 48 kHz | 147.7 BPM / 73.85 half-time | G major / E minor | Contains low, medium, and high-pressure regions plus a useful tension reset around 78–91 s. |
| Pursuit | 157.824 s | 48 kHz | 101.3 BPM | A minor | Multiple 16–24-bar high-energy regions; harmonically close to Duel. |
| Duel | 106.666 s | 44.1 kHz | 115 BPM | A minor | One strong clean loop region, two intentional silence gaps, and a clipped late section that requires repair. |
| Victory | 146.752 s | 48 kHz | 115 BPM | D minor | Opening should remain a one-shot; the results screen can rotate later celebration loops. |

Tempo, downbeat, and key labels are signal-analysis estimates. Confirm them in
the source session before making sample-accurate edits.

## Recommended loop families

Times refer to the current runtime M4A files.

| State | Loop | Source in | Source out | Approx. bars | Role |
| --- | --- | ---: | ---: | ---: | --- |
| Exploration | B | 47.601 | 94.343 | 16 | settled forest movement |
| Exploration | C | 94.343 | 141.224 | 16 | broader, more active exploration |
| Stealth | A | 13.723 | 39.660 | 16 | low-pressure scouting |
| Stealth | B | 39.660 | 91.696 | 32 | sustained infiltration |
| Stealth | C | 130.682 | 156.642 | 16 | high stealth tension |
| Enemy Near | A | 13.375 | 39.311 | 16 | suspicion enters |
| Enemy Near | B | 52.361 | 78.298 | 16 | pressure building |
| Enemy Near | C | 104.397 | 143.383 | 24 | sustained danger |
| Pursuit | A | 38.638 | 95.480 | 24 | chase foundation |
| Pursuit | B | 76.626 | 114.428 | 16 | harder chase |
| Pursuit | C | 114.428 | 152.416 | 16 | maximum pursuit |
| Duel | A | 18.390 | 51.780 | 16 | close combat / robbery |
| Victory | A | 33.437 | 83.522 | 24 | results celebration |
| Victory | B | 66.804 | 100.194 | 16 | elevated results celebration |

The regions overlap where the same musical passage may serve two intensity
profiles. Final production can narrow them after listening to the source
session and checking arrangement entrances.

## Candidate state transitions

The local audition kit applies a six-second equal-power crossfade to these
source markers:

| Transition | Exit | Entry | Reason |
| --- | ---: | ---: | --- |
| Exploration → Stealth | Exploration 94.343 | Stealth 13.723 | restrained, harmonically compatible mission entry |
| Stealth → Enemy Near | Stealth 39.660 | Enemy Near 52.361 | shared tempo family and phrase duration |
| Enemy Near → Pursuit | Enemy Near 104.397 | Pursuit 57.632 | strong energy lift with compatible spectral and harmonic profile |
| Stealth → Duel | Stealth 13.723 | Duel 18.390 | clean move into the A-minor combat family |
| Duel → Pursuit | Duel 35.109 | Pursuit 57.632 | strongest measured combat-family match |
| Pursuit → Victory | Pursuit 95.480 | Victory 0.046 | preserves the authored victory opening rather than entering mid-song |

These are comparison renders, not final transition edits. A producer may
replace a long crossfade with a two-bar transition sting, cymbal tail, pickup,
or shared drone when that sounds more intentional.

## Source defects and delivery requirements

- `outlaws-duel-flamenco.m4a` measures approximately **+0.65 dBTP** and has a
  known clipped area around 93 seconds. Do not export its late section until
  it is repaired.
- `whistle-stop-win-victory.m4a` measures approximately **+0.01 dBTP**. Give
  the final master at least -1 dBTP of true-peak headroom.
- Duel is the lone 44.1 kHz source. Deliver all final assets from the source
  session at a common 48 kHz.
- Do not transcode the supplied M4A files into production loops. Export
  24-bit WAV or lossless FLAC from the original session, then create browser
  AAC and Opus derivatives once.
- Deliver loop bodies with exact sample-aligned boundaries.
- Also deliver two bars of pre-roll and a separate natural tail for each loop.
  These handles let the runtime enter, leave, and overlap without cutting
  attacks or reverbs.
- Master related loops as a family. Preserve internal dynamics and target
  consistent perceived level rather than normalizing every file independently.

## Audition kit

The generated review renders are outside the repository:

`/Users/angus/Documents/robinhood/music-loop-auditions`

- `loops/` contains 14 sixteen-second seam tests. Each plays the source tail
  into the proposed loop head with a four-second equal-power overlap.
- `transitions/` contains six eighteen-second state-transition tests with a
  six-second equal-power overlap.
- The previews are 24 kHz AAC solely for quick review. Never use them as game
  masters.

For each preview, mark **keep**, **adjust**, or **reject**. For an adjustment,
record the preferred source in/out time or source-session bar number. Those
decisions will become the approved runtime cue map.
