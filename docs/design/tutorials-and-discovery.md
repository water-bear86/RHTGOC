# Tutorials and discovery

The onboarding system must explain how to play without explaining away the reason to explore. Players need to understand controls, hero responsibilities, mission rules, and map symbols; they should not receive advance knowledge of where a seeded target or undiscovered point of interest happens to be.

The expanded field map is therefore a record of what the Merry Band knows, not an oracle for the current seed.

## Composable tutorial contract

Tutorial progress is split into three independent, versioned gates:

1. **Universal gate:** move by perspective, rotate the camera, interact, fire, use a signature ability, and understand the five band signals.
2. **Character gate:** learn the selected hero's role, signature, resource tradeoff, and useful cooperative contribution. Robin, Marian, Little John, and Much each retain separate completion.
3. **Mission gate:** learn the core loop and failure pressure for the selected mission type: tax-cart robbery, prison-wagon rescue, or storehouse infiltration.

A first-run briefing composes the applicable universal, character, and mission lessons. It may add one short character-and-mission tactic, but it must not become a separately duplicated twelve-script tutorial. Changing hero should not erase mission knowledge, and changing mission should not erase hero knowledge.

Completion is earned independently. Reaching the Robbery phase is not, by itself, tutorial completion. A gate completes when the player finishes its briefing. Every gate remains replayable from Field Notes, and a tutorial content-version change may invalidate only the affected gate.

## Universal vocabulary and signals

The first briefing establishes the complete action vocabulary, while ordinary play reinforces it through short contextual prompts:

- Move with the mapped perspective controls or pointer movement.
- Rotate the camera by 90-degree steps.
- Interact with the mapped interaction action.
- Stand still, fire, and remain planted through the 0.6-second bow load. Moving before release cancels the shot without spending an arrow; a released miss still spends one.
- Use the selected hero's signature successfully.
- Use or review the Merry Band's fixed signals:
  - `1` — danger;
  - `2` — target;
  - `3` — route;
  - `4` — loot;
  - `5` — regroup.

Displayed keys must come from the current input settings rather than being hard-coded. Field Notes may explain all controls, while ordinary play should show at most one relevant prompt at a time.

## Character lessons

| Hero | Lesson focus |
| --- | --- |
| Robin | Six-arrow economy, longest ranged opening, Twin Shot, and covering the carrier or captive column. |
| Maid Marian | Fast scouting, Veil, Wanted-pressure control, disguises, and clean positioning. |
| Little John | Oak Sweep, heavy carry, protected revives, crowd control, and stabilizing a pressured band. |
| Much | Road Snare placement, reinforcement-signal or alarm sabotage, and changing the timing of a pursuit. |

The resolved briefing should also state the hero's useful contribution to the chosen mission. Examples include Robin stopping a moving prison wagon, Marian using the storehouse disguise, Little John making a strong prison-lock contribution, and Much cutting an alarm line.

## Mission lessons

### Tax-cart robbery

Scout a route, control the escort, rob the cart, choose an escape, break pursuit, and return the taxes to the village. Searching too slowly raises Sheriff pressure, but the interface must not convert that pressure into a target locator.

### Prison-wagon rescue

Intercept the moving wagon before it escapes, scatter the escort, contribute once to the lock, keep the freed captives together, choose a refuge, and physically escort every captive to extraction.

### Storehouse infiltration

Case an approach, disguise, sabotage, or force entry, secure the required levy, decide whether optional intelligence is worth the risk, and extract while managing the alarm network and relief waves.

## Learned-map invariant

Both the compact minimap and any zoomed field map must apply the same visibility rules:

- The camp sector and the local player's current sector are known at the start.
- Entering a sector reveals it for the entire Merry Band.
- The map may show the band, camp, band signals, committed routes, and locations the band has actually discovered.
- The target marker, bearing, distance, and target-sector styling remain absent until authoritative discovery.
- Unexplored cells must not receive highlights, question marks, gradients, search rings, or copy calculated from the hidden target position.
- Search pressure is a global danger state. It may change Wanted pressure or reinforcements, but it must not narrow a spatial search area around the objective.
- Expanding the map changes scale and explanation only. It grants no additional world knowledge.

The regression rule is strict: before discovery, two runs with the same band-known sectors and player positions but different hidden target positions must produce identical map output. After discovery, the target and navigation guidance may appear normally.

Recommended player-facing copy:

> **A map of what the band knows**
>
> Sherwood changes with every run. Your map begins with the camp and the ground your band has actually crossed. Entering a sector sketches it for everyone; useful locations and mission targets appear only after they are discovered.
>
> That uncertainty is part of the heist. Search quickly and risk drawing the Sheriff's attention, or move carefully and preserve the element of surprise. The map helps you remember Sherwood—it does not scout it for you.

## Presentation rules

- Present the composed hero-and-mission briefing at the campfire before Ready.
- Required gates cannot be skipped into play. Closing a briefing returns the player to the entry or campfire state without recording completion; replay remains available after completion.
- Readiness carries the authoritative hero and mission the player was briefed on. The room server rejects a stale Ready if either selection changes before the command arrives.
- Never automatically open a blocking tutorial after an authoritative multiplayer mission has started; the room does not pause for one player.
- Use one compact contextual coaching prompt during play and keep the center and lower-middle playfield clear.
- Keep Field Notes and tutorial replay optional behind an explicit player action.
- Respect remapped inputs, keyboard focus, readable-text mode, high contrast, captions, and reduced motion.

## Progress and online boundary

The first implementation stores tutorial versions and completion in browser-local storage. It is not authoritative, ranked, wallet-bound, or synchronized across devices. Clearing site data clears tutorial progress. Account synchronization may be added later through an explicit persistence design; it is not a reason to put identity data into gameplay analytics.

The offline solo simulation currently supports the tax-cart loop only. Universal lessons and each hero's general character lesson may be practiced there, but the prison-wagon and storehouse mission gates are band-only and require an authoritative online room. The interface must describe that limitation instead of marking those gates complete from tax-cart play or presenting unavailable offline training as broken.

## Acceptance checks

- All four heroes resolve against all three mission types without missing copy.
- Completing one gate does not mutate unrelated gates.
- Remapped controls appear correctly in prompts and Field Notes.
- A hidden target cannot affect any compact or expanded map output.
- The target marker and bearings appear after authoritative discovery.
- The expanded map explains every displayed symbol without revealing an undiscovered location.
- No tutorial modal opens automatically during an active multiplayer mission.
- Offline play can complete only the universal, selected-character, and tax-cart gates.
