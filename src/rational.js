// Exact rational arithmetic on BigInt.
//
// A rational is a frozen object { n, d } with d > 0 and gcd(|n|, d) = 1, so two
// equal values always have identical fields and a canonical string key. All
// geometry in this library runs on these values; floating point is used only
// as a conservative broad phase filter and for final output.

const ZERO_N = 0n;
const ONE_N = 1n;

function gcd(a, b) {
  if (a < 0n) a = -a;
  if (b < 0n) b = -b;
  while (b !== 0n) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}

/** Build a normalized rational from BigInt numerator and denominator. */
export function rat(n, d = ONE_N) {
  if (d === 0n) throw new RangeError('rational with zero denominator');
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  if (d !== ONE_N) {
    const g = gcd(n, d);
    if (g !== ONE_N && g !== 0n) {
      n /= g;
      d /= g;
    }
  }
  if (n === ZERO_N) d = ONE_N;
  return Object.freeze({ n, d });
}

export const ZERO = rat(0n);
export const ONE = rat(1n);
export const HALF = rat(1n, 2n);

const view = new DataView(new ArrayBuffer(8));

/**
 * Convert a finite IEEE-754 double to the rational it represents *exactly*.
 * 0.1 becomes 3602879701896397/36028797018963968, not 1/10: the library
 * computes on the coordinates you actually passed, bit for bit.
 */
export function fromNumber(x) {
  if (!Number.isFinite(x)) throw new RangeError(`coordinate is not finite: ${x}`);
  if (Number.isSafeInteger(x)) return rat(BigInt(x));
  view.setFloat64(0, x);
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  const negative = hi >>> 31 === 1;
  const biased = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let exp;
  if (biased === 0) {
    exp = -1074; // subnormal
  } else {
    mant |= 1n << 52n;
    exp = biased - 1075;
  }
  if (negative) mant = -mant;
  return exp >= 0 ? rat(mant << BigInt(exp)) : rat(mant, 1n << BigInt(-exp));
}

/**
 * Parse a decimal or fraction string exactly: "3", "-2.75", "1e-3", "7/3".
 */
export function fromString(s) {
  const str = String(s).trim();
  const frac = /^([+-]?\d+)\s*\/\s*([+-]?\d+)$/.exec(str);
  if (frac) return rat(BigInt(frac[1]), BigInt(frac[2]));
  const dec = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(str);
  if (!dec || (dec[2] === '' && (dec[3] === undefined || dec[3] === ''))) {
    throw new SyntaxError(`cannot parse rational from "${s}"`);
  }
  const sign = dec[1] === '-' ? -1n : 1n;
  const intPart = dec[2] || '0';
  const fracPart = dec[3] || '';
  const exp = Number(dec[4] || 0) - fracPart.length;
  let n = BigInt(intPart + fracPart) * sign;
  let d = 1n;
  if (exp >= 0) n *= 10n ** BigInt(exp);
  else d = 10n ** BigInt(-exp);
  return rat(n, d);
}

/** Accept number | bigint | string | rational and return a rational. */
export function toRat(v) {
  if (typeof v === 'number') return fromNumber(v);
  if (typeof v === 'bigint') return rat(v);
  if (typeof v === 'string') return fromString(v);
  if (v && typeof v.n === 'bigint' && typeof v.d === 'bigint') return rat(v.n, v.d);
  throw new TypeError(`unsupported coordinate: ${String(v)}`);
}

export const add = (a, b) =>
  a.d === b.d ? rat(a.n + b.n, a.d) : rat(a.n * b.d + b.n * a.d, a.d * b.d);
export const sub = (a, b) =>
  a.d === b.d ? rat(a.n - b.n, a.d) : rat(a.n * b.d - b.n * a.d, a.d * b.d);
export const mul = (a, b) => rat(a.n * b.n, a.d * b.d);
export const div = (a, b) => {
  if (b.n === 0n) throw new RangeError('division by zero');
  return rat(a.n * b.d, a.d * b.n);
};
export const neg = (a) => rat(-a.n, a.d);

/** Three way comparison: -1, 0 or 1. */
export function cmp(a, b) {
  if (a.d === b.d) return a.n < b.n ? -1 : a.n > b.n ? 1 : 0;
  const l = a.n * b.d;
  const r = b.n * a.d;
  return l < r ? -1 : l > r ? 1 : 0;
}

export const sign = (a) => (a.n < 0n ? -1 : a.n > 0n ? 1 : 0);
export const eq = (a, b) => a.n === b.n && a.d === b.d;

/** Canonical string, also the hash key used for point interning. */
export const key = (a) => (a.d === 1n ? a.n.toString() : `${a.n}/${a.d}`);
export const toString = key;

function bitLength(x) {
  if (x < 0n) x = -x;
  return x === 0n ? 0 : x.toString(2).length;
}

/** Nearest double (within one ulp), safe for numerators beyond 2^1024. */
export function toNumber(a) {
  const nb = bitLength(a.n);
  const db = bitLength(a.d);
  if (nb <= 53 && db <= 53) return Number(a.n) / Number(a.d);
  // Scale so the integer quotient carries ~64 significant bits.
  const shift = nb - db - 64;
  const q = shift >= 0 ? a.n / (a.d << BigInt(shift)) : (a.n << BigInt(-shift)) / a.d;
  // Apply the power of two in two halves so neither factor under/overflows early.
  const h = Math.trunc(shift / 2);
  return Number(q) * 2 ** h * 2 ** (shift - h);
}
