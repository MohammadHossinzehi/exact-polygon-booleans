import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Q from '../src/rational.js';

test('normalization makes equal values identical', () => {
  assert.deepEqual(Q.rat(6n, -4n), Q.rat(-3n, 2n));
  assert.equal(Q.key(Q.rat(0n, -7n)), '0');
  assert.equal(Q.key(Q.rat(10n, 5n)), '2');
});

test('doubles convert exactly, bit for bit', () => {
  assert.equal(Q.key(Q.fromNumber(0.5)), '1/2');
  assert.equal(Q.key(Q.fromNumber(0.1)), '3602879701896397/36028797018963968');
  assert.equal(Q.key(Q.fromNumber(-3)), '-3');
  assert.equal(Q.key(Q.fromNumber(2 ** 60)), (2n ** 60n).toString());
  assert.equal(Q.key(Q.fromNumber(5e-324)), `1/${2n ** 1074n}`);
  // 0.1 + 0.2 is not 0.3 in floating point, and exact arithmetic sees that.
  assert.notDeepEqual(Q.add(Q.fromNumber(0.1), Q.fromNumber(0.2)), Q.fromNumber(0.3));
  assert.deepEqual(Q.fromNumber(0.1 + 0.2), Q.fromNumber(0.30000000000000004));
});

test('round trip through toNumber is the identity for doubles', () => {
  for (const x of [0, 1, -1, 0.1, 1 / 3, Math.PI, -1e-310, 1.7976931348623157e308, 123456.789e-200]) {
    assert.equal(Q.toNumber(Q.fromNumber(x)), x);
  }
});

test('string parsing is exact', () => {
  assert.equal(Q.key(Q.fromString('0.1')), '1/10');
  assert.equal(Q.key(Q.fromString('-2.75')), '-11/4');
  assert.equal(Q.key(Q.fromString('1e-3')), '1/1000');
  assert.equal(Q.key(Q.fromString('7/-3')), '-7/3');
  assert.equal(Q.key(Q.fromString('.5')), '1/2');
  assert.throws(() => Q.fromString('abc'));
  assert.throws(() => Q.fromString('.'));
});

test('field operations and comparison', () => {
  const a = Q.rat(1n, 3n);
  const b = Q.rat(1n, 6n);
  assert.equal(Q.key(Q.add(a, b)), '1/2');
  assert.equal(Q.key(Q.sub(b, a)), '-1/6');
  assert.equal(Q.key(Q.mul(a, b)), '1/18');
  assert.equal(Q.key(Q.div(a, b)), '2');
  assert.equal(Q.cmp(a, b), 1);
  assert.equal(Q.cmp(b, a), -1);
  assert.equal(Q.cmp(a, Q.rat(2n, 6n)), 0);
  assert.throws(() => Q.div(a, Q.ZERO));
  assert.throws(() => Q.fromNumber(NaN));
});
