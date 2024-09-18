const axios = require("axios");
const cron = require("node-cron");

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

// State to keep track of current token and balance
let currentTokenSymbol = Object.keys(tokenConfig)[0];
let currentTokenInfo = tokenConfig[currentTokenSymbol];
let currentBalance = 10000; // Starting with $10,000

// Your wallet address (replace with your actual address)
const YOUR_WALLET_ADDRESS = "0x9ed042A64AD65BBcC645832921618738D709Ca67";

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

  // Iterate over all other tokens to get quotes
  for (const [toTokenSymbol, toTokenInfo] of Object.entries(tokenConfig)) {
    if (toTokenSymbol === fromTokenSymbol) continue;

    const toTokenAddress = toTokenInfo.address;
    const toTokenDecimals = toTokenInfo.decimals;

    const fromAmount = (
      currentBalance * Math.pow(10, fromTokenDecimals)
    ).toFixed(0);

    const quote = await getQuote(
      fromChain,
      toChain,
      fromTokenAddress,
      toTokenAddress,
      fromAmount,
      YOUR_WALLET_ADDRESS
    );

    if (!quote) continue;

    // Calculate potential profit
    const toAmount = quote.estimate.toAmount / Math.pow(10, toTokenDecimals);
    const potentialProfit = toAmount - currentBalance;

    console.log(`Potential trade from ${fromTokenSymbol} to ${toTokenSymbol}:`);
    console.log(`  Receive amount: $${toAmount.toFixed(2)}`);
    console.log(`  Potential profit: $${potentialProfit.toFixed(2)}`);

    if (potentialProfit > bestProfit && potentialProfit < 30) {
      bestProfit = potentialProfit;
      bestQuote = quote;
    }
  }

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
  } else {
    console.log("No profitable trade found.");
  }
});
