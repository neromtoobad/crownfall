#!/usr/bin/env bash
# Put Crownfall's contract on NEAR mainnet and prove the coin loop with two transactions: buy a house coin, then burn
# some of it by entering that house's hall. Run it yourself with your own account; it spends about 5 NEAR of yours
# (about 3.7 NEAR is storage for the contract code, 0.8 NEAR seeds the eight house reserves, 0.05 NEAR buys coin).
#
#   ./mainnet.sh <your-account.near>
#
# It makes crownfall.<your-account.near>, deploys the reproducible build in target/near/, and prints the explorer
# link of every transaction. Paste the buy and burn links into JUDGE.md. NET=testnet rehearses the same steps on
# testnet (SIGN=sign-with-legacy-keychain if your keys are in ~/.near-credentials).
set -euo pipefail

PARENT=${1:?usage: ./mainnet.sh <your-account.near>}
NET=${NET:-mainnet}
SIGN=${SIGN:-sign-with-keychain}
FUND=${FUND:-4.6 NEAR}
C=${CONTRACT:-crownfall.$PARENT}
WASM=${WASM:-$(dirname "$0")/target/near/crownfall_realm.wasm}
HOUSE=${HOUSE:-0}
SAVE=$([ "$SIGN" = sign-with-legacy-keychain ] && echo save-to-legacy-keychain || echo save-to-keychain)
EXP=$([ "$NET" = mainnet ] && echo https://nearblocks.io || echo https://testnet.nearblocks.io)

[ -f "$WASM" ] || { echo "No contract at $WASM. Build it first: cd chain && cargo near build reproducible-wasm"; exit 1; }
echo "Network:  $NET"
echo "Parent:   $PARENT (pays)"
echo "Contract: $C"
echo "Code:     $WASM  sha256 $(shasum -a 256 "$WASM" | cut -c1-64)"
if [ -z "${YES:-}" ]; then read -r -p "Go ahead? On mainnet this spends real NEAR. [y/N] " ok; [ "$ok" = y ] || exit 1; fi

LOG=$(mktemp)
tx() { grep -Eo 'Transaction ID: [A-Za-z0-9]+' "$LOG" | tail -1 | awk '{print $3}'; }
run() { "$@" 2>&1 | tee "$LOG"; }

echo; echo "1/4  Make $C"
run near account create-account fund-myself "$C" "$FUND" autogenerate-new-keypair "$SAVE" \
  sign-as "$PARENT" network-config "$NET" "$SIGN" send
echo "     $EXP/txns/$(tx)"

echo; echo "2/4  Deploy and open the realm (0.8 NEAR seeds the reserves)"
run near contract deploy "$C" use-file "$WASM" with-init-call new json-args "{\"owner\":\"$PARENT\"}" \
  prepaid-gas '100 Tgas' attached-deposit '0.8 NEAR' network-config "$NET" "$SIGN" send
DEPLOY=$(tx); echo "     $EXP/txns/$DEPLOY"

echo; echo "3/4  Buy 0.05 NEAR of house $HOUSE's coin"
run near contract call-function as-transaction "$C" buy json-args "{\"house\":$HOUSE}" \
  prepaid-gas '100 Tgas' attached-deposit '0.05 NEAR' sign-as "$PARENT" network-config "$NET" "$SIGN" send
BUY=$(tx); echo "     $EXP/txns/$BUY"

echo; echo "4/4  Enter house $HOUSE's hall: the entry (400 coin) is burned"
run near contract call-function as-transaction "$C" enter json-args "{\"house\":$HOUSE}" \
  prepaid-gas '100 Tgas' attached-deposit '0 NEAR' sign-as "$PARENT" network-config "$NET" "$SIGN" send
BURN=$(tx); echo "     $EXP/txns/$BURN"

echo; echo "The realm after:"
near contract call-function as-read-only "$C" get_realm json-args '{}' network-config "$NET" now 2>/dev/null \
  | grep -E '"(burned|rounds|supply|reserve|version)"' | head -8 || true

cat <<EOF

Done. For JUDGE.md:
  contract  $EXP/address/$C
  deploy    $EXP/txns/$DEPLOY
  buy       $EXP/txns/$BUY
  burn      $EXP/txns/$BURN
EOF
