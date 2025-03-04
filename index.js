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
const CHAIN_ID = parseInt(process.env.CHAIN_ID);

const tokenConfigBase = {
  USDC: {
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    decimals: 6,
  },
  USDM: {
    address: "0x59D9356E565Ab3A36dD77763Fc0d87fEaf85508C",
    decimals: 18,
  },
  "USD+": {
    address: "0xB79DD08EA68A908A97220C76d19A6aA9cBDE4376",
    decimals: 6,
  },
  DAI: {
    address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
    decimals: 18,
  },
  eUSD: {
    address: "0xCfA3Ef56d303AE4fAabA0592388F19D7C3399FB4",
    decimals: 18,
  },
};

const tokenConfigCelo = {
  USDC: {
    address: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
    decimals: 6,
  },
  USDT: {
    address: "0x617f3112bf5397D0467D315cC709EF968D9ba546",
    decimals: 6,
  },
  CUSD: {
    address: "0x765DE816845861e75A25fCA122bb6898B8B1282a",
    decimals: 18,
  },
};

const tokenConfigArbitrum = {
  USDC: {
    address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    decimals: 6,
  },
  USDM: {
    address: "0x59D9356E565Ab3A36dD77763Fc0d87fEaf85508C",
    decimals: 18,
  },
  "USD+": {
    address: "0xe80772Eaf6e2E18B651F160Bc9158b2A5caFCA65",
    decimals: 6,
  },
  DAI: {
    address: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
    decimals: 18,
  },
  USDT: {
    address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
    decimals: 6,
  },
};

const getTokenConfig = () => {
  if (CHAIN_ID == 42161) {
    return tokenConfigArbitrum;
  } else if (CHAIN_ID == 8453) {
    return tokenConfigBase;
  } else {
    return tokenConfigCelo;
  }
};

const tokenConfig = getTokenConfig();

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
let previousUsdcAmount = currentBalance;

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

  let usdcProfit = new BigNumber(-1e30);
  let usdcQuote = null;

  // Prepare all quote requests
  const quotePromises = [];

  if (!fromTokenInfo) {
    console.log("Token not found");
    return;
  }
  for (const [toTokenSymbol, toTokenInfo] of Object.entries(tokenConfig)) {
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
      if (
        toTokenSymbol === "USDC" &&
        currentBalance
          .plus(potentialProfit)
          .isGreaterThan(previousUsdcAmount + minProfit) &&
        potentialProfit.isLessThan(ignoreGreaterThenProfit)
      ) {
        usdcProfit = potentialProfit;
        usdcQuote = quote;
      }
    });

    quotePromises.push(quotePromise);
  }

  // Run all quote requests in parallel
  await Promise.all(quotePromises);

  let quote = bestQuote || usdcQuote;
  let profit = bestProfit || usdcProfit;

  // Simulate the best trade if profitable
  if (quote && profit.isGreaterThan(0)) {
    simulateTrade(quote);
    // Update state
    currentTokenSymbol = quote.action.toToken.symbol;
    currentBalance = currentBalance.plus(profit);
    currentTokenInfo = tokenConfig[currentTokenSymbol];
    currentNumberOfSwaps += 1;
    if (currentTokenSymbol === "USDC") {
      previousUsdcAmount = currentBalance;
    }

    console.log(
      `Updated balance: $${currentBalance.toFixed(2)} in ${currentTokenSymbol}
      Number of swaps: ${currentNumberOfSwaps}
      No fees are included in the profit calculation
      ${usdcProfit ? `USDC profit: $${usdcProfit.toFixed(2)}` : ""}`
    );
    if (!bestProfit) {
      console.log("Trade to USDC has been made.");
    }
  } else {
    console.log("No profitable trade found.");
  }
}

main();

const configMessage = `\n
*MinProfit:* ${minProfit} \n
*IgnoreGreaterThenProfit:* ${ignoreGreaterThenProfit}
*WalletAddress:* ${YOUR_WALLET_ADDRESS}
*ChainId:* ${CHAIN_ID}
*CurrentTokenSymbol:* ${currentTokenSymbol}
*CurrentBalance:* ${currentBalance.toFixed(2)}`;

cron.schedule("0 * * * *", () => {
  const message = `Version 2.0-stj \n
  Current balance: $${currentBalance.toFixed(2)} in ${currentTokenSymbol}\n
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
