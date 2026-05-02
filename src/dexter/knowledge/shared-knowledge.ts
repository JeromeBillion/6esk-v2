/**
 * Shared 6ex platform knowledge used by all Dexter agents.
 * Single source of truth — characters reference this instead of duplicating.
 */

export const sharedKnowledge: string[] = [
  // PLATFORM
  '6ex is a ZAR-based predictions market with YES/NO outcomes. Prices set by AMM (x*y=k). Winning shares pay R1; losing pay R0. Balances update from payouts.',
  'Dexter guides users on KYC, trading, wallet, portfolio, login, markets, comments, rewards, and leaderboard.',

  // TRADING
  'To trade: Markets > tap market > YES/NO > amount (R10–R1M) > Confirm. Market orders only; immediate execution; no cancel/modify. 2% fee deducted first.',
  'Max trade = 5% of market liquidity. Rate limit: 10 trades/min/user.',
  'Trade requirements: logged in, email verified, KYC verified, sufficient balance.',
  'Trade errors: insufficient balance, email unverified, trade too large (>5% liquidity), market inactive, below R10 min.',

  // EARLY EXIT
  'Sell shares early at current market price: Portfolio > Active > Early Exit > confirm. Errors: no position found, insufficient shares.',

  // WALLET
  'Wallet (bottom nav): shows Available Balance, auto-refreshes ~5s. Deposits & withdrawals coming soon. KYC required for both.',

  // PORTFOLIO
  'Portfolio (bottom nav): Active tab = current positions with Early Exit; Resolved tab = completed. Shows shares, avg price, invested, P&L (live AMM). Trade history not available yet.',

  // MARKETS
  'Markets screen: search or category pills (All, Trending, Crypto, Sports…). Cards show YES/NO prices, liquidity, traders, countdown. Tap Rules for mechanics.',
  'Resolution types: date-based, event-triggered (when_hit), price-oracle.',

  // KYC
  'KYC required BEFORE deposit/trade/withdrawal (SA law). Wallet > Verify Now: (1) 13-digit SA ID + ID front/back, (2) selfie with ID, (3) address 20+ chars + proof. Files: JPG/PNG/WebP/PDF, max 10MB.',
  "If user says 'verify/verification' without detail, assume KYC. Retry: re-upload requested docs only; rejected: resubmit full set.",
  'KYC errors: invalid ID (must be 13 digits), address too short, missing documents, file too large/unsupported.',

  // ACCOUNT
  'Menu (☰) > Profile: name, email, ID, KYC status. Edit phone (10 digits, 0-prefix, unique) or address (20+ chars). Email change needs OTP. Sign Out via menu footer.',

  // LOGIN
  'Login: OTP sent to primary email (6 digits). Enter email > receive OTP > enter > Login. No password.',
  'Email verification uses OTP at registration (/verify-email).',

  // SOCIAL
  'Comments on markets: max 280 chars. Reply, react (thumbs up), report, or delete own within 24h. One reaction per user per comment.',

  // REWARDS
  'Rewards UI live, actions coming soon. R25 verified sign-up, R50 referral (may change). Referral link/WhatsApp/QR/redeem visible but disabled.',

  // LEADERBOARD
  'Leaderboard: Menu > Leaderboard (login required). Week/Month × Stake/Wins. Stake = total staked; Wins = resolved win rate. No data = "No rankings yet."',

  // Dexter CHAT
  'Need Help? bubble opens Dexter chat. Stores last 50 messages. Fallback error if service unavailable.',
];

export const knowledgeBaseTemplate = `# KNOWLEDGE BASE
## PLATFORM
- 6ex: ZAR predictions market, YES/NO outcomes, AMM-priced (x*y=k).
- Winning shares = R1; losing = R0. Balances update from payouts.

## TRADING
- Markets > tap market > YES/NO > amount (R10–R1M) > Confirm.
- Market orders only; immediate execution; no cancel/modify. 2% fee. Max = 5% of liquidity. 10/min rate limit.
- Requirements: logged in + email verified + KYC verified + sufficient balance.
- Errors: insufficient balance | email unverified | trade too large | market inactive | below R10 min.

## EARLY EXIT
- Sell before resolution: Portfolio > Active > Early Exit > confirm. Errors: no position, insufficient shares.

## WALLET
- Bottom nav > Wallet for balance (auto-refreshes ~5s). Deposits & withdrawals coming soon. KYC required.

## PORTFOLIO
- Bottom nav > Portfolio. Active = current (Early Exit). Resolved = completed.
- Shows: shares, avg price, invested, P&L (live AMM). Trade history not available yet.

## MARKETS
- Browse via search or category pills. Cards show YES/NO prices, liquidity, traders, countdown.
- Resolution: date-based, event-triggered, or price-oracle.

## KYC
- Required before deposit/trade/withdrawal (SA law).
- Wallet > Verify Now: (1) 13-digit SA ID + ID photos, (2) selfie with ID, (3) address 20+ chars + proof. Submit.
- Files: JPG/PNG/WebP/PDF, max 10MB. Retry: re-upload requested docs; rejected: full set.
- "Verify" without context = assume KYC.

## ACCOUNT
- Menu (☰) > Profile: name, email, ID, KYC status. Edit phone (10 digits, 0-prefix, unique) or address (20+ chars).
- Email change needs OTP. Sign Out via menu footer.

## LOGIN
- OTP-based: enter email > receive 6-digit OTP > enter > Login. No password.

## SOCIAL
- Comments: max 280 chars, 1 reaction/user, delete within 24h.

## REWARDS
- UI live, actions coming soon. R25 sign-up, R50 referral (may change). Links/QR visible but disabled.

## LEADERBOARD
- Menu > Leaderboard (login required). Week/Month × Stake/Wins.
- Stake = total staked; Wins = resolved win rate. No data = "No rankings yet."

## FAQ
- Limit orders? No. Cancel/edit? No. Sell early? Yes, Early Exit. Trade history? Not yet (Wallet shows deposits/withdrawals).
- Can't trade? Check: login + email + KYC + balance.`;

/* ── Knowledge sections for intent-based segmentation (P1.3) ── */

export const knowledgeSections: Record<string, string> = {
  platform:
    '## PLATFORM\n' +
    '- 6ex: ZAR predictions market, YES/NO outcomes, AMM-priced (x*y=k).\n' +
    '- Winning shares = R1; losing = R0. Balances update from payouts.',
  trading:
    '## TRADING\n' +
    '- Markets > tap market > YES/NO > amount (R10–R1M) > Confirm.\n' +
    '- Market orders only; immediate execution; no cancel/modify. 2% fee. Max = 5% of liquidity. 10/min rate limit.\n' +
    '- Requirements: logged in + email verified + KYC verified + sufficient balance.\n' +
    '- Errors: insufficient balance | email unverified | trade too large | market inactive | below R10 min.',
  earlyExit:
    '## EARLY EXIT\n' +
    '- Sell before resolution: Portfolio > Active > Early Exit > confirm. Errors: no position, insufficient shares.',
  wallet:
    '## WALLET\n' +
    '- Bottom nav > Wallet for balance (auto-refreshes ~5s). Deposits & withdrawals coming soon. KYC required.',
  portfolio:
    '## PORTFOLIO\n' +
    '- Bottom nav > Portfolio. Active = current (Early Exit). Resolved = completed.\n' +
    '- Shows: shares, avg price, invested, P&L (live AMM). Trade history not available yet.',
  markets:
    '## MARKETS\n' +
    '- Browse via search or category pills. Cards show YES/NO prices, liquidity, traders, countdown.\n' +
    '- Resolution: date-based, event-triggered, or price-oracle.',
  kyc:
    '## KYC\n' +
    '- Required before deposit/trade/withdrawal (SA law).\n' +
    '- Wallet > Verify Now: (1) 13-digit SA ID + ID photos, (2) selfie with ID, (3) address 20+ chars + proof. Submit.\n' +
    '- Files: JPG/PNG/WebP/PDF, max 10MB. Retry: re-upload requested docs; rejected: full set.\n' +
    '- "Verify" without context = assume KYC.',
  account:
    '## ACCOUNT\n' +
    '- Menu (☰) > Profile: name, email, ID, KYC status. Edit phone (10 digits, 0-prefix, unique) or address (20+ chars).\n' +
    '- Email change needs OTP. Sign Out via menu footer.',
  login:
    '## LOGIN\n' +
    '- OTP-based: enter email > receive 6-digit OTP > enter > Login. No password.',
  social:
    '## SOCIAL\n' +
    '- Comments: max 280 chars, 1 reaction/user, delete within 24h.',
  rewards:
    '## REWARDS\n' +
    '- UI live, actions coming soon. R25 sign-up, R50 referral (may change). Links/QR visible but disabled.',
  leaderboard:
    '## LEADERBOARD\n' +
    '- Menu > Leaderboard (login required). Week/Month × Stake/Wins.\n' +
    '- Stake = total staked; Wins = resolved win rate. No data = "No rankings yet."',
  faq:
    '## FAQ\n' +
    "- Limit orders? No. Cancel/edit? No. Sell early? Yes, Early Exit. Trade history? Not yet (Wallet shows deposits/withdrawals).\n" +
    "- Can't trade? Check: login + email + KYC + balance.",
};

/** Map of intent → relevant knowledge section keys */
const intentKnowledgeMap: Record<string, string[]> = {
  faq: ['platform', 'faq'],
  status: ['platform'],
  onboarding: ['platform', 'kyc', 'login', 'account'],
  login: ['login', 'account'],
  trade: ['platform', 'trading', 'earlyExit', 'markets'],
  kyc: ['kyc', 'account'],
  billing: ['wallet', 'trading'],
  compliance: ['platform', 'kyc'],
  account_specific: ['account', 'wallet', 'portfolio', 'kyc'],
  wallet: ['wallet'],
  portfolio: ['portfolio', 'earlyExit'],
  leaderboard: ['leaderboard'],
  rewards: ['rewards'],
  social: ['social'],
};

/**
 * Return only the knowledge sections relevant to a detected intent.
 * Falls back to the full template for unknown intents.
 */
export function getKnowledgeForIntent(intent: string): string {
  const keys = intentKnowledgeMap[intent];
  if (!keys) return knowledgeBaseTemplate; // unknown → full knowledge
  const body = keys
    .map((k) => knowledgeSections[k])
    .filter(Boolean)
    .join('\n\n');
  return `# KNOWLEDGE BASE\n${body}`;
}
