# Much · Saboteur

Much changes the timing and terrain of a shared heist without creating free-form construction or invisible hazards.

## Road Snare

- Much's signature places one server-owned snare at Much's current authoritative position.
- Placement is rejected outside the playable bounds, in the river corridor, beside the tax cart or village fire, during extraction, while another owned snare exists, or while the 18-second signature cooldown is active.
- The action accepts no client coordinates, so a forged client cannot place at arbitrary range.
- A snare lasts 600 simulation ticks (30 seconds), survives reconnects, and is removed when it triggers or expires.
- A guard within 1.35 units consumes the snare and is visibly stunned for 4.5 seconds.

The 3D prop uses a gold patterned ring, crossed wooden obstruction, tall stakes, and a center marker. It remains legible without depending on color alone.

## Reinforcement signal

The Sheriff's signal post stands southeast of the cart. Much can cut it once per mission through the normal contextual interaction. The authoritative shared state:

- drops Wanted pressure by 20;
- delays the reinforcement response for 30 seconds;
- slows active pursuit while the delay remains;
- topples and desaturates the signal prop on every client.

## Mastery and limits

Server-owned trap hits and signal sabotages contribute to support mastery, appear in the party HUD, and add a Saboteur impact row to results. Fixed limits, cleanup, cooldowns, terrain validation, and no PvP collision keep the system readable and abuse-resistant.
