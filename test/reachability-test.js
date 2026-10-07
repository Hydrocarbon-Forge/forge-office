// test/reachability-test.js — Reachability assertion for doors, desks, spawns, and archives shelves
const assert = require('node:assert');
require('../web/map.js');

function runReachabilityTest() {
  console.log('--- Starting Office Reachability Test ---');
  const map = new OfficeMap();

  const spawn = { x: 21 * 32 + 16, y: 17 * 32 + 16 }; // Lobby player spawn
  console.log(`Lobby spawn at (${spawn.x}, ${spawn.y}) [tile 21, 17]`);

  // Assert spawn itself is not solid
  assert.strictEqual(map.isSolid(21, 17), false, 'Spawn tile must not be solid');

  let checkedTargets = 0;

  // 1. Check all doors
  console.log(`Checking ${map.doors.length} doors...`);
  for (const door of map.doors) {
    const path = map.findPath(spawn.x, spawn.y, door.x, door.y);
    assert(path && path.length > 0, `Door ${door.name} at (${door.tileX}, ${door.tileY}) must be reachable from spawn`);
    checkedTargets++;
  }
  console.log(`PASS: All ${map.doors.length} doors reachable.`);

  // 2. Check all waypoints
  const waypoints = Object.entries(map.waypoints);
  console.log(`Checking ${waypoints.length} named waypoints...`);
  for (const [name, wp] of waypoints) {
    const path = map.findPath(spawn.x, spawn.y, wp.x, wp.y);
    assert(path && path.length > 0, `Waypoint ${name} at (${wp.x}, ${wp.y}) must be reachable from spawn`);
    checkedTargets++;
  }
  console.log(`PASS: All ${waypoints.length} waypoints reachable.`);

  // 2b. Assert meeting room door and waypoints are present
  assert(map.doors.some(d => d.name === 'meeting_room'), 'Meeting room door must exist');
  assert(map.waypoints['meeting_room'], 'meeting_room waypoint must exist');
  assert(map.waypoints['meeting_table'], 'meeting_table waypoint must exist');
  assert(map.waypoints['meeting_dock'], 'meeting_dock waypoint must exist');
  console.log('PASS: Meeting room door and waypoints explicitly verified.');

  // 3. Check C6 Desk front
  const c6Front = { x: 21 * 32 + 16, y: 14 * 32 + 16 };
  const c6Path = map.findPath(spawn.x, spawn.y, c6Front.x, c6Front.y);
  assert(c6Path && c6Path.length > 0, 'C6 front desk must be reachable');
  checkedTargets++;
  console.log('PASS: C6 desk reachable.');

  // 4. Check initial archives shelves
  console.log(`Checking ${map.shelves.length} archive shelves access tiles...`);
  for (const shelf of map.shelves) {
    const accessX = shelf.accessX * 32 + 16;
    const accessY = shelf.accessY * 32 + 16;
    const path = map.findPath(spawn.x, spawn.y, accessX, accessY);
    assert(path && path.length > 0, `Shelf at (${shelf.tileX}, ${shelf.tileY}) access tile (${shelf.accessX}, ${shelf.accessY}) must be reachable`);
    checkedTargets++;
  }
  console.log(`PASS: All ${map.shelves.length} initial archive shelf access tiles reachable.`);

  // 5. Check dynamic archives expansion (simulate 40 projects)
  const fakeProjects = Array.from({ length: 40 }, (_, i) => ({
    name: `Project ${i + 1}`,
    tags: ['test']
  }));
  map.populateProjects(fakeProjects);
  console.log(`Expanded archives to ${map.height} tiles tall, total shelves: ${map.shelves.length}. Testing access...`);
  for (const shelf of map.shelves) {
    const accessX = shelf.accessX * 32 + 16;
    const accessY = shelf.accessY * 32 + 16;
    const path = map.findPath(spawn.x, spawn.y, accessX, accessY);
    assert(path && path.length > 0, `Expanded shelf at (${shelf.tileX}, ${shelf.tileY}) access tile must be reachable`);
    checkedTargets++;
  }
  console.log(`PASS: All ${map.shelves.length} shelves reachable after dynamic expansion.`);

  console.log(`\n--- ALL ${checkedTargets} REACHABILITY TARGETS PASSED ---`);
}

runReachabilityTest();
