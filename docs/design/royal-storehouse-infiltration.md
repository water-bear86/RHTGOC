# The Nottingham Ledger

`royal-storehouse@1.0.0` is a compact mastery mission built around route, alarm, and extraction tradeoffs. It supports clean infiltration without requiring it: disguise and sabotage avoid pressure, while ranged control and protected force trade speed for escalating relief waves.

## Mission loop

1. **Case the target:** approach the front tally gate or canal roofline.
2. **Enter:** Marian can take a royal disguise, Much can sabotage the route's alarm line, Robin can create a ranged opening, and Little John can force a protected entry.
3. **Secure the levy:** open two server-owned coin caches. Optional patrol intelligence and the Nottingham ledger sit at separate secured positions.
4. **Break contact:** once the required value is carried, choose the charcoal-burners' trail or canal barge extraction.
5. **Extract:** each carrier settles their own secured value. The mission completes exactly once when the authoritative target is reached.
6. **Review:** results name triggered alarm nodes, relief waves, intelligence, ledger, optional conditions, and the full mastery breakdown.

## Approaches and tradeoffs

- **Disguise:** Marian takes the disguise rack and can cross active alarm zones and open caches without raising them. This protects stealth score but costs movement and coordination time.
- **Sabotage:** Much cuts an alarm node before entry and can open nearby caches quietly. A sabotaged node delays relief response, but the other nodes remain live.
- **Ranged opening:** Robin can pin wardens from range and advance the entry phase quickly. The bow is audible, so the alarm network and relief timer start immediately.
- **Protected force:** Little John forces the chosen entrance and gains a protection contribution. This is the clearest, fastest entry but raises pressure and favors a disciplined extraction.

The front route reaches the caches faster and is more exposed. The roofline gives Marian and Much direct access to a quiet alarm node but lengthens the return route. Both forest and canal extractions remain valid for loud or clean runs.

## Server authority

The mission instance owns:

- stable alarm IDs, positions, and `active` / `sabotaged` / `triggered` transitions;
- stable cache IDs, kinds, positions, secured/looted state, and modifier-scaled values;
- disguise ownership, selected entry and extraction, carried/delivered value, optional intelligence and ledger state;
- alarm level, heat, relief-wave timing, guard spawns, failure reason, mastery result, and village vote.

Disconnected players cannot interact. Reconnecting clients receive the same alarm and cache snapshots. A looted cache cannot be opened or rewarded twice. Failed runs remain in the room's recent-result state but cannot enter the verified leaderboard path.

## Content identity

- Mission package: `missions/royal-storehouse.v1.json`
- Stable identity: `royal-storehouse@1.0.0`
- Content hash: `fnv1a32:8e74711d`
- Stable props: storehouse, alarm bells, caches, disguise rack, ledger, and alarm pulse.

## Verification

- Automated simulation covers a zero-alarm disguise/sabotage run with intelligence, ledger, split loot, and forest extraction; loud Little John entry and relief scaling; Robin's ranged opening and alarm cost; cache reconnect/idempotency; and normal room authority.
- All three mission packages and every stable environment reference pass build validation.
- A two-context Chromium playtest selected the mission from the 3D campfire, launched Marian and Much, matched the package ID/hash, entered through disguise with zero alarms, loaded the authored tree grove, and produced no console, page, or request errors.
- Visual proof: `/tmp/sherwood-qa/storehouse-clean-entry-trees.png`.
