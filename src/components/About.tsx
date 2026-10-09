import { CANONICAL_PAIR, CHAIN, ETH_PAIR, FACTORIES, STOCK_QUOTE } from "../lib/chain";
import { fmtEth, short } from "../lib/format";

export function About() {
  return (
    <div className="about">
      <section className="panel">
        <h2>What this is</h2>
        <p>
          An unofficial analytics and simulation tool for <b>vibe/vibe</b>, the permissionless launchpad running on{" "}
          <b>Robinhood Chain Testnet</b> (chain {CHAIN.id}). Nothing here is affiliated with, endorsed by, or built by the
          vibe/vibe or Seedify teams. It reads public chain data only.
        </p>
        <p>
          Two things it does that the launcher does not: it scans launch logs across <i>every</i> factory generation so tokens
          from older generations still show up, and it lets you model a launch configuration before you commit one — including
          what the curve does to your own opening buy.
        </p>
      </section>

      <section className="panel">
        <h2>How the numbers were obtained</h2>
        <ul>
          <li>
            <b>Event signatures &amp; ABI fragments</b>: the contracts are not source-verified and there is no published ABI. The
            topic hashes were recovered from the shipped frontend bundle by the open-source{" "}
            <a href="https://github.com/itstorvian/vibevibe-testnet-indexer" target="_blank" rel="noreferrer noopener">
              vibevibe-testnet-indexer
            </a>{" "}
            project and independently re-verified here by decoding live logs.
          </li>
          <li>
            <b>Factory address book</b>: three generations are known to emit launches ({FACTORIES.map((f) => f.label).join(", ")}).
            Liveness is an on-chain observation here, not a label — the "retired" generation was still producing launches when it
            was last checked.
          </li>
          <li>
            <b>Curve math</b>: constant product over virtual reserves, with the fee taken before the reserves move. Verified
            against deployed curves — see below.
          </li>
          <li>
            <b>Project names</b> come from the token contract itself (<code>name()</code>/<code>symbol()</code>); images and
            descriptions come from the IPFS metadata URI in the launch event, resolved through public gateways on a best-effort
            basis.
          </li>
        </ul>
      </section>

      <section className="panel">
        <h2>The model is checked against the contracts</h2>
        <p>
          Every token row has a <b>model vs contract</b> check. It calls that curve's own <code>spotPriceWad()</code> and{" "}
          <code>quoteBuy(0.01 ETH)</code> and compares them with this app's arithmetic. On the curves tested during development
          the spot price matched exactly and token output matched to <b>1 wei</b> (integer rounding). If a check ever reports a
          mismatch, the simulator is wrong for that curve and you should not trust its output.
        </p>
      </section>

      <section className="panel">
        <h2>Verified testnet parameters</h2>
        <div className="table">
          <div className="tr th">
            <span>generation</span>
            <span>factory</span>
            <span className="num">fee</span>
            <span className="num">creator share</span>
            <span className="num">graduation target</span>
            <span className="num">E₀</span>
          </div>
          {FACTORIES.map((f) => (
            <div className="tr" key={f.address}>
              <span>
                <span className={`badge ${f.generation}`}>{f.label}</span>
              </span>
              <span className="mono small">{short(f.address, 6)}</span>
              <span className="num">{f.feeBps !== null ? `${f.feeBps} bps` : "unverified"}</span>
              <span className="num">{f.creatorShareBps !== null ? `${Number(f.creatorShareBps) / 100}%` : "unverified"}</span>
              <span className="num">{f.netGraduationTarget !== null ? `${fmtEth(f.netGraduationTarget, 4)} ETH` : "unverified"}</span>
              <span className="num">{f.initialVirtualEthReserve !== null ? `${fmtEth(f.initialVirtualEthReserve, 6)} ETH` : "unverified"}</span>
            </div>
          ))}
        </div>
        <p className="muted small">
          "unverified" is deliberate: an unverified parameter is never substituted with a value from another generation.
        </p>
        <div className="kv wide">
          <div>
            <span>total supply</span>
            <b>{fmtEth(ETH_PAIR.totalSupply, 0)} tokens (1B)</b>
          </div>
          <div>
            <span>curve allocation</span>
            <b>{fmtEth(ETH_PAIR.curveAllocation, 0)} live on curve (800M)</b>
          </div>
          <div>
            <span>curved sold at graduation</span>
            <b>~793.1M (99.1% of the curve)</b>
          </div>
          <div>
            <span>stock-pair quote asset</span>
            <b>
              {STOCK_QUOTE.symbol} · target {fmtEth(STOCK_QUOTE.netGraduationTarget, 2)}
            </b>
          </div>
          <div>
            <span>canonical ERC-20 pair</span>
            <b className="mono small">{short(CANONICAL_PAIR.token, 6)}</b>
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>The V6 generation (and why it is hard to see)</h2>
        <p>
          Every launch created today comes from a factory that is <b>not</b> in the operator's published config list, which is
          why this tool watches it explicitly. It differs from the older generations in three ways that matter:
        </p>
        <ul>
          <li>
            <b>Its launch event is undocumented.</b> It is absent from the frontend bundle and unknown to 4byte.directory,
            because it carries the token's name, symbol and metadata URI as three dynamic strings. This app decodes it by
            position, and validates every field (offsets inside the data, printable strings, address-shaped curve) — a log that
            fails those checks is reported as a decode failure rather than shown.
          </li>
          <li>
            <b>Its curve surface is renamed.</b> <code>virtualEthReserve()</code>, <code>spotPriceWad()</code> and
            <code>fdvWei()</code> do not exist on a V6 curve and revert. Raised is <code>pairPrincipal()</code>, target is{" "}
            <code>targetPairUnits()</code> (observed at <b>4 ETH</b>, not the older 5 ETH), sold is <code>sold()</code>, the tax
            you chose is <code>baseTaxBps()</code>, and the decaying post-launch rate is <code>currentRateBps()</code>.
          </li>
          <li>
            <b>Its curve shape is not recovered</b>, so the simulator does not model it. V6 prices shown here are derived from
            the contract's own <code>quoteBuyExactIn()</code> — the marginal price of the next 0.001 ETH — and are labelled{" "}
            <i>from quote</i> rather than presented as a formula this app claims to understand.
          </li>
        </ul>
        <p className="muted small">
          V6 launch events also publish no creator address (the project treasury is shown instead) and no opening-buy amount.
          Both are marked as such rather than guessed.
        </p>
      </section>

      <section className="panel">
        <h2>What this tool cannot see</h2>
        <ul>
          <li>
            <b>Unknown factory generations.</b> The RPC refuses address-less log queries, so factories must be named explicitly.
            A generation deployed after this build is invisible until added here — this is exactly what happened with V6, which
            was found by decoding a live launch rather than from any published list. A feed that looks complete can still be
            incomplete.
          </li>
          <li>
            <b>topic filters beyond topic0.</b> This RPC silently ignores <code>topics[1]</code> and beyond: filtering by token
            address returns every log from that contract. All discrimination therefore happens client-side after the fetch,
            which is why decode failures are surfaced instead of assumed away.
          </li>
          <li>
            <b>Holder counts and individual trades.</b> Transfer/Bought/Sold logs are far denser than launches; scanning them
            per-token is not possible on a rate-limited public RPC without an archive node.
          </li>
          <li>
            <b>Historical state.</b> The public endpoint is not an archive node, so reads are head-only. Curve state is "as of
            right now", not as of the launch block.
          </li>
          <li>
            <b>V6 curve shape.</b> Raised, target, sold and tax are read directly, but the price is quote-derived and the curve
            is not simulated. Treat V6 projection numbers here as observations, not predictions.
          </li>
          <li>
            <b>Metadata reliability.</b> Public IPFS gateways rate-limit aggressively; images may fail to load. Names and
            symbols always come from chain (or from the V6 launch event itself) and are unaffected.
          </li>
          <li>
            <b>Intent.</b> The Monte Carlo panel models buyer behaviour from parameters <i>you</i> choose. It is not a
            forecast, and it cannot know who will actually show up.
          </li>
        </ul>
      </section>

      <section className="panel warning">
        <h2>Testnet only</h2>
        <p>
          Everything here concerns Robinhood Chain <b>Testnet</b>. Test ETH and testnet tokens have no monetary value. This is
          not financial advice. Do not send mainnet assets to this network.
        </p>
      </section>
    </div>
  );
}
