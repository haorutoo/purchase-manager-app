// --- /dev/null
import { ethers } from "ethers";
import * as admin from "firebase-admin";

// Initialize Firebase Admin (Requires your Firebase service account key)
// Ensure you have downloaded the JSON from your Firebase Project Settings
const serviceAccount = require("./firebase-service-account.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

const CONTRACT_ADDRESS = "0xcac3e553f28cc4d0fb994364b9f83366cb1cb78a";
const RPC_URL = "https://api.infra.testnet.somnia.network";

// We only need the ABI for the event we are listening to
const ABI = [
  "event ListProcessed(uint256 indexed requestId, string resultJson)"
];

async function main() {
  console.log("Starting Somnia AI -> Firestore Bridge...");

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);

  console.log(`Listening for 'ListProcessed' events on ${CONTRACT_ADDRESS}...`);

  // Listen for the AI Agent callback event
  contract.on("ListProcessed", async (requestId, resultJson, event) => {
    console.log(`\n🔔 Event Received! Request ID: `);
    
    try {
      // Parse the JSON array returned by the Somnia LLM Agent
      const parsedList = JSON.parse(resultJson);
      console.log("Parsed AI Output:", parsedList);

      // Filter out rejected items so we only save the cart items
      const approvedItems = parsedList.filter((item: any) => item.approved === true);

      // Save to Firestore
      const docRef = db.collection("approvedCarts").doc(requestId.toString());
      await docRef.set({
        requestId: requestId.toString(),
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        rawOutput: parsedList,
        cartItems: approvedItems,
        status: "Awaiting Manager Checkout"
      });

      console.log(`✅ Cart saved to Firestore Document: ${docRef.id}`);
      // From here, your existing Firebase infrastructure can trigger an email,
      // push notification, or update a Manager Dashboard UI!

    } catch (error) {
      console.error("❌ Failed to parse or save AI response:", error);
      console.error("Raw string was:", resultJson);
    }
  });
}

main().catch(console.error);
