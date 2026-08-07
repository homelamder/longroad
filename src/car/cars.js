// The roster. One entry per car: physics on top of its class base, styling for the
// generator, and where in the world it waits. Adding a car is one entry here.
//
// To use a real 3D model instead of the generated body, add `model: '/cars/x.glb'`
// and drop the file in public/cars/ — the garage falls back to the generated body
// if the file is missing. That is the whole "unlimited cars" pipeline.

// Class bases: the feel of each archetype. Individual cars nudge from here.
const BASE = {
  hatch: { power: 6.8, topSpeed: 44, brake: 13, grip: 5.6, steerRate: 2.3, rideHeight: 0.5, wheelBase: 2.5, track: 1.62, wheelR: 0.34 },
  muscle: { power: 10.5, topSpeed: 56, brake: 13, grip: 4.6, steerRate: 2.0, rideHeight: 0.46, wheelBase: 2.9, track: 1.8, wheelR: 0.37 },
  suv: { power: 7.6, topSpeed: 47, brake: 13.5, grip: 5.2, steerRate: 2.05, rideHeight: 0.68, wheelBase: 2.95, track: 1.84, wheelR: 0.42 },
  pickup: { power: 7.5, topSpeed: 46, brake: 13, grip: 5.2, steerRate: 2.15, rideHeight: 0.62, wheelBase: 3.05, track: 1.86, wheelR: 0.42 },
  offroader: { power: 8.2, topSpeed: 44, brake: 14, grip: 5.4, steerRate: 2.2, rideHeight: 0.78, wheelBase: 2.8, track: 1.9, wheelR: 0.47 },
  rally: { power: 9.6, topSpeed: 52, brake: 14.5, grip: 6.0, steerRate: 2.5, rideHeight: 0.52, wheelBase: 2.62, track: 1.72, wheelR: 0.36 },
  van: { power: 6.4, topSpeed: 40, brake: 12.5, grip: 4.9, steerRate: 1.9, rideHeight: 0.6, wheelBase: 3.2, track: 1.8, wheelR: 0.38 },
  supercar: { power: 13.5, topSpeed: 66, brake: 15.5, grip: 6.4, steerRate: 2.4, rideHeight: 0.34, wheelBase: 2.7, track: 1.94, wheelR: 0.35 },
};

// where: null = owned from the start
//        { station: n }  = waiting beside the nth fuel station
//        { hidden: metres-along, side, dist } = parked off-road, found by exploring
export const ROSTER = [
  {
    id: 'trailhand', name: 'Trailhand', class: 'pickup', where: null,
    body: { paint: 0x2f5d4a, bullbar: true },
    blurb: 'The honest one. It starts, it climbs, it carries.',
  },
  {
    id: 'petrel', name: 'Petrel', class: 'hatch', where: { station: 1 },
    body: { paint: 0xd8b13a }, tweak: { steerRate: 2.4 },
    blurb: 'Light on the road, light on fuel nerves.',
  },
  {
    id: 'longhorn', name: 'Longhorn', class: 'muscle', where: { station: 3 },
    body: { paint: 0x8c2a1e, stripe: 0xf2ead8 }, tweak: { power: 11.2 },
    blurb: 'Straight roads were invented for this.',
  },
  {
    id: 'cairn', name: 'Cairn', class: 'suv', where: { station: 5 },
    body: { paint: 0x4a5b6b, roofrack: true },
    blurb: 'Room for everything the journey collects.',
  },
  {
    id: 'ibex', name: 'Ibex', class: 'offroader', where: { station: 7 },
    body: { paint: 0x746b48, bullbar: true, roofrack: true, fatTyres: true },
    blurb: 'The mountain is a suggestion.',
  },
  {
    id: 'kestrel', name: 'Kestrel', class: 'rally', where: { station: 9 },
    body: { paint: 0x2662a8, stripe: 0xe8e4da, rimDark: true }, tweak: { grip: 6.2 },
    blurb: 'Corners taken as written, then faster.',
  },
  {
    id: 'drover', name: 'Drover', class: 'van', where: { station: 11 },
    body: { paint: 0xb7b3a8 },
    blurb: 'Slow, sure, and the heater works.',
  },
  // The hidden ones — parked where only a wanderer goes.
  {
    id: 'fenwing', name: 'Fenwing', class: 'hatch', where: { hidden: 1750, side: -1, dist: 210 },
    body: { paint: 0x77a05c, rimDark: true }, tweak: { topSpeed: 47 },
    blurb: 'Left in a meadow with the keys in it.',
  },
  {
    id: 'ember', name: 'Ember', class: 'muscle', where: { hidden: 5900, side: 1, dist: 260 },
    body: { paint: 0x30292b, stripe: 0xc25c28, finish: 'matte' }, tweak: { power: 12 },
    blurb: 'Someone drove it into the desert and walked away.',
  },
  {
    id: 'bray', name: 'Bray', class: 'offroader', where: { hidden: 3800, side: 1, dist: 240 },
    body: { paint: 0x5d4a2e, bullbar: true, fatTyres: true }, tweak: { rideHeight: 0.84 },
    blurb: 'Found axle-deep in pine litter, still willing.',
  },
  {
    id: 'mistral', name: 'Mistral', class: 'rally', where: { hidden: 7900, side: -1, dist: 230 },
    body: { paint: 0xd8d3c8, stripe: 0x2662a8 }, tweak: { steerRate: 2.6 },
    blurb: 'The rainforest kept it oiled.',
  },
  {
    id: 'corniche', name: 'Corniche', class: 'supercar', where: { hidden: 10480, side: 1, dist: 80 },
    body: { paint: 0xc8cdd4, finish: 'pearl' },
    blurb: 'Abandoned at the top of the pass. Ask the snow why.',
  },
  {
    id: 'heron-grey', name: 'Heron Grey', class: 'suv', where: { hidden: 12250, side: -1, dist: 200 },
    body: { paint: 0x5c6862, roofrack: true }, tweak: { grip: 5.5 },
    blurb: 'The marsh mist suits it.',
  },
  {
    id: 'cinder', name: 'Cinder', class: 'supercar', where: { hidden: 14350, side: 1, dist: 60 },
    body: { paint: 0x1f1b1c, finish: 'matte', stripe: 0xff5a1e, rimDark: true },
    tweak: { power: 14, topSpeed: 70 },
    blurb: 'Black as the ash it sleeps under. The fastest thing on the road.',
  },
  {
    id: 'wren', name: 'Wren', class: 'van', where: { hidden: 900, side: 1, dist: 190 },
    body: { paint: 0x9a5a3c, roofrack: true },
    blurb: 'A meadow camper someone never came back for.',
  },
];

// Resolve a roster entry into a full physics spec the Car class accepts.
export function specFor(entry) {
  return {
    id: entry.id, name: entry.name, class: entry.class,
    reverseTop: 11, drag: 0.0008, roll: 0.035,
    ...BASE[entry.class],
    ...(entry.tweak || {}),
    body: entry.body,
    model: entry.model,
  };
}
