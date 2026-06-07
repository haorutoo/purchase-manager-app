import hre from "hardhat";
import "@nomicfoundation/hardhat-viem";
import { parseUnits } from "viem";

const CONTRACT_ADDRESS = (process.env.CONTRACT_ADDRESS || "0xYOUR_DEPLOYED_ADDRESS") as `0x${string}`;
const POLL_INTERVAL = 3000;
const TIMEOUT = 180_000; // 3 minutes timeout for agents

async function main() {
  console.log("=== Purchase Manager — Invoking Somnia LLM Agent ===\n");

  if (CONTRACT_ADDRESS === "0xYOUR_DEPLOYED_ADDRESS") {
    console.error("❌ Error: Please set the CONTRACT_ADDRESS environment variable or edit the script.");
    process.exit(1);
  }

  const manager = await hre.viem.getContractAt("PurchaseManager", CONTRACT_ADDRESS);
  const publicClient = await hre.viem.getPublicClient();

  // As recommended in deploy.ts, we send 1 instead of ~0.05 STT to cover the platform deposit
  const deposit = parseUnits("1.0", 18);

  // Testing a much simpler prompt to see if the network can process it without timing out
  const testItems = "1 pen";

  console.log(`\n📝 Submitting purchase list to LLM Auditor...`);
  console.log(`   - Items: "${testItems}"`);
  console.log(`   - Deposit: 0.05 STT`);

  const hash = await manager.write.submitPurchaseList([testItems], {
    value: deposit,
  });
  
  console.log(`Transaction submitted: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`Confirmed in block ${receipt.blockNumber}`);

  // Poll for Results
  console.log("\n⏳ Waiting for Somnia Agent consensus decisions...");
  console.log("   (The LLM is processing the list based on policy rules)\n");

  const startBlock = receipt.blockNumber;
  const startTime = Date.now();

  while (Date.now() - startTime < TIMEOUT) {
    // Check for successful processing
    const processedEvents = await manager.getEvents.ListProcessed({}, { fromBlock: startBlock });
    if (processedEvents.length > 0) {
      for (const event of processedEvents) {
        console.log(`✅ List Processed! Request ID: ${event.args.requestId}`);
        console.log(`\n📜 Raw JSON Output from AI:\n${event.args.resultJson}\n`);
      }
      process.exit(0);
    }

    // Check for execution failures
    const failedEvents = await manager.getEvents.RequestFailed({}, { fromBlock: startBlock });
    if (failedEvents.length > 0) {
      for (const event of failedEvents) {
        console.log(`❌ Agent execution failed: Status ${event.args.status}`);
      }
      process.exit(1);
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
  }

  console.log(`\n⏰ Timeout. Agent execution took too long.`);
  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});