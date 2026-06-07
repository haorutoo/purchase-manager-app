import {onDocumentCreated} from "firebase-functions/v2/firestore";
import {defineSecret} from "firebase-functions/params";
import {ethers} from "ethers";
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
  // eslint-disable-next-line max-len
  "function submitPurchaseList(string calldata items) external payable returns (uint256)",
  "event ListProcessed(uint256 indexed requestId, string resultJson)",
  "event RequestFailed(uint256 indexed requestId, uint8 status)",
  // eslint-disable-next-line max-len
  "event ListSubmitted(uint256 indexed requestId, address indexed user, string items)",
];

export const invokeSomniaAgent = onDocumentCreated(
  {
    document: "pendingPurchases/{docId}",
    secrets: [privateKeySecret],
    timeoutSeconds: 300, // 5 mins (allows for 3-minute polling timeout)
  },
  async (event) => {
    const docSnap = event.data;
    if (!docSnap) return;

    // Helper to log messages to both the console and the Firestore document
    const addLog = async (msg: string) => {
      console.log(msg); // Keep console.log as a fallback
      try {
        const logStr = `${new Date().toISOString()} - ${msg}`;
        await docSnap.ref.update({
          logs: admin.firestore.FieldValue.arrayUnion(logStr),
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

    await addLog("=== Purchase Manager — Invoking Somnia LLM Agent ===");
    await addLog(`📝 Submitting purchase list: "${testItems}"`);

    // Initialize Ethers provider and wallet
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(privateKeySecret.value(), provider);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);

    const MAX_ATTEMPTS = 3;
    let attempt = 0;
    let success = false;

    while (attempt < MAX_ATTEMPTS && !success) {
      attempt++;
      if (attempt > 1) {
        await addLog(`\n🔄 Retrying request... (Attempt ${attempt} of ${MAX_ATTEMPTS})`);
      }

      try {
        // Send a massive 1.0 STT deposit to ensure validators pick it up immediately!
        // Unused funds are automatically rebated by the platform.
        const deposit = ethers.parseUnits("1.0", "ether");

        // 1. Submit the Transaction
        // eslint-disable-next-line max-len
        const tx = await contract.submitPurchaseList(testItems, {value: deposit});
        await addLog(`Transaction submitted: ${tx.hash}`);

        // Update Firestore document to indicate it's processing
        await docSnap.ref.update({
          status: `Submitting to AI Agent (Attempt ${attempt})`,
          txHash: tx.hash,
        });

        const receipt = await tx.wait();
        await addLog(`Confirmed in block ${receipt.blockNumber}`);

        // Extract the exact requestId from the transaction receipt
        let currentRequestId;
        for (const log of receipt?.logs || []) {
          try {
            const parsed = contract.interface.parseLog(log);
            if (parsed && parsed.name === "ListSubmitted") {
              currentRequestId = parsed.args[0];
            }
          } catch (e) {
            /* ignore non-matching logs */
          }
        }
        await addLog(`Tracking specific Request ID: ${currentRequestId}`);

        // 2. Poll for Results
        await addLog("⏳ Waiting for Somnia Agent consensus decisions...");
        const startBlock = receipt.blockNumber;
        const startTime = Date.now();
        const TIMEOUT = 120_000; // 2 minutes per attempt

        let attemptFinished = false;

        while (Date.now() - startTime < TIMEOUT && !attemptFinished) {
          // Check for successful processing
          // eslint-disable-next-line new-cap, max-len
          const successEvents = await contract.queryFilter(contract.filters.ListProcessed(currentRequestId), startBlock);
          if (successEvents.length > 0) {
            await addLog("✅ List Processed! Event captured in Cloud Function.");

            let aiResult = [];
            try {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              let rawJson = (successEvents[0] as any).args[1];
              // Clean markdown formatting if the LLM added it
              if (rawJson.startsWith("```json")) {
                rawJson = rawJson
                  .replace(/```json/g, "")
                  .replace(/```/g, "")
                  .trim();
              }
              aiResult = JSON.parse(rawJson);
            } catch (err) {
              console.error("Failed to parse JSON", err);
            }

            await docSnap.ref.update({
              status: "Completed via Cloud Function Polling",
              aiResult: aiResult,
            });
            success = true;
            return; // Break completely out of the Cloud Function!
          }

          // Check for execution failures
          // eslint-disable-next-line new-cap, max-len
          const failedEvents = await contract.queryFilter(contract.filters.RequestFailed(currentRequestId), startBlock);
          if (failedEvents.length > 0) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const statusCode = (failedEvents[0] as any).args[1].toString();

            let reason = "Unknown Error";
            // eslint-disable-next-line max-len
            if (statusCode === "2") reason = "Consensus Failed (Nodes disagreed on output)";
            if (statusCode === "3") reason = "Timeout (Network took too long)";
            if (statusCode === "4") reason = "Execution Error (Agent crashed)";

            // eslint-disable-next-line max-len
            await addLog(`❌ Agent execution failed. Reason: ${reason} (Code: ${statusCode})`);

            if (attempt === MAX_ATTEMPTS) {
              await docSnap.ref.update({status: `Failed: ${reason}`});
            }
            attemptFinished = true; // Break the polling loop to trigger a retry
          } else {
            // Wait 3 seconds before querying the blockchain again
            await new Promise((resolve) => setTimeout(resolve, 3000));
          }
        }

        if (!attemptFinished) {
          await addLog("⏰ Timeout. Agent execution took too long on this attempt.");
          if (attempt === MAX_ATTEMPTS) {
            await docSnap.ref.update({status: "Failed: Timeout"});
          }
        }
      } catch (error) {
        await addLog(`❌ Failed to invoke contract: ${String(error)}`);
        if (attempt === MAX_ATTEMPTS) {
          await docSnap.ref.update({status: "Error", error: String(error)});
        }
      }

      // Wait 5 seconds before making the next attempt
      if (!success && attempt < MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }

    if (!success) {
      await addLog("❌ All retry attempts failed. Please try again later.");
    }
  }
);
