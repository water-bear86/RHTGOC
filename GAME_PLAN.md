# Sherwood Rebellion — game map

## The fantasy

An isometric 3D browser adventure where the player becomes the outlaw leader of a living Sherwood. Scout royal routes, steal taxes, survive pursuit, and redistribute the haul to grow a rebellion.

## First playable loop

1. Leave the village and find the Sheriff's guarded tax cart.
2. Press `E` beside the cart to steal 120 coin and trigger maximum Wanted heat.
3. Escape pursuing guards. The deep woods cool Wanted faster when guards lose proximity.
4. Reach the village fire and press `E` to distribute the haul.
5. Deliver 300 total coin to complete the prototype.

The vertical slice supports click-to-move, keyboard movement, a smooth isometric follow camera, guard patrol/chase/stun behavior, archery, health, loot, Wanted heat, cart respawns, a village goal, responsive HUD, and win/fail states.

## Production map

### Phase 1 — Forest that feels alive

- Replace procedural primitives with a coherent GLB asset kit.
- Add navmesh pathfinding, collision, river crossings, cover, and authored landmarks.
- Add villagers, wildlife, ambient audio, day/night, and weather.

### Phase 2 — The outlaw loop

- Add scouting intel, wagon route variation, ambush planning, stealth sight cones, melee and archery.
- Add Merry Men companions with distinct roles: Little John, Marian, Much, and Will Scarlet.
- Turn redistribution into village choices that alter security, food, loyalty, and available recruits.

### Phase 3 — Persistent world

- Multiple connected regions: Sherwood, Nottingham, Locksley, royal roads, and village commons.
- Quests, gathering, crafting, camp building, reputation, cosmetics, inventories, and save accounts.
- Co-op parties and shared encounters before any open economy or marketplace work.

### Phase 4 — Live game

- Server-authoritative simulation, persistence, moderation, telemetry, exploit resistance, and content tools.
- Seasonal Sheriff campaigns, guild-like outlaw bands, social hubs, trading, and community events.

## Technical direction

- Runtime: Three.js + TypeScript + Vite.
- Rendering: true 3D geometry, perspective camera, shadows, fog, and procedural low-poly placeholders.
- State: simulation owns rules and serializable data; Three.js mirrors it as disposable view objects.
- UI: accessible DOM HUD over WebGL.
- Future assets: GLB/glTF 2.0 with optimized textures and measured draw calls.
- Physics: add Rapier when terrain collision, projectiles, and richer combat justify it.
