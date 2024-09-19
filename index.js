const axios = require("axios");
const cron = require("node-cron");
const fs = require("fs");
const path = require("path");
const TelegramBot = require("node-telegram-bot-api");
const BigNumber = require("bignumber.js");
require("dotenv").config();

const minProfit = parseFloat(process.env.MIN_PROFIT);
const ignoreGreaterThenProfit = parseFloat(
  process.env.IGNORE_GREATER_THEN_PROFIT
);
// Your wallet address (replace with your actual address)
const YOUR_WALLET_ADDRESS = process.env.WALLET_ADDRESS;

// Token configuration with decimals
const tokenConfig = {
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

// Paths
const stateFilePath = path.join(__dirname, "state.json");

// Load or initialize state
let state = {
  currentTokenSymbol: Object.keys(tokenConfig)[0],
  currentBalance: "10000", // Starting with $10,000 as a string
  numberOfSwaps: 0,
};

// Load state from file
if (fs.existsSync(stateFilePath)) {
  const savedState = fs.readFileSync(stateFilePath, "utf8");
  state = JSON.parse(savedState);
} else {
  // Save initial state
  fs.writeFileSync(stateFilePath, JSON.stringify(state, null, 2));
}

let currentTokenSymbol = state.currentTokenSymbol;
let currentTokenInfo = tokenConfig[currentTokenSymbol];
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

// Function to save state to file
const saveState = () => {
  const newState = {
    currentTokenSymbol,
    currentBalance: currentBalance.toString(),
    numberOfSwaps: currentNumberOfSwaps,
  };
  fs.writeFileSync(stateFilePath, JSON.stringify(newState, null, 2));
};

// Cron job running every 3 minutes
cron.schedule("*/6 * * * *", main);

async function main() {
  console.log("---------------------------------------");
  console.log(`Running process at ${new Date().toLocaleTimeString()}`);
  console.log(
    `Current balance: $${currentBalance.toFixed(2)} in ${currentTokenSymbol}`
  );

  const fromChain = "8453"; // Adjust if needed
  const toChain = "8453";

  const fromTokenSymbol = currentTokenSymbol;
  const fromTokenInfo = currentTokenInfo;
  const fromTokenAddress = fromTokenInfo.address;
  const fromTokenDecimals = fromTokenInfo.decimals;

  let bestProfit = new BigNumber(-1e30); // Initialize to a large negative number
  let bestQuote = null;

  // Prepare all quote requests
  const quotePromises = [];

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
    // Save state to file
    saveState();
  } else {
    console.log("No profitable trade found.");
  }
}

const configMessage = `\n
*MinProfit:* ${minProfit} \n
*IgnoreGreaterThenProfit:* ${ignoreGreaterThenProfit}
*WalletAddress:* ${YOUR_WALLET_ADDRESS}`;

cron.schedule("0 * * * *", () => {
  const message = `Current balance: $${currentBalance.toFixed(
    2
  )} in ${currentTokenSymbol} \n
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

sendTelegramMessage(
  `Ovooo, cao ja sam stojce! I moj config je: ${configMessage}`
);
