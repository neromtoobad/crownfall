//! The merchants of Vael: how a house prices its coin. This file is the whole rule; the browser mirrors it line for
//! line in `web/src/chain/market.ts` to explain every price it shows.
//!
//! Each house is a merchant. Its stock is its coin, its purse is its NEAR reserve.
//!
//! 1. **Fair value** is what one coin's share of the purse is worth: `reserve ÷ supply`.
//! 2. **Demand** is the NEAR bought (+) and sold (−) at the house lately. It halves every `DEMAND_HALF_SECS`, so
//!    an hour-old rush counts for a quarter of a fresh one.
//! 3. **The merchant's factor** is `1 + demand ÷ DEPTH`, held between `FACTOR_MIN` and `FACTOR_MAX`. A rush of
//!    buying makes the coin dearer; a flood of selling makes it cheap.
//! 4. **Buying** pays fair value × factor (plus the 5% trade fee). What a buyer pays above fair value stays in the
//!    purse, so it raises the coin's worth for every holder.
//! 5. **Selling** gets fair value × the factor, but never more than fair value. The merchant never pays out more than a
//!    coin's share of its purse, so it can always pay every holder in full.
//! 6. **A run on the house.** The merchant remembers the fullest its purse has been (`peak`). When selling has
//!    drained it below `RUN_BPS` of that, the house is broke and shuts: its hall takes no rounds and it buys no coin
//!    back. Every purchase while it's shut is an investment in reopening it; once the purse is back to `REOPEN_BPS`
//!    of the peak, the doors open and the peak starts again from there. While it's shut the merchant still prices by
//!    demand: if the selling outweighed the buying before it, the coin is cheap.
//!
//! Factors are in basis points (10 000 = ×1). Amounts in yoctoNEAR.

/// Demand halves this often.
pub const DEMAND_HALF_SECS: u64 = 20 * 60;
/// Net NEAR of demand that moves the factor by ×1 (1 NEAR bought lately: twice the price).
pub const DEPTH: i128 = 1_000_000_000_000_000_000_000_000;
pub const FACTOR_ONE: u128 = 10_000;
pub const FACTOR_MIN: u128 = 7_000;
pub const FACTOR_MAX: u128 = 15_000;
/// A sale that drains the purse below 70% of its peak shuts the house.
pub const RUN_BPS: u128 = 7_000;
/// A shut house reopens once its purse is back to 85% of that peak.
pub const REOPEN_BPS: u128 = 8_500;

const SEC: u64 = 1_000_000_000;

/// What the merchant remembers between trades.
#[near_sdk::near(serializers = [borsh, json])]
#[derive(Clone, Copy, Default, Debug, PartialEq)]
pub struct Stall {
    /// Net NEAR bought (+) or sold (−), as it stood at `at_ns`.
    pub demand: i128,
    pub at_ns: u64,
    pub shut: bool,
    /// The fullest the purse has been since the house last opened (0 until its first trade under this rule).
    pub peak: u128,
}

/// Demand as it stands at `now_ns`: halved once per whole half-life gone by, and within the current half-life eased
/// down in a straight line (a quarter of the way through, it has fallen by an eighth).
pub fn demand_now(s: &Stall, now_ns: u64) -> i128 {
    let dt = now_ns.saturating_sub(s.at_ns) / SEC;
    let halves = dt / DEMAND_HALF_SECS;
    if halves >= 100 {
        return 0;
    }
    let rem = (dt % DEMAND_HALF_SECS) as i128;
    let half = DEMAND_HALF_SECS as i128;
    let mag = s.demand.unsigned_abs() >> halves;
    let mag = (mag as i128) * (2 * half - rem) / (2 * half);
    if s.demand < 0 { -mag } else { mag }
}

/// The merchant's factor for this much demand.
pub fn factor(demand: i128) -> u128 {
    let f = FACTOR_ONE as i128 + demand * FACTOR_ONE as i128 / DEPTH;
    (f.max(FACTOR_MIN as i128) as u128).min(FACTOR_MAX)
}

/// The factor a seller gets: the merchant's, but never above fair value.
pub fn sell_factor(demand: i128) -> u128 {
    factor(demand).min(FACTOR_ONE)
}

/// After a sale: has selling drained the purse below RUN_BPS of its peak?
pub fn breaks(reserve: u128, peak: u128) -> bool {
    reserve / FACTOR_ONE * FACTOR_ONE < peak / FACTOR_ONE * RUN_BPS
}
/// After a purchase into a shut house: is the purse back to REOPEN_BPS of its peak?
pub fn reopens(reserve: u128, peak: u128) -> bool {
    reserve / FACTOR_ONE * FACTOR_ONE >= peak / FACTOR_ONE * REOPEN_BPS
}

#[cfg(test)]
mod tests {
    use super::*;
    const N: i128 = 1_000_000_000_000_000_000_000_000;

    #[test]
    fn demand_halves() {
        let s = Stall { demand: N, at_ns: 0, shut: false, peak: 0 };
        assert_eq!(demand_now(&s, 0), N);
        assert_eq!(demand_now(&s, DEMAND_HALF_SECS * SEC), N / 2);
        assert_eq!(demand_now(&s, 2 * DEMAND_HALF_SECS * SEC), N / 4);
        assert_eq!(demand_now(&s, DEMAND_HALF_SECS * SEC / 2), N * 3 / 4);
        let neg = Stall { demand: -N, at_ns: 0, shut: false, peak: 0 };
        assert_eq!(demand_now(&neg, DEMAND_HALF_SECS * SEC), -N / 2);
        assert_eq!(demand_now(&s, 400 * DEMAND_HALF_SECS * SEC), 0);
    }

    #[test]
    fn factor_moves_and_is_held() {
        assert_eq!(factor(0), 10_000);
        assert_eq!(factor(N / 10), 11_000);
        assert_eq!(factor(-N / 10), 9_000);
        assert_eq!(factor(10 * N), FACTOR_MAX);
        assert_eq!(factor(-10 * N), FACTOR_MIN);
        assert_eq!(sell_factor(N / 10), 10_000);
        assert_eq!(sell_factor(-N / 10), 9_000);
    }

    #[test]
    fn a_run_shuts_and_investment_reopens() {
        let peak = 10 * N as u128;
        assert!(!breaks(7 * N as u128, peak));
        assert!(breaks(7 * N as u128 - 1_000_000, peak));
        assert!(!reopens(8 * N as u128, peak));
        assert!(reopens(85 * N as u128 / 10, peak));
    }
}
