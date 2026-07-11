# Break the Iron Road

`prison-wagon@1.0.0` is a cooperative rescue mission built from the shared versioned mission kit. It replaces the loot loop with a moving interception, a shared lock action, a server-owned captive escort, and two extraction choices.

## Mission loop

1. **Scout:** the band discovers either the fallen-oak blockade or the ford-rope ambush.
2. **Ambush:** the wagon and escort continue moving along an authored road until the required number of guards are stunned. If the wagon reaches the end of the road, the mission fails explicitly.
3. **Release:** players interact beside the stopped cage. Each connected player can contribute to the lock once; the server rejects duplicate contribution spam.
4. **Pursuit:** three stable captive identities leave the cage and follow nearby connected escorts. Their positions and states survive disconnect/reconnect.
5. **Escape:** the band commits to either the outlaw refuge or ferryman's crossing. Captives must physically reach that extraction before they can be accounted for.
6. **Results:** each captive transitions exactly once from `following` to `extracted` and earns exactly one community reward. Success opens the village vote. Capture, timeout, or an escaped wagon produces a partial-rescue result and lets the leader return the band to camp.

## Discoverable strategies

- **Fallen-oak hold:** Robin opens at range while Little John protects the group, breaks the lock quickly, and anchors the longer western escort. This route is direct but keeps the party exposed to the relief patrol.
- **Ford sabotage:** Marian reaches the eastern intercept quickly and suppresses heat while Much traps the escort, cuts the reinforcement signal, and makes a clean lock contribution. The ferryman extraction is shorter but crosses more open ground.

Both are viable with two players. Three- and four-player parties gain redundancy and faster control, while guard count and the selected modifiers scale pressure.

## Role contributions

- **Robin Hood:** long-range guard openings and Twin Shot stop the moving escort before it escapes.
- **Maid Marian:** fastest scouting, Veil pursuit control, and a clean lock contribution.
- **Little John:** Oak Sweep controls the escort, his lock contribution is strongest, and his protection/revive kit stabilizes the captive column.
- **Much:** road snares, signal sabotage, and a strong clean lock contribution delay reinforcement pressure.

## Authority and recovery

The room server owns wagon path progress, moving escort homes, lock contributors, captive identity/status/position/reward flag, selected extraction, reinforcement timing, failure reason, results, and vote. Clients receive snapshots and only render intent results.

Captives are stored inside the mission instance, not reconstructed from connected players. A reconnect therefore observes the same IDs and state. Rewards are guarded by both the captive `rewarded` flag and the terminal mission status. Failed runs are never claimed as verified leaderboard entries, while successful runs carry mission slug, version, and content hash into the existing seasonal-board path.

## Content and presentation

- Mission package: `missions/prison-wagon.v1.json`
- Stable identity: `prison-wagon@1.0.0`
- Content hash: `fnv1a32:815d23bc`
- Presentation: moving four-wheel cage, visible locked captives, procedural villager escorts, route objective copy, rescue/lock debug state, and mission-specific leaderboard filter.

## Verification

- 72 automated tests pass. Prison-specific coverage includes moving wagon and escort authority, stable captive IDs, duplicate lock rejection, reconnect continuity, alternate extraction, single reward settlement, explicit timeout partial rescue, and room return with partial result state.
- Both mission packages and every stable asset reference pass build-time validation.
- Production TypeScript and Vite builds pass under protocol v5.
- A two-context Chromium playtest selected the mission from the campfire, synchronized Little John and Much, launched both clients, matched `prison-wagon@1.0.0` and its hash, entered the river interception, rendered the moving cage/captives/escort, and produced no console, page, or request errors.
- Visual proofs: `/tmp/sherwood-qa/prison-wagon-launch.png` and `/tmp/sherwood-qa/prison-wagon-moving.png`.
