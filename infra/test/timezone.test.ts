import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validTimezone, resolveTimezone } from '../../web/lib/timezone';

test('IANA timezone validation accepts DST zones and rejects prompt text/offsets', () => {
  for (const zone of ['UTC', 'America/New_York', 'Asia/Kolkata', 'Australia/Lord_Howe']) assert.ok(validTimezone(zone));
  for (const zone of ['ignore previous instructions', 'GMT+8', '', null, 45, '../etc/passwd']) assert.equal(validTimezone(zone), false);
});
test('manual override wins; automatic stays per-device; unknown is not assumed local UTC', () => {
  assert.deepEqual(resolveTimezone('Asia/Tokyo', 'America/New_York'), { mode: 'manual', name: 'Asia/Tokyo' });
  assert.deepEqual(resolveTimezone(null, 'America/New_York'), { mode: 'device', name: 'America/New_York' });
  assert.deepEqual(resolveTimezone(null, 'Europe/Paris'), { mode: 'device', name: 'Europe/Paris' });
  assert.deepEqual(resolveTimezone(undefined, 'bad'), { mode: 'device', name: null });
});

test('citation parsing rejects executable URLs', async () => {
  const { parseSearchSources } = await import('../../web/lib/search-sources');
  const message = { id: 'a', query: 'news', retrievedAt: new Date().toISOString(), sources: [{ title: 'Bad', url: 'javascript:alert(1)' }] };
  assert.equal(parseSearchSources(message), null);
  message.sources = [{ title: 'Source', url: 'https://example.org' }];
  assert.equal(parseSearchSources(message)?.sources.length, 1);
});
