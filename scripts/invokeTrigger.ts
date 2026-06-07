import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { defineSecret } from "firebase-functions/params";
import { ethers } from "ethers";
import * as admin from "firebase-admin";

// Initialize Firebase Admin if not already initialized
if (!admin.apps.length) {
  admin.initializeApp();
}

// Define the secret that holds your 64-character private key
// You will need to create this in Google Cloud Secret Manager
const privateKeySecret = defineSecret("SOMNIA_PRIVATE_KEY");

const CONTRACT_ADDRESS = "0xcac3e553f28cc4d0fb994364b9f83366cb1cb78a";
const RPC_URL = "https://api.infra.testnet.somnia.network";

// We only need the ABI for the functions/events we interact with
const ABI = [
  "function submitPurchaseList(string calldata items) external payable returns (uint256)",
  "event ListProcessed(uint256 indexed requestId, string resultJson)",
  "event RequestFailed(uint256 indexed requestId, uint8 status)"
];

export const invokeSomniaAgent = onDocumentCreated(
  {
    document: "pendingPurchases/{docId}",
    secrets: [privateKeySecret],
    timeoutSeconds: 300 // 5 minutes (to allow for the 3-minute polling timeout)
  },
  async (event) => {
    const docSnap = event.data;
    if (!docSnap) return;

    // Helper to log messages to both the console and the Firestore document
    const addLog = async (msg: string) => {
      console.log(msg); // Keep console.log as a fallback
      try {
        await docSnap.ref.update({
          logs: admin.firestore.FieldValue.arrayUnion(`${new Date().toISOString()} - ${msg}`)
        });
      } catch (e) {
        console.error("Failed to write log to Firestore:", e);
      }
    };

    const data = docSnap.data();
    const testItems = data.items;

    if (!testItems) {
      console.error("No 'items' field found in document.");
      return;
    }

    console.log("=== Purchase Manager — Invoking Somnia LLM Agent ===");
    console.log(`📝 Submitting purchase list: "${testItems}"`);

    // Initialize Ethers provider and wallet
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(privateKeySecret.value(), provider);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);

    try {
      // We send 1.0 STT to cover the platform deposit (as recommended)
      const deposit = ethers.parseUnits("1.0", "ether");

      // 1. Submit the Transaction
      const tx = await contract.submitPurchaseList(testItems, { value: deposit });
      console.log(`Transaction submitted: ${tx.hash}`);
      
      // Update Firestore document to indicate it's processing
      await docSnap.ref.update({ status: "Submitting to AI Agent", txHash: tx.hash });

      const receipt = await tx.wait();
      console.log(`Confirmed in block ${receipt.blockNumber}`);

      // 2. Poll for Results
      console.log("⏳ Waiting for Somnia Agent consensus decisions...");
      const startBlock = receipt.blockNumber;
      const startTime = Date.now();
      const TIMEOUT = 180_000; // 3 minutes

      while (Date.now() - startTime < TIMEOUT) {
        // Check for successful processing
        const successEvents = await contract.queryFilter(contract.filters.ListProcessed(), startBlock);
        if (successEvents.length > 0) {
          console.log(`✅ List Processed! Event captured in Cloud Function.`);
          await docSnap.ref.update({ status: "Completed via Cloud Function Polling" });
          return;
        }

        // Check for execution failures
        const failedEvents = await contract.queryFilter(contract.filters.RequestFailed(), startBlock);
        if (failedEvents.length > 0) {
          console.log(`❌ Agent execution failed.`);
          await docSnap.ref.update({ status: "Agent Execution Failed" });
          return;
        }

        // Wait 3 seconds before querying the blockchain again
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }

      console.log(`⏰ Timeout. Agent execution took too long.`);
      await docSnap.ref.update({ status: "Timeout" });

    } catch (error) {
      console.error("❌ Failed to invoke contract:", error);
      await docSnap.ref.update({ status: "Error", error: String(error) });
    }
  }
);