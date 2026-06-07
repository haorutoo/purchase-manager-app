import {onCall, HttpsError} from "firebase-functions/v2/https";
import {defineSecret} from "firebase-functions/params";
import {ethers} from "ethers";

const privateKeySecret = defineSecret("SOMNIA_PRIVATE_KEY");
const CONTRACT_ADDRESS = "0xcac3e553f28cc4d0fb994364b9f83366cb1cb78a";
const RPC_URL = "https://api.infra.testnet.somnia.network";

const ABI = [
  "function updatePolicy(string calldata newRules) external payable returns (uint256)",
];

export const updatePolicy = onCall(
  {
    secrets: [privateKeySecret],
    timeoutSeconds: 120,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }

    const {policy} = request.data;
    if (!policy || typeof policy !== "string") {
      throw new HttpsError("invalid-argument", "Policy must be a non-empty string");
    }

    try {
      const provider = new ethers.JsonRpcProvider(RPC_URL);
      const wallet = new ethers.Wallet(privateKeySecret.value(), provider);
      const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);

      const deposit = ethers.parseUnits("1.0", "ether");

      const tx = await contract.updatePolicy(policy, {value: deposit});
      await tx.wait();

      return {success: true, txHash: tx.hash};
    } catch (error: any) {
      console.error("Error updating policy:", error);
      throw new HttpsError("internal", `Failed to update policy: ${error.message || error}`);
    }
  }
);
