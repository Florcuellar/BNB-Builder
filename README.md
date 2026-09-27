# stockwatch

Read-only seller-agent scaffold for tokenized stock price checks on BSC testnet. It accepts a ticker and returns a short report with a BSC V2-compatible pool price, a reference quote, the variance, and U.S. regular-session status.

## Run locally

Requires Node.js 20 or newer.

```sh
npm test
npm run typecheck
STOCK_POOLS_JSON='{"AAPL":{"tokenAddress":"0x...","pairAddress":"0x...","quoteTokenAddress":"0x...","quoteCurrency":"USD"}}' \
REFERENCE_PRICE_URL='https://your-quote-service.example/quote?symbol={ticker}' \
npm start
```

`STOCK_POOLS_JSON` maps each supported ticker to its token contract, V2-compatible pair contract, and USD-valued quote token. Configure only real BSC testnet addresses and pools whose quote asset is intended to represent USD. A testnet pool price is only as reliable as its liquidity and quote asset; this service does not create pools or verify a stablecoin's peg.

`REFERENCE_PRICE_URL` must return JSON with a positive `priceUsd` value and may include a `symbol` field. Use `{ticker}` in the URL to substitute the URL-encoded ticker; otherwise the service appends a `symbol` query parameter. Keep any provider credentials in server-side environment configuration, never in a ticker request.

The RPC defaults to the public BSC testnet endpoint and verifies chain ID 97. Override it with `BSC_TESTNET_RPC_URL` if needed. The report is read-only and does not require signing transactions or an LLM.

## Protocol endpoints

- `GET /health` reports local service status.
- `GET /.well-known/agent-card.json` publishes the A2A agent card.
- `POST /a2a` accepts A2A JSON-RPC `message/send` requests with a ticker in a text part.
- `POST /mcp` implements MCP Streamable HTTP JSON-RPC initialization, tool listing, and `tools/call` for `get_stock_report`.

The server binds to `127.0.0.1` by default. For a remote trial, set `HOST=0.0.0.0`, publish it behind an appropriately secured HTTPS reverse proxy, and set `PUBLIC_AGENT_URL` to its public base URL.

Market status uses U.S. Eastern time, regular weekday hours (9:30 a.m.-4:00 p.m.), major U.S. exchange holidays, and common 1 p.m. early closes. It does not account for exceptional exchange closures.

## BNB Agent Studio trial

[`agent-profile.json`](./agent-profile.json) records the requested Studio settings: `stockwatch`, BSC testnet, default wallet and LLM, $0 seller price, A2A and MCP, and a 48-hour testnet trial. This repository does not contain a usable Agent Studio SDK or hosted Studio connection, so the profile is a deployment handoff, not a live seller listing or an activated trial. The hosted default wallet/LLM, public protocol URLs, trial activation, and payout/listing state must be confirmed in Agent Studio.
