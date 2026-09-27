import assert from 'node:assert/strict';
import test from 'node:test';
import { getUsMarketStatus } from '../stockwatch.js';

test('reports the regular U.S. session as open in Eastern daylight time', () => {
  assert.deepEqual(getUsMarketStatus(new Date('2026-09-28T14:00:00.000Z')), {
    isOpen: true,
    detail: 'Open (U.S. regular session)',
  });
});

test('reports pre-market as closed', () => {
  assert.deepEqual(getUsMarketStatus(new Date('2026-09-28T13:00:00.000Z')), {
    isOpen: false,
    detail: 'Closed (pre-market)',
  });
});

test('reports weekends and exchange holidays as closed', () => {
  assert.equal(getUsMarketStatus(new Date('2026-09-26T15:00:00.000Z')).isOpen, false);
  assert.equal(getUsMarketStatus(new Date('2026-11-26T16:00:00.000Z')).detail, 'Closed (U.S. market holiday)');
});

test('uses the 1 p.m. Eastern early close after Thanksgiving', () => {
  assert.equal(getUsMarketStatus(new Date('2026-11-27T17:30:00.000Z')).isOpen, true);
  assert.equal(getUsMarketStatus(new Date('2026-11-27T18:30:00.000Z')).detail, 'Closed (after early close)');
});

test('handles the Eastern standard-time offset', () => {
  assert.equal(getUsMarketStatus(new Date('2026-01-05T15:00:00.000Z')).isOpen, true);
});
