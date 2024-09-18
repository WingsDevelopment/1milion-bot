const axios = require("axios");
const cron = require("node-cron");
const fs = require("fs");
const path = require("path");
const TelegramBot = require("node-telegram-bot-api");

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
  USDz: {
    address: "0x04D5ddf5f3a8939889F11E97f8c4BB48317F1938",
    decimals: 18,
  },
  "USD+": {
    address: "0xB79DD08EA68A908A97220C76d19A6aA9cBDE4376",
    decimals: 6,
  },
  DOLA: {
    address: "0x4621b7A9c75199271F773Ebd9A499dbd165c3191",
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
  currentBalance: 10000, // Starting with $10,000
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
let currentBalance = state.currentBalance;

// Your wallet address (replace with your actual address)
const YOUR_WALLET_ADDRESS = "0x9ed042A64AD65BBcC645832921618738D709Ca67";

// Telegram Bot Setup
const TELEGRAM_BOT_TOKEN = "7854882662:AAFUF1UkHmsRzttgS0KDfgHcIrJxX4EQ6Qw";
const CHAT_ID = "6416507389"; // Replace with your chat ID
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
  console.log(
    `Trade executed: Swapped ${(
      quote.action.fromAmount / Math.pow(10, quote.action.fromToken.decimals)
    ).toFixed(2)} ${quote.action.fromToken.symbol} for ${(
      quote.estimate.toAmount / Math.pow(10, quote.action.toToken.decimals)
    ).toFixed(2)} ${quote.action.toToken.symbol}`
  );
};

// Function to save state to file
const saveState = () => {
  const newState = {
    currentTokenSymbol,
    currentBalance,
  };
  fs.writeFileSync(stateFilePath, JSON.stringify(newState, null, 2));
};

// Cron job running every 3 minutes
cron.schedule("*/3 * * * *", async () => {
  console.log("---------------------------------------");
  console.log(`Running process at ${new Date().toLocaleTimeString()}`);
  console.log(
    `Current balance: $${currentBalance.toFixed(2)} in ${currentTokenSymbol}`
  );

  const fromChain = "8453"; // Assuming tokens are on Ethereum; adjust if needed
  const toChain = "8453";

  const fromTokenSymbol = currentTokenSymbol;
  const fromTokenInfo = currentTokenInfo;
  const fromTokenAddress = fromTokenInfo.address;
  const fromTokenDecimals = fromTokenInfo.decimals;

  let bestProfit = -Infinity;
  let bestQuote = null;

  // Prepare all quote requests
  const quotePromises = [];

  for (const [toTokenSymbol, toTokenInfo] of Object.entries(tokenConfig)) {
    if (toTokenSymbol === fromTokenSymbol) continue;

    const toTokenAddress = toTokenInfo.address;
    const toTokenDecimals = toTokenInfo.decimals;

    const fromAmount = (
      currentBalance * Math.pow(10, fromTokenDecimals)
    ).toFixed(0);

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
      const toAmount = quote.estimate.toAmount / Math.pow(10, toTokenDecimals);
      const potentialProfit = toAmount - currentBalance;

      console.log(
        `Potential trade from ${fromTokenSymbol} to ${toTokenSymbol}:`
      );
      console.log(`  Receive amount: $${toAmount.toFixed(2)}`);
      console.log(`  Potential profit: $${potentialProfit.toFixed(2)}`);

      if (potentialProfit > bestProfit && potentialProfit < 30) {
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
  if (bestQuote && bestProfit > 0) {
    simulateTrade(bestQuote);
    // Update state
    currentBalance += bestProfit;
    currentTokenSymbol = bestQuote.action.toToken.symbol;
    currentTokenInfo = tokenConfig[currentTokenSymbol];
    console.log(
      `Updated balance: $${currentBalance.toFixed(2)} in ${currentTokenSymbol}`
    );
    // Save state to file
    saveState();
  } else {
    console.log("No profitable trade found.");
  }
});

// Cron job to send Telegram balance update every hour
cron.schedule("0 * * * *", () => {
  const message = `Current balance: $${currentBalance.toFixed(
    2
  )} in ${currentTokenSymbol}`;
  bot.sendMessage(CHAT_ID, message);
  console.log(`Telegram message sent: ${message}`);
});
