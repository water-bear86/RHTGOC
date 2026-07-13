# Little John · Vanguard

Little John is the band stabilizer. He is slower while empty-handed than Robin or Marian, but carries heavy tax loads with much less slowdown and turns dangerous clusters into rescue windows.

## Authoritative role rules

- Base movement: 5.9 units/second.
- Heavy carry: movement multiplier bottoms at 0.82 and scales over 1,100 coin; other roles bottom at 0.68 over 600 coin.
- Quiver: 3 arrows, preserving Robin's ranged advantage.
- Oak Sweep: 6-unit range, 5-second guard stun, 3.5-second nearby-ally protection, 20-second cooldown.
- Vanguard revive: target returns with 2 health and 4.5 seconds of protection; standard revives return 1 health and 2.5 seconds of protection.

The room server validates role, phase, range, connected state, health, cooldown, and valid targets. Clients send only the existing `signature` and `revive` intents.

## Mastery evidence

Each Vanguard accumulates three visible, server-owned contributions:

- protection score from protected allies and Vanguard revives;
- guards controlled by Oak Sweep;
- highest heavy carry during the mission.

The party HUD shows protection and crowd-control totals, the mission result adds a Vanguard impact row, and authoritative events distinguish crowd control, ally protection, and heavy carries.

## Role overlap guardrails

- Robin retains the longest-range opening, six-arrow economy, and precision mastery.
- Marian retains the fastest scouting, pursuit break, and stealth route control.
- Little John creates short-range safety and carries the largest load, but has the smallest quiver and lowest unloaded speed.

This gives Little John decisions in scouting (bodyguard and route protection), ambush (Oak Sweep), robbery (heavy pickup), and escape (carry and rescue) without replacing the specialists.
