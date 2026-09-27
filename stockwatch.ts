const BSC_TESTNET_RPC_URL =
  process.env.BSC_TESTNET_RPC_URL ?? 'https://data-seed-prebsc-1-s1.bnbchain.org:8545';
const REFERENCE_PRICE_URL = process.env.REFERENCE_PRICE_URL;
const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const USD_SCALE = 100_000_000n;

type PoolConfig = {
  tokenAddress: string;
  pairAddress: string;
  quoteTokenAddress: string;
  quoteCurrency: 'USD';
};

type RpcResponse = {
  result?: string;
  error?: { message?: string };
};

type EasternTimeParts = {
  year: number;
  month: number;
  day: number;
  weekday: string;
  hour: number;
  minute: number;
};

export function getUsMarketStatus(now: Date): { isOpen: boolean; detail: string } {
  const parts = getEasternTimeParts(now);
  const day = dateKey(parts.year, parts.month, parts.day);
  const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  const holidays = getMarketHolidays(parts.year);
  const isHoliday = holidays.has(day);

  if (isHoliday) return { isOpen: false, detail: 'Closed (U.S. market holiday)' };
  if (weekday === 0 || weekday === 6) return { isOpen: false, detail: 'Closed (weekend)' };

  const earlyClose = isEarlyClose(parts.year, parts.month, parts.day, weekday);
  const closeHour = earlyClose ? 13 : 16;
  const time = parts.hour * 60 + parts.minute;
  const isOpen = time >= 9 * 60 + 30 && time < closeHour * 60;
  if (isOpen) return { isOpen: true, detail: 'Open (U.S. regular session)' };
  return {
    isOpen: false,
    detail: time < 9 * 60 + 30
      ? 'Closed (pre-market)'
      : `Closed (after ${earlyClose ? 'early ' : ''}close)`,
  };
}

function getEasternTimeParts(date: Date): EasternTimeParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes): string | undefined =>
    parts.find((part) => part.type === type)?.value;
  const year = Number(value('year'));
  const month = Number(value('month'));
  const day = Number(value('day'));
  const hour = Number(value('hour'));
  const minute = Number(value('minute'));
  const weekday = value('weekday');
  if (![year, month, day, hour, minute].every(Number.isFinite) || !weekday) {
    throw new Error('Could not determine the U.S. Eastern market time.');
  }
  return { year, month, day, hour, minute, weekday };
}

function dateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function dateKeyFromUtc(date: Date): string {
  return dateKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function observedDate(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() - 1);
  if (date.getUTCDay() === 0) date.setUTCDate(date.getUTCDate() + 1);
  return dateKeyFromUtc(date);
}

function nthWeekday(year: number, month: number, weekday: number, occurrence: number): number {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return 1 + ((weekday - first + 7) % 7) + 7 * (occurrence - 1);
}

function lastWeekday(year: number, month: number, weekday: number): number {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lastDay = new Date(Date.UTC(year, month - 1, last)).getUTCDay();
  return last - ((lastDay - weekday + 7) % 7);
}

function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function getMarketHolidays(year: number): Set<string> {
  const holidays = new Set<string>();
  for (const newYearYear of [year - 1, year, year + 1]) {
    holidays.add(observedDate(newYearYear, 1, 1));
  }
  if (year >= 1998) holidays.add(dateKey(year, 1, nthWeekday(year, 1, 1, 3)));
  holidays.add(dateKey(year, 2, nthWeekday(year, 2, 1, 3)));

  const goodFriday = easterSunday(year);
  goodFriday.setUTCDate(goodFriday.getUTCDate() - 2);
  holidays.add(dateKeyFromUtc(goodFriday));

  holidays.add(dateKey(year, 5, lastWeekday(year, 5, 1)));
  if (year >= 2022) holidays.add(observedDate(year, 6, 19));
  holidays.add(observedDate(year, 7, 4));
  holidays.add(dateKey(year, 9, nthWeekday(year, 9, 1, 1)));
  holidays.add(dateKey(year, 11, nthWeekday(year, 11, 4, 4)));
  holidays.add(observedDate(year, 12, 25));
  return holidays;
}

function isEarlyClose(year: number, month: number, day: number, weekday: number): boolean {
  if (month === 11 && day === nthWeekday(year, 11, 4, 4) + 1) return true;
  if (month === 12 && day === 24 && weekday >= 1 && weekday <= 5) return true;
  return month === 7 && day === 3 && weekday >= 1 && weekday <= 5;
}

function parseTicker(input: string): string {
  const ticker = input.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker)) {
    throw new Error('Ticker must contain 1-10 letters, digits, dots, or hyphens and start with a letter.');
  }
  return ticker;
}

function loadPoolConfig(ticker: string): PoolConfig {
  const value = process.env.STOCK_POOLS_JSON;
  if (!value) throw new Error('STOCK_POOLS_JSON is not configured with a ticker-to-pool mapping.');
  let mappings: unknown;
  try {
    mappings = JSON.parse(value);
  } catch {
    throw new Error('STOCK_POOLS_JSON must be valid JSON.');
  }
  if (mappings === null || typeof mappings !== 'object' || Array.isArray(mappings)) {
    throw new Error('STOCK_POOLS_JSON must be a JSON object keyed by ticker.');
  }
  const config = (mappings as Record<string, unknown>)[ticker];
  if (config === null || typeof config !== 'object') {
    throw new Error(`No BSC testnet pool is configured for ${ticker}.`);
  }
  const entry = config as Record<string, unknown>;
  if (
    typeof entry.tokenAddress !== 'string' ||
    typeof entry.pairAddress !== 'string' ||
    typeof entry.quoteTokenAddress !== 'string' ||
    entry.quoteCurrency !== 'USD'
  ) {
    throw new Error(`The ${ticker} pool must define tokenAddress, pairAddress, quoteTokenAddress, and quoteCurrency: "USD".`);
  }
  if (![entry.tokenAddress, entry.pairAddress, entry.quoteTokenAddress].every((address) => ADDRESS_PATTERN.test(address))) {
    throw new Error(`The ${ticker} pool contains an invalid EVM contract address.`);
  }
  if (entry.tokenAddress.toLowerCase() === entry.quoteTokenAddress.toLowerCase()) {
    throw new Error(`The ${ticker} token and USD quote token must be different contracts.`);
  }
  return {
    tokenAddress: entry.tokenAddress,
    pairAddress: entry.pairAddress,
    quoteTokenAddress: entry.quoteTokenAddress,
    quoteCurrency: 'USD',
  };
}

async function callRpc(method: string, params: unknown[]): Promise<string> {
  const response = await fetch(BSC_TESTNET_RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`BSC testnet RPC returned HTTP ${response.status}.`);
  const result = await response.json() as RpcResponse;
  if (result.error) throw new Error(`BSC testnet RPC error: ${result.error.message ?? 'unknown error'}`);
  if (typeof result.result !== 'string') throw new Error(`BSC testnet RPC returned no result for ${method}.`);
  return result.result;
}

async function ethCall(address: string, data: string): Promise<string> {
  const result = await callRpc('eth_call', [{ to: address, data }, 'latest']);
  if (!/^0x[0-9a-fA-F]+$/.test(result)) throw new Error('BSC testnet returned an invalid contract-call result.');
  return result;
}

function decodeAddress(result: string): string {
  if (result.length !== 66) throw new Error('Pool returned an invalid token address.');
  return `0x${result.slice(-40)}`;
}

function decodeUint(result: string): bigint {
  return BigInt(result);
}

function formatRatio(numerator: bigint, denominator: bigint, places = 4): string {
  if (denominator <= 0n) throw new Error('Pool has no liquidity.');
  const scale = 10n ** BigInt(places);
  const scaled = (numerator * scale + denominator / 2n) / denominator;
  return `${scaled / scale}.${String(scaled % scale).padStart(places, '0')}`;
}

function parseUsdPrice(value: unknown): bigint {
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new Error('Reference quote must contain a numeric priceUsd value.');
  }
  const text = String(value);
  if (!/^\d+(?:\.\d{1,8})?$/.test(text)) {
    throw new Error('Reference quote priceUsd must be a positive decimal with at most 8 decimal places.');
  }
  const [whole = '', fraction = ''] = text.split('.');
  const scaled = BigInt(whole) * USD_SCALE + BigInt(fraction.padEnd(8, '0'));
  if (scaled <= 0n) throw new Error('Reference quote priceUsd must be greater than zero.');
  return scaled;
}

async function getReferencePrice(ticker: string): Promise<bigint> {
  if (!REFERENCE_PRICE_URL) {
    throw new Error('REFERENCE_PRICE_URL is not configured; set an HTTPS quote endpoint returning {"priceUsd": number}.');
  }
  const url = REFERENCE_PRICE_URL.includes('{ticker}')
    ? REFERENCE_PRICE_URL.replaceAll('{ticker}', encodeURIComponent(ticker))
    : appendSymbol(REFERENCE_PRICE_URL, ticker);
  const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`Reference price endpoint returned HTTP ${response.status}.`);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error('Reference price endpoint did not return valid JSON.');
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Reference price endpoint must return an object containing priceUsd.');
  }
  const data = body as Record<string, unknown>;
  if (typeof data.symbol === 'string' && data.symbol.toUpperCase() !== ticker) {
    throw new Error(`Reference endpoint returned ${data.symbol} instead of ${ticker}.`);
  }
  return parseUsdPrice(data.priceUsd);
}

function appendSymbol(endpoint: string, ticker: string): string {
  const url = new URL(endpoint);
  url.searchParams.set('symbol', ticker);
  return url.toString();
}

function fixedToNumber(value: bigint): number {
  return Number(value) / Number(USD_SCALE);
}

export async function getStockReport(input: string): Promise<string> {
  const ticker = parseTicker(input);
  const pool = loadPoolConfig(ticker);
  const chainId = await callRpc('eth_chainId', []);
  if (BigInt(chainId) !== 97n) throw new Error('Configured RPC is not BSC testnet (chain ID 97).');

  const [token0Result, token1Result, reservesResult] = await Promise.all([
    ethCall(pool.pairAddress, '0x0dfe1681'),
    ethCall(pool.pairAddress, '0xd21220a7'),
    ethCall(pool.pairAddress, '0x0902f1ac'),
  ]);
  const token0 = decodeAddress(token0Result).toLowerCase();
  const token1 = decodeAddress(token1Result).toLowerCase();
  const tokenAddress = pool.tokenAddress.toLowerCase();
  const quoteAddress = pool.quoteTokenAddress.toLowerCase();
  if (!((token0 === tokenAddress && token1 === quoteAddress) ||
        (token1 === tokenAddress && token0 === quoteAddress))) {
    throw new Error(`The configured pair is not a ${ticker}/USD pool.`);
  }

  const reserves = reservesResult.slice(2);
  if (reserves.length < 128) throw new Error('Pool returned incomplete reserves.');
  const reserve0 = decodeUint(`0x${reserves.slice(0, 64)}`);
  const reserve1 = decodeUint(`0x${reserves.slice(64, 128)}`);
  const tokenReserve = token0 === tokenAddress ? reserve0 : reserve1;
  const quoteReserve = token0 === quoteAddress ? reserve0 : reserve1;
  if (tokenReserve === 0n || quoteReserve === 0n) throw new Error('The configured pool has no current liquidity.');

  const [tokenDecimalsResult, quoteDecimalsResult, referencePrice] = await Promise.all([
    ethCall(pool.tokenAddress, '0x313ce567'),
    ethCall(pool.quoteTokenAddress, '0x313ce567'),
    getReferencePrice(ticker),
  ]);
  const tokenDecimals = Number(decodeUint(tokenDecimalsResult));
  const quoteDecimals = Number(decodeUint(quoteDecimalsResult));
  if (!Number.isInteger(tokenDecimals) || tokenDecimals > 36 || !Number.isInteger(quoteDecimals) || quoteDecimals > 36) {
    throw new Error('Pool tokens returned invalid decimal counts.');
  }

  const onChainUsd = (quoteReserve * 10n ** BigInt(tokenDecimals) * USD_SCALE) /
    (tokenReserve * 10n ** BigInt(quoteDecimals));
  const spreadPercent = ((fixedToNumber(onChainUsd) - fixedToNumber(referencePrice)) /
    fixedToNumber(referencePrice)) * 100;
  const market = getUsMarketStatus(new Date());
  return [
    `${ticker} stock report`,
    `On-chain: $${formatRatio(quoteReserve * 10n ** BigInt(tokenDecimals), tokenReserve * 10n ** BigInt(quoteDecimals))} per token (BSC testnet pool)`,
    `Reference: $${formatRatio(referencePrice, USD_SCALE)} per share; on-chain variance: ${spreadPercent >= 0 ? '+' : ''}${spreadPercent.toFixed(2)}%`,
    `U.S. market: ${market.detail}`,
  ].join('\n');
}
