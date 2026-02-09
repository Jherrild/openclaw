# Result: Add Office Joke Persistent Interrupt

**Status:** ✅ Complete

Added a new persistent interrupt (`int-office-joke`) to `skills/home-presence/persistent-interrupts.json` that triggers when the office mmWave sensor (`binary_sensor.everything_presence_lite_4f1008_occupancy`) changes to `on`. The interrupt is type `subagent` and instructs the agent to send Jesten a short, witty joke via Telegram after verifying it's a fresh arrival (vacant → occupied) from the presence log. No issues encountered.
