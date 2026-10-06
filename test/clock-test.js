// test/clock-test.js — Plain node unit test for presence and clock-in/out logic
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');

// Point to a safe scratch test clock file
const TEST_DIR = path.join(__dirname, 'scratch');
if (!fs.existsSync(TEST_DIR)) {
  fs.mkdirSync(TEST_DIR, { recursive: true });
}
const TEST_CLOCK_FILE = path.join(TEST_DIR, 'test-clock.json');
const TEST_PROFILES_FILE = path.join(TEST_DIR, 'test-profiles.json');

// Clean before starting
if (fs.existsSync(TEST_CLOCK_FILE)) fs.unlinkSync(TEST_CLOCK_FILE);
if (fs.existsSync(TEST_PROFILES_FILE)) fs.unlinkSync(TEST_PROFILES_FILE);

process.env.CLOCK_FILE = TEST_CLOCK_FILE;
process.env.PROFILES_FILE = TEST_PROFILES_FILE;

const { ClockManager } = require('../clock-manager.js');

async function runClockTest() {
  console.log('--- Starting Clock Manager Unit Test ---');

  const mgr = new ClockManager(TEST_CLOCK_FILE, TEST_PROFILES_FILE);

  let mockNow = 1000000;

  // 1. Initial assertion
  let pres = mgr.getPresenceAndStats();
  assert.strictEqual(pres.online.length, 0, 'Initially zero users online');
  assert.strictEqual(pres.stats.nathan.sessions, 0, 'Nathan initial sessions 0');
  assert.strictEqual(pres.stats.gavin.sessions, 0, 'Gavin initial sessions 0');
  console.log('PASS: Initial presence empty');

  // 2. Nathan joins alone at t = 1,000,000
  mgr.clockIn('Nathan', 'client-a1', mockNow);
  pres = mgr.getPresenceAndStats();
  assert.strictEqual(pres.online.length, 1);
  assert.strictEqual(pres.online[0].profile, 'nathan');
  assert.strictEqual(pres.stats.nathan.sessions, 1);
  assert.strictEqual(pres.stats.nathan.sessions_with, 0, 'Nathan joined alone');
  console.log('PASS: Nathan joined alone (sessions=1, sessions_with=0)');

  // 3. Advance time by 50,000ms -> Gavin joins at t = 1,050,000
  mockNow += 50000;
  mgr.clockIn('Gavin', 'client-b1', mockNow);
  pres = mgr.getPresenceAndStats();
  assert.strictEqual(pres.online.length, 2, 'Both Nathan and Gavin online');
  assert.strictEqual(pres.stats.gavin.sessions, 1, 'Gavin session count 1');
  assert.strictEqual(pres.stats.gavin.sessions_with, 1, 'Gavin session has Nathan');
  assert.strictEqual(pres.stats.nathan.sessions_with, 1, 'Nathan session updated to reflect Gavin joined');
  console.log('PASS: Gavin joined while Nathan was online (both sessions_with=1)');

  // 4. Advance time by 30,000ms -> Nathan leaves at t = 1,080,000
  mockNow += 30000;
  mgr.clockOut('Nathan', 'client-a1', mockNow);
  pres = mgr.getPresenceAndStats();
  assert.strictEqual(pres.online.length, 1, 'Only Gavin online');
  assert.strictEqual(pres.online[0].profile, 'gavin');
  assert.strictEqual(pres.stats.nathan.sessions, 1);
  assert.strictEqual(pres.stats.nathan.total_ms, 80000, 'Nathan session duration = 80,000ms');
  assert.strictEqual(pres.stats.nathan.longest_ms, 80000);
  assert.strictEqual(pres.stats.nathan.sessions_with, 1);
  console.log('PASS: Nathan left at t=1080000 (total_ms=80000, longest_ms=80000)');

  // 5. Advance time by 40,000ms -> Gavin leaves at t = 1,120,000
  mockNow += 40000;
  mgr.clockOut('Gavin', 'client-b1', mockNow);
  pres = mgr.getPresenceAndStats();
  assert.strictEqual(pres.online.length, 0, 'Nobody online');
  assert.strictEqual(pres.stats.gavin.sessions, 1);
  assert.strictEqual(pres.stats.gavin.total_ms, 70000, 'Gavin session duration = 70,000ms (1050000 to 1120000)');
  assert.strictEqual(pres.stats.gavin.longest_ms, 70000);
  assert.strictEqual(pres.stats.gavin.sessions_with, 1);
  console.log('PASS: Gavin left at t=1120000 (total_ms=70000, longest_ms=70000)');

  // 6. Scripted interleaving: Nathan joins alone for a 2nd session at t = 1,200,000
  mockNow = 1200000;
  mgr.clockIn('Nathan', 'client-a2', mockNow);
  mockNow += 20000;
  mgr.clockOut('Nathan', 'client-a2', mockNow);
  pres = mgr.getPresenceAndStats();
  assert.strictEqual(pres.stats.nathan.sessions, 2, 'Nathan session count now 2');
  assert.strictEqual(pres.stats.nathan.total_ms, 100000, 'Nathan total ms accumulated to 100,000ms');
  assert.strictEqual(pres.stats.nathan.longest_ms, 80000, 'Longest session remains 80,000ms');
  assert.strictEqual(pres.stats.nathan.sessions_with, 1, 'sessions_with remains 1 (2nd session was alone)');
  console.log('PASS: Nathan 2nd solo session verified (sessions=2, total_ms=100000, sessions_with=1)');

  // 7. Verify atomic persistence by loading a fresh manager from disk
  const freshMgr = new ClockManager(TEST_CLOCK_FILE, TEST_PROFILES_FILE);
  const freshPres = freshMgr.getPresenceAndStats();
  assert.deepStrictEqual(freshPres.stats.nathan, pres.stats.nathan, 'Persisted clock state matches in-memory');
  assert.deepStrictEqual(freshPres.stats.gavin, pres.stats.gavin, 'Persisted clock state matches in-memory');
  console.log('PASS: Atomic file persistence verified');

  // 8. Clean up test file so no scratch artifacts pollute repo
  if (fs.existsSync(TEST_CLOCK_FILE)) fs.unlinkSync(TEST_CLOCK_FILE);
  if (fs.existsSync(TEST_PROFILES_FILE)) fs.unlinkSync(TEST_PROFILES_FILE);
  try { fs.rmdirSync(TEST_DIR); } catch {}

  console.log('--- ALL CLOCK TESTS PASSED ---');
}

runClockTest().catch(err => {
  console.error('FAIL: Clock test crashed:', err);
  process.exit(1);
});
