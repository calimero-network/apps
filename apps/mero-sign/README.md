# MeroDocs

**MeroDocs** is a privacy-first e-signature platform built on **Calimero**.  
It empowers users on independent nodes to securely collaborate, sign PDF contracts peer-to-peer,  
and publicly attest document integrity via the **Internet Computer (ICP)** — all without centralized servers or intermediaries.

---

## Live Application  
🔗 [MeroDocs App](https://mero-docs.vercel.app)

---

## ICP Mainnet Deployment  

**Canister Backend**  
- **Canister ID:** `na3u2-6iaaa-aaaac-qbtcq-cai`  
- **Candid Interface:** [Backend Canister](https://a4gq6-oaaaa-aaaab-qaa4q-cai.raw.icp0.io/?id=na3u2-6iaaa-aaaac-qbtcq-cai)

---

## Project Overview & Current Status

### Default Context (User’s Private Workspace)

- Each user creates a **private default context** on their node.
- This context stores:
  - The user’s **signature library**
  - A list of **agreements** (shared contexts) the user belongs to

### Creating or Joining Agreements

- **Create Agreement**: A user creates a new shared context and becomes the Admin.
- **Invite Collaborators**: The Admin generates an **invite payload** using other participants’ Calimero identity and assigns permissions (view/sign).
- **Join Agreement**: A user on a different node enters the invite payload and names the agreement on their node.

### Shared Context Workflow

- Multiple users across nodes join a **shared context**.
- Within the shared agreement:
  - Users **upload PDFs**
  - Members can **view or sign**, according to their permissions
  - Access remains restricted to invited participants—**no third parties have access**

### Signature Library

Each user can maintain a **personal signature library** within their private default context. This feature allows users to:

- **Create and Store Signatures**: Users can draw their digital signatures securely within their private workspace
- **Reuse Signatures**: Once created, signatures can be applied to multiple documents without recreating them
- **Privacy-First Storage**: All signatures remain stored locally on the user's node—never exposed to external parties
- **Quick Access**: Stored signatures are readily available when signing documents, streamlining the signing process

The signature library ensures both convenience and security, allowing users to maintain consistent digital signatures while preserving complete privacy and control over their signing credentials.

### PDF Upload & Signing with ICP Integration

- When a PDF is uploaded to the context:
  - Its **original SHA‑256 hash** is recorded on the **ICP canister**
- After signing:
  - The **signed PDF** is saved back into the context
  - The **final document hash** is recorded on ICP
- A **“Verify on ICP”** button enables:
  - Recomputing the local PDF hash
  - Comparing it with the on-chain value
  - Confirms whether the document matches the recorded state or has been tampered with

### Audit Trail

Three user actions are now audited on ICP, ensuring complete transparency and public accountability:

- **Document Upload**  
  When a user uploads a PDF, an upload event is recorded on the ICP canister.

- **User Consent**  
  Before signing, the user must provide explicit consent. This action is logged on ICP to form a tamper-proof record of intent.

- **Signing Event**  
  Once a user signs the document, that signing event (with timestamp and identity) is also logged on ICP.

Together, these logs create a reliable audit trail spanning from upload to signature—empowering both users and auditors with verifiable, immutable proof of every step in the process.



---

## Workflow Flowchart

<p align="center">
  <img src="assets/MeroDocs_Dark.png" alt="MeroDocs Workflow" width="700"/>
</p>

---

## Features Overview

| Feature                       | Description                                                                   |
| ----------------------------- | ----------------------------------------------------------------------------- |
| Private Context               | Local workspace per user for signature library and agreement list.            |
| Agreement Creation            | Create a shared context; you become its administrator.                        |
| Invitation System             | Generate secure invite payloads tied to Calimero identities with permissions. |
| Join Agreement                | Input invite payload to create shared context on your node.                   |
| Collaborative PDF Workflow    | Users upload, view, and sign PDFs based on assigned roles in context.         |
| ICP Integration for Integrity | Record original and final document hashes on the Internet Computer.           |
| Verify Document Status        | Button to compare current PDF hash with ICP-stored hashes.                    |
| Audit Trail                   | Logging the user action on ICP related to Document Signing.                   |
| End‑to‑End Privacy            | Documents are never exposed outside Calimero if not explicitly shared.        |

---

## Tutorial: App Setup

### Logic

```bash title="Terminal"
cd logic
```

```bash title="Terminal"
chmod +x ./build.sh
```

```bash title="Terminal"
./build.sh
```

### Canister

For detailed canister setup and deployment, see [`merodocs_registry/BUILD.md`](merodocs_registry/BUILD.md).

Once your canister is deployed, set the following environment variables in your `app/.env` file:

```
VITE_DFX_NETWORK=local
VITE_LOCAL_PRINCIPAL_ID=<your_local_principal_id>
VITE_BACKEND_CANISTER_ID=<your_backend_canister_id>
VITE_INTERNET_IDENTITY_CANISTER_ID=<your_internet_idenetity_canister_id>
```

Replace the placeholder values with your actual deployed canister and principal IDs.

---

### App

```bash title="Terminal"
cd app
```

```bash title="Terminal"
pnpm install
```

```bash title="Terminal"
pnpm build
```

```bash title="Terminal"
pnpm dev
```

Open the app in your browser and connect to your running node.

The app will be deployed and accessible at: [http://localhost:5173/](http://localhost:5173/)

---

### Initial Application Context Initialization

To initialize your application context, run:

```bash
cargo run -p meroctl -- --node nodeX context create --application-id <APP_ID> --protocol icp --params '{"is_private": true,"context_name": "default"}'
```

Replace `<APP_ID>`, `nodeX`, and other parameters as needed for your deployment.

---

## Technical Implementation Details

**Calimero-Based Contexts**

- User-specific default context stores local signatures and membership.
- Shared contexts are created or joined via invite payloads.
- All interactions (invite, upload, sign) use Calimero RPC and encryption.

**ICP Integration**

- SHA‑256 hashes recorded for both original and signed PDFs.
- Public verification without exposing sensitive content.

---

## Security & Privacy Assurance

- All documents remain encrypted within Calimero contexts.
- Only hashes are stored on-chain—no files ever leave user nodes.
- Access to documents is strictly permissioned, ensuring privacy and control.

---
