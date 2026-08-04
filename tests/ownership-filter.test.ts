import assert from 'assert';
import { AccountPolicy, ALLOWED_BITBUCKET_EMAIL } from '../src/core/auth/account-policy.js';
import { normalizeUuid } from '../src/core/auth/current-user.resolver.js';
import { PROwnershipPolicy } from '../src/core/auth/pr-ownership.policy.js';
import { PRViewFilter } from '../src/core/discovery/pr-view-filter.js';
import { PRFilterBuilder } from '../src/core/discovery/pr-filter.builder.js';
import { DiscoveryCache } from '../src/core/discovery/discovery-cache.js';
import { DiscoveredPR } from '../src/core/discovery/pr-list.normalizer.js';

async function runOwnershipAndFilterTests() {
  console.log('\n================================================================');
  console.log('       Running Ownership, Filter & Identity Unit Tests         ');
  console.log('================================================================\n');

  // 1. Account Policy Tests
  console.log('1. Account Policy Validation:');
  assert(AccountPolicy.isEmailAllowed(ALLOWED_BITBUCKET_EMAIL), 'Allowed email is accepted');
  assert(AccountPolicy.isEmailAllowed(' NINH.DUONG@siliconstack.com.au '), 'Email normalization handles uppercase & whitespace');
  assert(!AccountPolicy.isEmailAllowed('other.user@siliconstack.com.au'), 'Unallowed email is rejected');
  console.log('  ✓ AccountPolicy enforces ninh.duong@siliconstack.com.au restriction');

  // 2. UUID Normalization Tests
  console.log('\n2. UUID Normalization:');
  const rawUuid = '{12345678-ABCD-efgh-9999}';
  const norm = normalizeUuid(rawUuid);
  assert(norm === '12345678-abcd-efgh-9999', 'normalizeUuid strips braces and converts to lowercase');
  assert(normalizeUuid(null) === '', 'normalizeUuid handles null gracefully');
  console.log('  ✓ normalizeUuid normalizes raw Bitbucket UUIDs accurately');

  // 3. PROwnershipPolicy Tests
  console.log('\n3. PROwnershipPolicy Validation:');
  const userUuid = '{user-uuid-1234}';
  const matchingAuthor = 'user-uuid-1234';
  const foreignAuthor = '{user-uuid-5678}';

  assert(PROwnershipPolicy.belongsToUser(matchingAuthor, userUuid), 'Matching author UUID passes ownership policy');
  assert(!PROwnershipPolicy.belongsToUser(foreignAuthor, userUuid), 'Foreign author UUID fails ownership policy');
  assert(!PROwnershipPolicy.belongsToUser(null, userUuid), 'Null author UUID fails ownership policy');
  console.log('  ✓ PROwnershipPolicy isolates PR ownership by user UUID');

  // 4. PRFilterBuilder Query Security Test
  console.log('\n4. PRFilterBuilder Strict UUID Querying:');
  const query = PRFilterBuilder.buildQuery(userUuid);
  assert(query === 'state="OPEN" AND author.uuid="{user-uuid-1234}"', 'PRFilterBuilder generates author.uuid query');
  
  let emptyUuidError = false;
  try {
    PRFilterBuilder.buildQuery('');
  } catch {
    emptyUuidError = true;
  }
  assert(emptyUuidError, 'PRFilterBuilder throws error when passed empty UUID');
  console.log('  ✓ PRFilterBuilder prevents un-scoped OPEN queries');

  // 5. PRViewFilter (Ready / Draft / All) Tests
  console.log('\n5. PRViewFilter Readiness Filtering:');
  const mockPRs: DiscoveredPR[] = [
    { id: 1, title: 'Ready PR 1', state: 'OPEN', isDraft: false, sourceBranch: 'b1', targetBranch: 'main', updatedOn: '2026-08-01', authorUuid: 'user-uuid-1234', cacheStatus: 'Missing' },
    { id: 2, title: 'Draft PR 2', state: 'OPEN', isDraft: true, sourceBranch: 'b2', targetBranch: 'main', updatedOn: '2026-08-02', authorUuid: 'user-uuid-1234', cacheStatus: 'Missing' },
    { id: 3, title: 'Foreign PR 3', state: 'OPEN', isDraft: false, sourceBranch: 'b3', targetBranch: 'main', updatedOn: '2026-08-03', authorUuid: 'other-uuid-9999', cacheStatus: 'Missing' },
    { id: 4, title: 'Merged PR 4', state: 'MERGED', isDraft: false, sourceBranch: 'b4', targetBranch: 'main', updatedOn: '2026-08-04', authorUuid: 'user-uuid-1234', cacheStatus: 'Missing' }
  ];

  const readyPRs = PRViewFilter.apply(mockPRs, 'user-uuid-1234', 'ready');
  assert(readyPRs.length === 1 && readyPRs[0].id === 1, 'Ready filter returns only owned OPEN non-draft PRs');

  const draftPRs = PRViewFilter.apply(mockPRs, 'user-uuid-1234', 'draft');
  assert(draftPRs.length === 1 && draftPRs[0].id === 2, 'Draft filter returns only owned OPEN draft PRs');

  const allPRs = PRViewFilter.apply(mockPRs, 'user-uuid-1234', 'all');
  assert(allPRs.length === 2 && allPRs.some(p => p.id === 1) && allPRs.some(p => p.id === 2), 'All filter returns both Ready and Draft owned OPEN PRs');
  assert(!allPRs.some(p => p.id === 3 || p.id === 4), 'All filter excludes foreign author and non-OPEN PRs');
  console.log('  ✓ PRViewFilter filters Ready, Draft, and All PRs with mandatory ownership isolation');

  // 6. Scoped DiscoveryCache Tests
  console.log('\n6. Scoped DiscoveryCache Isolation:');
  const scopeA = 'user-a';
  const scopeB = 'user-b';
  const ws = 'workspace';
  const repo = 'repo';

  DiscoveryCache.setPRs(scopeA, ws, repo, [mockPRs[0]]);
  DiscoveryCache.setPRs(scopeB, ws, repo, [mockPRs[1]]);

  const prsA = DiscoveryCache.getPRs(scopeA, ws, repo);
  const prsB = DiscoveryCache.getPRs(scopeB, ws, repo);

  assert(prsA.length === 1 && prsA[0].id === 1, 'User A retrieves User A cached PRs');
  assert(prsB.length === 1 && prsB[0].id === 2, 'User B retrieves User B cached PRs');

  DiscoveryCache.clearAll();
  assert(DiscoveryCache.getPRs(scopeA, ws, repo).length === 0, 'DiscoveryCache clearAll purges all scopes');
  console.log('  ✓ DiscoveryCache isolates cache entries by user UUID and repository scope');

  console.log('\n================================================================');
  console.log('Test Results: All Ownership & Filter Tests Passed!');
  console.log('================================================================\n');
}

runOwnershipAndFilterTests().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
