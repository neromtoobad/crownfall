import { NEAR_MARK } from './realm/near.ts';

/** The NEAR logomark, in the current text colour. */
export function NearMark({ size = 14 }: { size?: number }) {
  return <svg className="near-mark" width={size} height={size} viewBox="0 0 90 90" aria-hidden="true"><path d={NEAR_MARK} fill="currentColor" /></svg>;
}

/** "Built on NEAR", for the header. */
export function NearPill() {
  return (
    <a className="near-pill" href="https://near.org" target="_blank" rel="noreferrer">
      <NearMark size={15} /><span>Built on <b>NEAR</b></span>
    </a>
  );
}
