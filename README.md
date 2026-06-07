# Somnia AI Purchase Manager

An AI-powered, decentralized procurement management app built on the **Somnia Network** and **Firebase**. 

This application allows employees (Requesters) to submit supply requests, which are automatically audited in real-time by a **Somnia LLM Agent** against smart contract rules on the Somnia Blockchain. Approved items are sent to the Manager's dashboard for purchase tracking, where managers can mark them as ordered, set estimated delivery dates, and search the web for the best deals using **Gemini-2.5-flash with Google Search tools**.

## 🚀 Live Demo
Test the live application here: **[https://somnia-purchase-manager.web.app](https://somnia-purchase-manager.web.app)**

---

## 🛠️ Project Structure

- **`/public`**: Clean and responsive HTML/CSS/JS front-end.
  - Styled with custom CSS variables, **Plus Jakarta Sans** typography, and a balanced, muted color scheme.
  - Interacts with Firebase Auth (Email/Password & SMS OTP), Cloud Firestore, and blockchain query providers directly.
- **`/contracts`**: Hardhat project containing the `PurchaseManager.sol` smart contract.
  - Tracks strict policies and submits requested items to the Somnia LLM Agent.
- **`/functions`**: Firebase Cloud Functions v2.
  - `invokeTrigger.ts`: Listens for new pending purchases, submits request transactions to the Somnia Network, and polls for consensus decisions.
  - `updatePolicy.ts`: Interacts with the smart contract to update procurement rules.
  - `searchPrices.ts`: Uses Gemini AI with Google Search tools to crawl the web for the best deals.

---

## ⚙️ Smart Contract Setup

The smart contract is written in Solidity and compiled/deployed via **Hardhat**.

### 1. Installation
Navigate to the project root directory and install dependencies:
```bash
npm install
```

### 2. Configure Environment
Create a `.env` file in the root of the app:
```env
PRIVATE_KEY=your_64_character_wallet_private_key_without_0x
CONTRACT_ADDRESS=deployed_contract_address
```

### 3. Build & Deploy Smart Contract
Compile the contracts:
```bash
npx hardhat compile
```
Deploy the contract to the Somnia Testnet:
```bash
npx hardhat run scripts/deploy.ts --network somnia
```

---

## 📡 Firebase Backend Functions Setup

### 1. Prerequisites
Ensure you have the Firebase CLI installed and are logged in:
```bash
npm install -g firebase-tools
firebase login
```

### 2. Firebase Secrets Configuration
The backend functions require two secrets to run securely (managed by Google Cloud Secret Manager):
1. **`SOMNIA_PRIVATE_KEY`**: Your wallet private key used to sign transaction requests on the Somnia Testnet.
2. **`GEMINI_API_KEY`**: Your Gemini API key used to query the Gemini-2.5-flash model with search tools.

Set these secrets using the Firebase CLI inside the project directory:
```bash
firebase functions:secrets:set SOMNIA_PRIVATE_KEY="your_private_key_here"
firebase functions:secrets:set GEMINI_API_KEY="your_gemini_api_key_here"
```

### 3. Deploy Functions
Deploy the Firebase Functions to your Firebase project:
```bash
firebase deploy --only functions
```

---

## 💻 Running the App Locally

### 1. Emulators for Cloud Functions & Firestore
You can run the Firebase environment locally with Emulators:
```bash
firebase emulators:start
```

### 2. Live Testing the Frontend
Deploy the frontend files to Firebase Hosting:
```bash
firebase deploy --only hosting
```
Or open the `/public/index.html` file in your browser to interact with the frontend locally (ensure your Firestore database rules permit access).

---

## 📄 License
This project is open-source and licensed under the MIT License.
