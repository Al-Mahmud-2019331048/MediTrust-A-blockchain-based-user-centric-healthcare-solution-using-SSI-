## 🚀 Patient-Centric SSI Solution with Credo

### Overview

This project implements a patient-centric Self-Sovereign Identity (SSI) solution using Credo (formerly Aries Framework JavaScript). The system enables:

- 🏥 Government agencies to issue identity credentials to patients
- 👨‍⚕️ Doctors to issue medical documents (prescriptions, lab reports) as verifiable credentials
- 💊 Pharmacists to verify these credentials before providing services
- 🔒 Patients to control their identity and medical data in a secure wallet

### System Architecture

The solution consists of three main agent types:

1. **Issuer (Government)** - Issues identity credentials to patients
2. **Doctor** - Verifies patient identity and issues medical document credentials
3. **Pharmacist** - Verifies medical documents before dispensing medication

All medical documents are stored on IPFS with metadata in a decentralized database (Tableland), ensuring data integrity and availability.

## 🚀 Demonstration Setup Guide for Credo

Credo (formerly Aries Framework JavaScript) is a TypeScript/JavaScript framework for building Self-Sovereign Identity (SSI) solutions. It provides:
- 🌐 Modern web-based SSI implementation
- 🔐 Secure credential management
- 📱 Mobile-first architecture
- 🤝 Agent-to-agent communication
- 📜 Verifiable credential issuance and verification

<div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">

### 📁 Directory Structure

```
/
├── demo/
│   ├── acapy/
│   │
│   └── credo/
│
└── interface/
```

### ⚙️ Prerequisites

<div style="border-left: 4px solid #007bff; padding-left: 20px; margin: 15px 0;">

- Node.js (v18)
- Yarn package manager
- Git

</div>

### 🔧 Credo Agent Setup (demo/credo)

Install Ngrok first and get authtoken from their website.

```bash
# To start ngrok on port 4001 and 4002, edit the ngrok.yml
nano /home/{your-user-name}/.ngrok2/ngrok.yml
```
Edit the ngrok.yml file as following:
```
authtoken: your-ngrok-authtoken
version: "2"
tunnels:
    first:
        addr: 4001
        proto: http
    second:
        addr: 4002
        proto: http
    third:
        addr: 4003
        proto: http
    fourth:
        addr: 4005
        proto: http
```

Save the file by pressing ctrl+O and exit the nano by ctrl+x.

### 🏥 Patient-Centric SSI Solution Usage

1. **Setup Environment**

   Copy the template environment file and update it with your configuration:

   ```bash
   cp .env.template .env
   # Edit .env with your preferred settings
   ```

2. **Start the Agents**

   You can start each agent type separately or all at once:

   ```bash
   # Start all agents (in separate terminals)
   ./start-agents.sh all

   # Or start individual agents
   ./start-agents.sh issuer    # Government agent
   ./start-agents.sh doctor    # Doctor agent
   ./start-agents.sh pharmacist # Pharmacist agent
   ```

3. **Workflow**

   The typical workflow is:

   - Government (Issuer) creates a connection with the Patient and issues identity credentials
   - Patient connects with the Doctor and presents identity proof
   - Doctor issues medical document credentials (e.g., prescriptions) to the Patient
   - Patient connects with the Pharmacist and presents the prescription credential
   - Pharmacist verifies the prescription and provides the medication

4. **API Endpoints**

   **Common Endpoints (All Agents)**
   - `POST /create-invitation` - Create a connection invitation
   - `GET /connections` - Get all connections
   - `POST /send-message` - Send a message to a connection

   **Government (Issuer) Endpoints**
   - `POST /issue-credential` - Issue identity credentials to a patient

   **Doctor Endpoints**
   - `POST /send-proof-request` - Request identity proof from a patient
   - `POST /medical-document/upload` - Upload and issue a medical document credential

   **Pharmacist Endpoints**
   - `POST /send-proof-request` - Request document proof from a patient
   - `POST /medical-document/verify` - Verify a medical document
   - `GET /medical-document/:id` - Retrieve a medical document by ID
Now start the ngrok:
```ngrok start --all```

Then:

```bash
# Clone the ssi-tutorial repository 
git clone -b credo-acapy https://github.com/CrypticConsultancyLimited/ssi-tutorial.git

# Navigate to credo directory
cd ssi-tutorial/demo/credo

# Install dependencies
yarn install

# Environment Setup
cp .env.example .env

# Configure .env file
ISSUER_DID=your_issuer_did
ISSUER_SEED=your_issuer_seed
VERIFIER_DID=your_verifier_did
VERIFIER_SEED=your_verifier_seed
# You can use ISSUER_DID, ISSUER_SEED, VERIFIER_DID, VERIFIER_SEED as same as in .env.sample file

ISSUER_API_PORT=4000
VERIFIER_API_PORT=4002
ISSUER_AGENT_PUBLIC_ENDPOINT={ngrok url of port 4001 without brackets}
VERIFIER_AGENT_PUBLIC_ENDPOINT={ngrok url of port 4002 without brackets}
```

### 💻 Interface Setup

```bash
# Navigate to interface directory
cd interface

# Install dependencies
yarn install

# Environment Setup
cp .env.example .env

# Configure .env file
NEXT_PUBLIC_API_URL=http://localhost:4000

# Start the development server
yarn dev
```

### 📱Mobile Wallet Setup

Download Bifold app from the following link: <a href="https://drive.google.com/uc?export=download&id=10Qv5FNXOsp6-kyafJefXYYSe_v5bpfuq">Click here</a>

Install the app on your phone and login to the app creating a 6 digit pin. You can use this wallet for:

- Beign connected with other entities (Issuer / Verifier).
- Sending message to other parties.
- Storing credentials.
- Presenting proof.
- Making your own invitation qr to share with other parties.
- And many more (Explore yourself ... 😉)

<br>

## 🎮 Running the Demo

#### 1️⃣ Start Credo Agents

```bash
# In demo/credo directory
# Start issuer agent
yarn issuer

# In a new terminal
# Start verifier agent
yarn verifier
```

#### 2️⃣ Launch Interface

```bash
# In interface directory
yarn dev
```

- **[Testing Guide](../../README.md#-testing-the-setup)**

</div>
