# Sherwood soundtrack provenance

The six adaptive music tracks in `public/assets/audio/` were supplied by the
project owner in `producer_export_2026-07-13.zip` on 2026-07-13. They are
project-authorized production assets and retain their original AAC/M4A encoding
to avoid a lossy second transcode.

| Runtime state | Source title | Runtime file | SHA-256 |
| --- | --- | --- | --- |
| Exploration | Ancient Oaks (Exploration) | `ancient-oaks-exploration.m4a` | `7cd07f5e8f422955d231c18eb569777b226ccb17791fd9e2aee03dbbbadec601` |
| Stealth | Sherwood Surf Spy (Stealth) | `sherwood-surf-spy-stealth.m4a` | `38fb2172527a020dc3101b5727321a36ab472774755216ec6142c6355f5de45d` |
| Enemy near | Thicket Pursuit (Enemy Near) | `thicket-pursuit-enemy-near.m4a` | `dc3d7accad72b1b6c43e7da2816925d7c80d00558ba000cac4e5f0dd33cb5025` |
| Pursuit | Sherwood Pursuit (Acoustic Metal) Take 2 | `sherwood-pursuit-acoustic-metal.m4a` | `c60008dee016345f59ff41240e7088f1685b7f5b4fcc96ea4e2ba64169848c90` |
| Duel | The Outlaw's Duel (Flamenco Duo Edit) | `outlaws-duel-flamenco.m4a` | `fb6e3a7a62af93955a1889eccc35d7dbbb76962ac4cc4f5569268c9fb8c04ee9` |
| Victory | Whistle Stop Win (Victory) | `whistle-stop-win-victory.m4a` | `264f2429689622938c06e95ba2a6ec212b784645169f6d83e88042b0675b5e7d` |

The runtime lazy-loads only the active state and crossfades through the Music
bus. Master level, Music level, mono output, tab suspension, and dynamic-range
compression remain under the shared audio director.

Producer-review loop regions, transition markers, source defects, and delivery
requirements are tracked in
[`music-loop-production-brief.md`](./music-loop-production-brief.md) and the
machine-readable
[`music-loop-candidates.v1.json`](./music-loop-candidates.v1.json). Those
markers remain analysis candidates until approved against the lossless source
session.
