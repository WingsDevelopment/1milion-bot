const axios = require("axios");
const cron = require("node-cron");
const fs = require("fs");
const path = require("path");
const TelegramBot = require("node-telegram-bot-api");
const BigNumber = require("bignumber.js");
require("dotenv").config();

//42161 - Arbitrum
// 137 - Polygon
// 42220 - celo
const minProfit = parseFloat(process.env.MIN_PROFIT);
const ignoreGreaterThenProfit = parseFloat(
  process.env.IGNORE_GREATER_THEN_PROFIT
);
// Your wallet address (replace with your actual address)
const YOUR_WALLET_ADDRESS = process.env.WALLET_ADDRESS;
const CHAIN_ID = process.env.CHAIN_ID;

require("dotenv").config(); // Load environment variables

const getTokenConfig = (addressEnv, decimalsEnv) => {
  const address = process.env[addressEnv];
  const decimals = process.env[decimalsEnv]
    ? parseInt(process.env[decimalsEnv], 18)
    : undefined;

  return address ? { address, decimals } : undefined;
};

const tokenConfig = {
  USDC: getTokenConfig("USDC_ADDRESS", "USDC_DECIMALS"),
  USDM: getTokenConfig("USDM_ADDRESS", "USDM_DECIMALS"),
  "USD+": getTokenConfig("USD_PLUS_ADDRESS", "USD_PLUS_DECIMALS"),
  DAI: getTokenConfig("DAI_ADDRESS", "DAI_DECIMALS"),
  eUSD: getTokenConfig("EUSD_ADDRESS", "EUSD_DECIMALS"),
  USDT: getTokenConfig("USDT_ADDRESS", "USDT_DECIMALS"),
};

console.log({ tokenConfig });

// Load or initialize state
let state = {
  currentTokenSymbol:
    Object.keys(tokenConfig)[parseInt(process.env.CURRENT_INDEX || 0)],
  currentBalance: process.env.CURRENT_BALANCE || "10000",
  numberOfSwaps: parseInt(process.env.NUMBER_OF_SWAPS || 0),
};

let currentTokenSymbol = state.currentTokenSymbol;
let currentTokenInfo = tokenConfig[currentTokenSymbol] || {};
let currentBalance = new BigNumber(state.currentBalance);
let currentNumberOfSwaps = state.numberOfSwaps;

// Telegram Bot Setup
const TELEGRAM_BOT_TOKEN = "7854882662:AAFUF1UkHmsRzttgS0KDfgHcIrJxX4EQ6Qw";
const CHAT_IDS = ["-4509621216"];
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });

// Function to get a quote
const getQuote = async (
  fromChain,
  toChain,
  fromToken,
  toToken,
  fromAmount,
  fromAddress
) => {
  try {
    const response = await axios.get("https://li.quest/v1/quote", {
      params: {
        fromChain,
        toChain,
        fromToken,
        toToken,
        fromAmount,
        fromAddress,
      },
    });
    return response.data;
  } catch (error) {
    console.error(
      `Error fetching quote from ${fromToken} to ${toToken}:`,
      error.response?.data?.message || error.message
    );
    return null;
  }
};

// Function to simulate trade
const simulateTrade = (quote) => {
  console.log("Simulating trade...");
  const fromAmountDisplay = new BigNumber(quote.action.fromAmount)
    .dividedBy(new BigNumber(10).pow(quote.action.fromToken.decimals))
    .toFixed(2);
  const toAmountDisplay = new BigNumber(quote.estimate.toAmount)
    .dividedBy(new BigNumber(10).pow(quote.action.toToken.decimals))
    .toFixed(2);

  console.log(
    `Trade executed: Swapped ${fromAmountDisplay} ${quote.action.fromToken.symbol} for ${toAmountDisplay} ${quote.action.toToken.symbol}`
  );
};

// Cron job running every 3 minutes
cron.schedule("*/4 * * * *", main);

async function main() {
  console.log("---------------------------------------");
  console.log(`Running process at ${new Date().toLocaleTimeString()}`);
  console.log(
    `Current balance: $${currentBalance.toFixed(2)} in ${currentTokenSymbol}`
  );

  const fromChain = CHAIN_ID; // Adjust if needed
  const toChain = CHAIN_ID;

  const fromTokenSymbol = currentTokenSymbol;
  const fromTokenInfo = currentTokenInfo;
  const fromTokenAddress = fromTokenInfo.address;
  const fromTokenDecimals = fromTokenInfo.decimals;

  let bestProfit = new BigNumber(-1e30); // Initialize to a large negative number
  let bestQuote = null;

  // Prepare all quote requests
  const quotePromises = [];

  if (!fromTokenInfo) {
    console.log("Token not found");
    return;
  }
  for (const [toTokenSymbol, toTokenInfo] of Object.entries(tokenConfig)) {
    if (toTokenSymbol === fromTokenSymbol || !toTokenInfo) continue;
    if (toTokenSymbol === fromTokenSymbol) continue;

    const toTokenAddress = toTokenInfo.address;
    const toTokenDecimals = toTokenInfo.decimals;

    const fromAmount = currentBalance
      .multipliedBy(new BigNumber(10).pow(fromTokenDecimals))
      .toFixed(0);

    // Prepare the quote promise
    const quotePromise = getQuote(
      fromChain,
      toChain,
      fromTokenAddress,
      toTokenAddress,
      fromAmount,
      YOUR_WALLET_ADDRESS
    ).then((quote) => {
      if (!quote) return null;

      // Calculate potential profit
      const toAmount = new BigNumber(quote.estimate.toAmount).dividedBy(
        new BigNumber(10).pow(toTokenDecimals)
      );
      const potentialProfit = toAmount.minus(currentBalance);

      console.log(
        `Potential trade from ${fromTokenSymbol} to ${toTokenSymbol}:`
      );
      console.log(`  Receive amount: $${toAmount.toFixed(2)}`);
      console.log(`  Potential profit: $${potentialProfit.toFixed(2)}`);

      if (
        potentialProfit.isGreaterThan(bestProfit) &&
        potentialProfit.isLessThan(ignoreGreaterThenProfit) &&
        potentialProfit.isGreaterThan(minProfit)
      ) {
        bestProfit = potentialProfit;
        bestQuote = quote;
      }
    });

    quotePromises.push(quotePromise);
  }

  // Run all quote requests in parallel
  await Promise.all(quotePromises);
  console.log({ bestQuote });

  // Simulate the best trade if profitable
  if (bestQuote && bestProfit.isGreaterThan(0)) {
    simulateTrade(bestQuote);
    // Update state
    currentBalance = currentBalance.plus(bestProfit);
    currentTokenSymbol = bestQuote.action.toToken.symbol;
    currentTokenInfo = tokenConfig[currentTokenSymbol];
    currentNumberOfSwaps += 1;

    console.log(
      `Updated balance: $${currentBalance.toFixed(2)} in ${currentTokenSymbol}
      Number of swaps: ${currentNumberOfSwaps}
      No fees are included in the profit calculation`
    );
  } else {
    console.log("No profitable trade found.");
  }
}

const configMessage = `\n
*MinProfit:* ${minProfit} \n
*IgnoreGreaterThenProfit:* ${ignoreGreaterThenProfit}
*WalletAddress:* ${YOUR_WALLET_ADDRESS}
*ChainId:* ${CHAIN_ID}
*CurrentTokenSymbol:* ${currentTokenSymbol}
*CurrentBalance:* ${currentBalance.toFixed(2)}`;

cron.schedule("0 * * * *", () => {
  const message = `Current balance: $${currentBalance.toFixed(
    2
  )} in ${currentTokenSymbol}\n
*Number of swaps:* ${currentNumberOfSwaps} \n
*Note:* No fees are included in the profit calculation ${configMessage}`;
  sendTelegramMessage(message);
  console.log(`Telegram message sent: ${message}`);
});

async function sendTelegramMessage(message) {
  try {
    await Promise.all(
      CHAT_IDS.map((chatId) =>
        bot.sendMessage(chatId, message, { parse_mode: "Markdown" })
      )
    );
    console.log("Message sent to all chat IDs.");
  } catch (error) {
    console.error("Failed to send message to all chat IDs:");
  }
}

// sendTelegramMessage(
//   `Ovooo, cao ja sam stojce! I moj config je: ${configMessage}`
// );
