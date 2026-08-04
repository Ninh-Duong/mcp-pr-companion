import { DataStore } from '../src/core/storage/data.store.js';
import { RawPRRevision } from '../src/core/bitbucket/bitbucket.types.js';
import { StableSerializer } from '../src/core/storage/stable.serializer.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string) {
  if (condition) {
    console.log(`  ✓ ${testName}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${testName}`);
    failed++;
  }
}

async function runBenchmarkTests() {
  console.log('\n================================================================');
  console.log('                 Running Schema v4.0 Performance Benchmark      ');
  console.log('================================================================\n');

  // 1. Mock Raw Revision Data
  const sampleRawRev: RawPRRevision = {
    metadata: {
      id: 4565,
      title: 'Add test comment above CRCController constructor',
      description: 'Updating controller constructor comment',
      state: 'OPEN',
      source: { branch: { name: 'feature/WCE-815' }, commit: { hash: 'a381cc82f8b4a381cc82f8b4a381cc82f8b4a381' } },
      destination: { branch: { name: 'main' }, commit: { hash: 'b921ef11c990b921ef11c990b921ef11c990b921' } }
    },
    commits: [
      { hash: 'a381cc82f8b4a381cc82f8b4a381cc82f8b4a381', message: 'WCE-815: Add test comment above CRCController' }
    ],
    diffstat: [
      { new: { path: 'src/Backend/Controllers/CRCController.cs' }, status: 'modified', lines_added: 1, lines_removed: 0 }
    ],
    rawDiff: 'diff --git a/src/Backend/Controllers/CRCController.cs b/src/Backend/Controllers/CRCController.cs\n+ // test comment',
    sourceHash: 'a381cc82f8b4a381cc82f8b4a381cc82f8b4a381',
    destinationHash: 'b921ef11c990b921ef11c990b921ef11c990b921',
    coverage: { metadata: 'complete', commits: 'complete', diffstat: 'complete', diff: 'complete' },
    warnings: []
  };

  // 2. Persist Schema v4.0 Manifest & Check Size
  const result = DataStore.saveRevision('siliconstack', 'wec.be', 4565, sampleRawRev);
  const manifestJsonStr = StableSerializer.stringify(result.manifest);
  const manifestSizeBytes = Buffer.byteLength(manifestJsonStr, 'utf-8');

  console.log(`  📊 Generated Agent Manifest v4.0 Size: ${manifestSizeBytes} bytes (~${(manifestSizeBytes / 1024).toFixed(2)} KB)`);

  assert(result.manifest.schema_version === '4.0', 'Manifest uses Schema v4.0');
  assert(manifestSizeBytes < 2500, 'Small PR Manifest size is under 2.5 KB (Target: 1-2 KB)');

  // 3. Stable Serializer & Deterministic Content Hash Test
  console.log('\n2. Deterministic Hash & Disk Write Optimization:');
  const hash1 = StableSerializer.computeContentHash(result.manifest);
  const hash2 = StableSerializer.computeContentHash(result.manifest);
  assert(hash1 === hash2, 'StableSerializer produces deterministic hash across calls');

  console.log('\n================================================================');
  console.log(`Benchmark Test Results: ${passed} Passed | ${failed} Failed`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runBenchmarkTests();
