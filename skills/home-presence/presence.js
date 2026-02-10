#!/usr/bin/env node
// home-presence skill: occupancy detection + TTS routing via Home Assistant REST API
// The ha-stdio-final MCP does NOT expose a generic call_service tool, so TTS must
// go through the HA REST API directly.

const fs = require('fs');
const path = require('path');

// ── Configuration ──────────────────────────────────────────────────────────────

const HA_URL = 'http://homeassistant:8123';
const TOKEN = (() => {
  const cfg = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', '..', 'config', 'mcporter.json'), 'utf8')
  );
  const bearerArg = cfg.mcpServers['ha-stdio-final'].args
    .find(a => typeof a === 'string' && a.startsWith('Bearer '));
  return bearerArg ? bearerArg.replace('Bearer ', '').trim() : null;
})();
if (!TOKEN) { console.error('ERROR: Could not extract HA bearer token from mcporter.json'); process.exit(1); }

const TTS_ENTITY   = 'tts.google_ai_tts';
const TTS_VOICE    = 'alnilam';
const DEFAULT_AREA = 'Living Room';
const CO2_OCCUPIED_THRESHOLD = 600; // ppm – above this suggests someone is present
const LAYOUT_PATH    = path.join(__dirname, 'layout.json');
const SETTINGS_PATH  = path.join(__dirname, 'settings.json');

// Person entities to check for home/away status
const PERSON_ENTITIES = ['person.jesten', 'person.april_jane'];

// ── Hardcoded defaults (used when layout.json is absent) ───────────────────────

const DEFAULT_AREA_SPEAKERS = {
  'living room': ['media_player.living_room_speaker'],
  'basement':    ['media_player.basement'],
  'gym':         ['media_player.gym'],
  'office':      ['media_player.pink_window'],
  'bedroom':     ['media_player.upstairs_bedroom'],
  'kitchen':     ['media_player.living_room_speaker'],
  'dining':      ['media_player.living_room_speaker'],
  'home group':  ['media_player.home_group'],
};

const DEFAULT_AREA_OCCUPANCY = {
  'kitchen':  'binary_sensor.everything_presence_lite_5c0db4_occupancy',
  'office':   'binary_sensor.everything_presence_lite_4f1008_occupancy',
  'gym':      'binary_sensor.everything_presence_lite_5c0d08_occupancy',
  'bedroom':  'binary_sensor.everything_presence_lite_5c0da4_occupancy',
  'basement': 'binary_sensor.everything_presence_lite_ab20a4_occupancy',
};

const DEFAULT_AREA_MOTION = {
  'front yard': 'binary_sensor.front_door_motion',
};

const DEFAULT_AREA_CO2 = {
  'kitchen': 'sensor.everything_presence_lite_5c0db4_co2',
  'office':  'sensor.everything_presence_lite_4f1008_co2',
  'gym':     'sensor.everything_presence_lite_5c0d08_co2',
};

// ── Load layout (dynamic if available, else hardcoded defaults) ────────────────

function loadLayout() {
  try {
    const data = JSON.parse(fs.readFileSync(LAYOUT_PATH, 'utf8'));
    return {
      AREA_SPEAKERS:  data.speakers  || DEFAULT_AREA_SPEAKERS,
      AREA_OCCUPANCY: data.occupancy || DEFAULT_AREA_OCCUPANCY,
      AREA_MOTION:    data.motion    || DEFAULT_AREA_MOTION,
      AREA_CO2:       data.co2       || DEFAULT_AREA_CO2,
      _source: 'layout.json',
      _updated: data._updated || 'unknown',
    };
  } catch {
    return {
      AREA_SPEAKERS:  DEFAULT_AREA_SPEAKERS,
      AREA_OCCUPANCY: DEFAULT_AREA_OCCUPANCY,
      AREA_MOTION:    DEFAULT_AREA_MOTION,
      AREA_CO2:       DEFAULT_AREA_CO2,
      _source: 'hardcoded-defaults',
    };
  }
}

const layout = loadLayout();

// ── Settings (preferred areas) ─────────────────────────────────────────────────

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveSettings(settings) {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n');
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function haFetch(endpoint, options = {}) {
  const res = await fetch(`${HA_URL}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`HA API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function getState(entityId) {
  return haFetch(`/api/states/${entityId}`);
}

// ── Commands ───────────────────────────────────────────────────────────────────

/**
 * Check if any tracked person is home.
 * Returns { anyHome: bool, persons: [{entity, state}] }
 */
async function checkPersonPresence() {
  const persons = [];
  for (const entity of PERSON_ENTITIES) {
    try {
      const state = await getState(entity);
      persons.push({ entity, state: state.state });
    } catch { persons.push({ entity, state: 'unknown' }); }
  }
  const anyHome = persons.some(p => p.state === 'home');
  return { anyHome, persons };
}

/**
 * Detect which areas are currently occupied.
 * Priority: (1) person entities — if ALL are 'away' and no sensor presence, house is empty.
 * (2) mmWave occupancy sensors, (3) motion sensors, (4) CO₂ levels.
 */
async function locate() {
  const occupied = new Set();
  const details = [];

  // Step 0: Check person entities (home/away from HA device tracker)
  const personStatus = await checkPersonPresence();
  details.push({ check: 'persons', ...personStatus });

  // Check mmWave occupancy sensors (primary — most reliable)
  for (const [area, sensorId] of Object.entries(layout.AREA_OCCUPANCY)) {
    try {
      const state = await getState(sensorId);
      if (state.state === 'on') {
        occupied.add(area);
        details.push({ area, reason: 'occupancy', sensor: sensorId });
      }
    } catch { /* sensor unavailable */ }
  }

  // Check motion sensors (secondary)
  for (const [area, sensorId] of Object.entries(layout.AREA_MOTION)) {
    try {
      const state = await getState(sensorId);
      if (state.state === 'on') {
        occupied.add(area);
        details.push({ area, reason: 'motion', sensor: sensorId });
      }
    } catch { /* sensor unavailable */ }
  }

  // Check CO2 sensors (tertiary — only if area not already detected)
  for (const [area, sensorId] of Object.entries(layout.AREA_CO2)) {
    if (occupied.has(area)) continue;
    try {
      const state = await getState(sensorId);
      const ppm = parseFloat(state.state);
      if (!isNaN(ppm) && ppm > CO2_OCCUPIED_THRESHOLD) {
        occupied.add(area);
        details.push({ area, reason: 'co2', ppm, sensor: sensorId });
      }
    } catch { /* sensor unavailable */ }
  }

  // If ALL persons are away AND no sensor-based presence, the house is empty
  const allAway = !personStatus.anyHome;
  const noSensorPresence = occupied.size === 0;
  const houseEmpty = allAway && noSensorPresence;

  const result = {
    houseEmpty,
    personsHome: personStatus.anyHome,
    occupied: [...occupied],
    details,
    fallback: houseEmpty ? null : (occupied.size === 0 ? DEFAULT_AREA : null),
    layoutSource: layout._source,
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * Trigger TTS on speakers in a specific area.
 */
async function announceToRoom(area, message) {
  const key = area.toLowerCase();
  const speakers = layout.AREA_SPEAKERS[key];
  if (!speakers || speakers.length === 0) {
    console.error(`ERROR: No speakers mapped for area "${area}". Known areas: ${Object.keys(layout.AREA_SPEAKERS).join(', ')}`);
    process.exit(1);
  }

  const results = [];
  for (const speaker of speakers) {
    try {
      await haFetch('/api/services/tts/speak', {
        method: 'POST',
        body: JSON.stringify({
          entity_id: TTS_ENTITY,
          media_player_entity_id: speaker,
          message,
          options: { voice: TTS_VOICE },
        }),
      });
      results.push({ speaker, status: 'ok' });
    } catch (err) {
      results.push({ speaker, status: 'error', error: err.message });
    }
  }

  const output = { area, message, results };
  console.log(JSON.stringify(output, null, 2));
  return output;
}

/**
 * Detect occupancy and speak in all occupied rooms.
 * Falls back to DEFAULT_AREA if no presence detected.
 * If priority is true (important/high-priority message), targets the Home Group
 * to ensure the message reaches all speakers.
 */
async function followAndSpeak(message, { priority = false } = {}) {
  const presence = await locate();

  let targetAreas;
  if (priority) {
    targetAreas = ['home group'];
  } else if (presence.houseEmpty) {
    // Everyone is away and no sensor presence — skip announcement
    const output = {
      occupiedAreas: [],
      targetAreas: [],
      priority,
      houseEmpty: true,
      message,
      announcements: [],
      note: 'House is empty (all persons away, no sensor presence). Skipping TTS.',
    };
    console.log(JSON.stringify(output, null, 2));
    return output;
  } else if (presence.occupied.length > 0) {
    // Apply preferred_areas priority when multiple rooms are occupied
    const settings = loadSettings();
    const preferred = Array.isArray(settings.preferred_areas) ? settings.preferred_areas : [];
    if (presence.occupied.length > 1 && preferred.length > 0) {
      const occupiedLower = presence.occupied.map(a => a.toLowerCase());
      const match = preferred.find(p => occupiedLower.includes(p.toLowerCase()));
      if (match) {
        // Use the original-cased area name from the occupied list
        const idx = occupiedLower.indexOf(match.toLowerCase());
        targetAreas = [presence.occupied[idx]];
      } else {
        targetAreas = presence.occupied;
      }
    } else {
      targetAreas = presence.occupied;
    }
  } else {
    targetAreas = [DEFAULT_AREA];
  }

  // Deduplicate speakers (e.g. kitchen and dining both map to living room)
  const seen = new Set();
  const announcements = [];

  for (const area of targetAreas) {
    const key = area.toLowerCase();
    const speakers = layout.AREA_SPEAKERS[key] || layout.AREA_SPEAKERS[DEFAULT_AREA.toLowerCase()];
    for (const speaker of speakers) {
      if (seen.has(speaker)) continue;
      seen.add(speaker);
      try {
        await haFetch('/api/services/tts/speak', {
          method: 'POST',
          body: JSON.stringify({
            entity_id: TTS_ENTITY,
            media_player_entity_id: speaker,
            message,
            options: { voice: TTS_VOICE },
          }),
        });
        announcements.push({ area, speaker, status: 'ok' });
      } catch (err) {
        announcements.push({ area, speaker, status: 'error', error: err.message });
      }
    }
  }

  const output = {
    occupiedAreas: presence.occupied,
    targetAreas,
    priority,
    message,
    announcements,
  };
  console.log(JSON.stringify(output, null, 2));
  return output;
}

// ── Layout Builder ─────────────────────────────────────────────────────────────

/**
 * Query HA Area and Device registries to dynamically build area→entity mappings.
 * Writes layout.json for subsequent runs to use.
 */
async function updateLayout() {
  // Fetch areas, devices, and entities from HA REST API
  const [areas, devices, entities] = await Promise.all([
    haFetch('/api/template', {
      method: 'POST',
      body: JSON.stringify({ template: '{{ areas() | list | tojson }}' }),
    }).then(r => typeof r === 'string' ? JSON.parse(r) : r),
    haFetch('/api/template', {
      method: 'POST',
      body: JSON.stringify({ template: '{{ states | map(attribute="entity_id") | list | tojson }}' }),
    }).then(r => typeof r === 'string' ? JSON.parse(r) : r),
    haFetch('/api/states'),
  ]);

  // Build entity lookup by entity_id
  const entityMap = {};
  for (const e of entities) entityMap[e.entity_id] = e;

  // For each area, find speakers, occupancy sensors, motion sensors, and CO2 sensors
  const speakers = {};
  const occupancy = {};
  const motion = {};
  const co2 = {};

  // Fetch area→entity mapping via template for each area
  for (const areaId of areas) {
    let areaEntities;
    try {
      const raw = await haFetch('/api/template', {
        method: 'POST',
        body: JSON.stringify({ template: `{{ area_entities('${areaId}') | list | tojson }}` }),
      });
      areaEntities = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch { continue; }

    // Get friendly area name from any entity in this area, or use the area ID
    let areaName = areaId;
    for (const eid of areaEntities) {
      const ent = entityMap[eid];
      if (ent && ent.attributes && ent.attributes.friendly_name) {
        // HA area IDs are slug-like; use the ID itself as the key (lowercase)
        break;
      }
    }
    const key = areaName.toLowerCase().replace(/_/g, ' ');

    for (const eid of areaEntities) {
      // Speakers: media_player entities
      if (eid.startsWith('media_player.')) {
        if (!speakers[key]) speakers[key] = [];
        if (!speakers[key].includes(eid)) speakers[key].push(eid);
      }
      // mmWave occupancy: binary_sensor with 'occupancy' in entity_id
      if (eid.startsWith('binary_sensor.') && eid.includes('occupancy')) {
        occupancy[key] = eid;
      }
      // Motion sensors: binary_sensor with 'motion' in entity_id
      if (eid.startsWith('binary_sensor.') && eid.includes('motion')) {
        motion[key] = eid;
      }
      // CO2 sensors: sensor with 'co2' in entity_id
      if (eid.startsWith('sensor.') && eid.includes('co2')) {
        co2[key] = eid;
      }
    }
  }

  // Preserve the home group speaker if not discovered
  if (!speakers['home group'] && DEFAULT_AREA_SPEAKERS['home group']) {
    speakers['home group'] = DEFAULT_AREA_SPEAKERS['home group'];
  }

  const layoutData = {
    _updated: new Date().toISOString(),
    _areas: areas,
    speakers,
    occupancy,
    motion,
    co2,
  };

  fs.writeFileSync(LAYOUT_PATH, JSON.stringify(layoutData, null, 2));
  console.log(JSON.stringify({ status: 'ok', path: LAYOUT_PATH, ...layoutData }, null, 2));
  return layoutData;
}

// ── CLI ────────────────────────────────────────────────────────────────────────

const [,, command, ...args] = process.argv;

(async () => {
  try {
    switch (command) {
      case 'locate':
        await locate();
        break;

      case 'announce': {
        const area = args[0];
        const message = args.slice(1).join(' ');
        if (!area || !message) {
          console.error('Usage: presence.js announce <area> <message>');
          process.exit(1);
        }
        await announceToRoom(area, message);
        break;
      }

      case 'follow-and-speak': {
        const priority = args.includes('--priority');
        const message = args.filter(a => a !== '--priority').join(' ');
        if (!message) {
          console.error('Usage: presence.js follow-and-speak [--priority] <message>');
          process.exit(1);
        }
        await followAndSpeak(message, { priority });
        break;
      }

      case 'update-layout':
        await updateLayout();
        break;

      case 'set-preference': {
        const input = args.join(' ');
        if (!input) {
          console.error('Usage: presence.js set-preference "Office,Gym,Bedroom"');
          process.exit(1);
        }
        const newPreferred = input.split(',').map(s => s.trim()).filter(Boolean);
        const settings = loadSettings();
        settings.preferred_areas = newPreferred;
        saveSettings(settings);
        console.log(JSON.stringify({ status: 'ok', preferred_areas: newPreferred }));
        break;
      }

      default:
        console.error('Commands: locate | announce <area> <message> | follow-and-speak [--priority] <message> | update-layout | set-preference <areas>');
        process.exit(1);
    }
  } catch (err) {
    console.error('FATAL:', err.message);
    process.exit(1);
  }
})();
