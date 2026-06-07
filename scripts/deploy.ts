// --- /dev/null
import hre from "hardhat";
import "@nomicfoundation/hardhat-viem";

async function main() {
  console.log("Deploying PurchaseManager to Somnia Testnet...\n");

  const initialRules = "Budget is generous, but only office supplies, coffee, and developer tools are allowed. Reject luxury items, personal clothing, and video games.";
  
  const manager = await hre.viem.deployContract("PurchaseManager", [initialRules]);

  console.log(`✅ PurchaseManager deployed at: ${manager.address}`);
  console.log(`\nNext steps:`);
  console.log(`  1. Copy the contract address.`);
  console.log(`  2. Add it to your Firebase Listener script.`);
  console.log(`  3. Users can now call submitPurchaseList(items) sending ~1.0 STT as deposit.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
