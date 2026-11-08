//! Wide multiplication for prices and shares (amounts are up to 1e30, so products need 256 bits).
use crate::COIN;

uint::construct_uint! {
    pub struct U256(4);
}

/// a * b / c, rounded down. Panics on c == 0 or a result above u128.
pub fn mul_div(a: u128, b: u128, c: u128) -> u128 {
    assert!(c > 0, "division by zero");
    let r = U256::from(a) * U256::from(b) / U256::from(c);
    assert!(r <= U256::from(u128::MAX), "overflow");
    r.as_u128()
}

/// (bps / 10_000)^n, scaled by COIN.
pub fn pow_bps(bps: u32, mut n: u64) -> u128 {
    let one = U256::from(COIN);
    let mut base = U256::from(bps as u128) * one / U256::from(10_000u128);
    let mut acc = one;
    while n > 0 {
        if n & 1 == 1 {
            acc = acc * base / one;
        }
        base = base * base / one;
        n >>= 1;
        if acc.is_zero() {
            break;
        }
    }
    acc.as_u128()
}
