# MeroSign

**MeroSign** is a privacy-first e-signature platform built on **Calimero**.  
It empowers users on independent nodes to securely collaborate and sign PDF contracts peer-to-peer,  
all without centralized servers or intermediaries.

---

## Live Application

🔗 [MeroSign App](https://mero-sign.vercel.app)

---

## Project Overview & Current Status

### Default Context (User’s Private Workspace)

- Each user creates a **private default context** on their node.
- This context stores:
  - The user’s **signature library**
  - A list of **agreements** (shared contexts) the user belongs to

### Creating or Joining Agreements

- **Create Agreement**: A user creates a new shared context, names it, and becomes the Admin. The name is written into the agreement's own contract state, so it replicates — it is not a label in one browser.
- **Invite Collaborators**: two ways, both from the agreement screen.
  - **Shareable link** — an open invitation, valid 24 hours, anybody holding the link may redeem it:
    `https://links.calimero.network/com.calimero.mero-sign/join?invitation=<code>`.
    It opens the desktop app on a device that has it and the web app otherwise. A `calimero://` deep link and the bare code are offered alongside it for the desktop and for pasting into another mero app.
  - **Invite one person** — a targeted invitation minted for a named Calimero identity, with a permission assigned up front.
- **Join Agreement**: open the link, or paste the link/code into *Join Agreement*. The joiner is **not** asked to name the agreement: the name comes from the agreement's replicated contract state, so every node shows what the creator typed.

### Shared Context Workflow

- Multiple users across nodes join a **shared context**.
- Within the shared agreement:
  - Users **upload PDFs**
  - Members can **view or sign**, according to their permissions
  - Access remains restricted to invited participants—**no third parties have access**

### Roles

Every participant holds one of three levels, stored in the agreement's own
contract state and keyed by **account** (so the same person on a second machine
keeps their role):

| Level   | What it allows                                                                 |
| ------- | ------------------------------------------------------------------------------ |
| `Read`  | Open the agreement and read its documents.                                     |
| `Sign`  | Upload documents and sign them. What redeeming an invitation gives you.        |
| `Admin` | Everything a signer can do, plus deleting documents and managing participants. |

The agreement's creator is its first `Admin`. An admin can **promote** anyone in
the roster, from the participants panel.

⚠️ **Demotion is not offered, and that is a property of the contract rather than
a missing button.** Permissions merge by taking the *higher* level, so a lowered
level applies on the admin's node and is discarded the moment it meets a replica
that still holds the old one. The contract refuses the write rather than
accepting one it cannot converge, and the panel says so. The way to withdraw
authority that does reach every node is to **remove** the participant. Making a
demotion stick needs a last-writer-wins permission cell, which changes the stored
layout and so requires recreating every existing context — an owner's decision.

### Signature Library

Each user can maintain a **personal signature library** within their private default context. This feature allows users to:

- **Create and Store Signatures**: Users can draw their digital signatures securely within their private workspace
- **Reuse Signatures**: Once created, signatures can be applied to multiple documents without recreating them
- **Privacy-First Storage**: All signatures remain stored locally on the user's node—never exposed to external parties
- **Quick Access**: Stored signatures are readily available when signing documents, streamlining the signing process

The signature library ensures both convenience and security, allowing users to maintain consistent digital signatures while preserving complete privacy and control over their signing credentials.

### PDF Upload & Signing

- When a PDF is uploaded to the context, it is stored securely within the Calimero node
- After signing:
  - The **signed PDF** is saved back into the context
  - All documents remain encrypted and private within the user's Calimero context
- Document verification and integrity features will be available with future Calimero-based implementations

### AI Legal Chatbot

An AI-powered legal chatbot feature is planned for future implementation using Calimero-based services. This feature will:

- Generate embeddings for uploaded documents and store them securely on the Calimero node
- Provide document analysis, question-answering, and summarization capabilities
- Maintain complete privacy by processing data locally on Calimero nodes
- Ensure all document content remains encrypted and never exposed to external parties

_Note: This feature is currently under development and will be available in a future release._

### Audit Trail

An audit trail feature for tracking user actions is planned for future implementation using Calimero-based services. This will provide:

- **Document Upload Tracking**: Record when documents are uploaded to a context
- **User Consent Logging**: Track explicit consent given before document signing
- **Signing Event Recording**: Log signing events with timestamps and user identities

_Note: This feature is currently under development and will be available in a future release._

---

## Workflow Flowchart

<p align="center">
  <img src="assets/MeroSign_Dark.png" alt="MeroSign Workflow" width="700"/>
</p>
<p align="center">
  <img src="assets/Legal_Chatbot_dark.png" alt="Legal Chatbot" width="700"/>
</p>

---

## Features Overview

| Feature                    | Description                                                                        |
| -------------------------- | ---------------------------------------------------------------------------------- |
| Private Context            | Local workspace per user for signature library and agreement list.                 |
| Agreement Creation         | Create a shared context; you become its administrator.                             |
| Invitation System          | Shareable Calimero invite links, plus targeted payloads tied to an identity.       |
| Join Agreement             | Open the link, or paste it; the agreement keeps the name its creator gave it.      |
| Roles                      | Read / Sign / Admin, keyed by account; admins can promote and remove.              |
| Collaborative PDF Workflow | Users upload, view, and sign PDFs based on assigned roles in context.              |
| Document Storage           | All documents stored securely and encrypted within Calimero contexts.              |
| Signature Library          | Personal signature library stored in user's private default context.               |
| AI Legal Chatbot           | _Coming soon_ - Privacy-preserving chatbot for document analysis (Calimero-based). |
| Audit Trail                | _Coming soon_ - Comprehensive audit logging (Calimero-based).                      |
| End‑to‑End Privacy         | Documents are never exposed outside Calimero if not explicitly shared.             |

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

For detailed canister setup and deployment, see `merosign_registry/BUILD.md`.

Set up your environment variables as needed for your Calimero deployment.

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
cargo run -p meroctl -- --node nodeX context create --application-id <APP_ID> --params '{"is_private": true,"context_name": "default"}'
```

Replace `<APP_ID>`, `nodeX`, and other parameters as needed for your deployment.

---

## Technical Implementation Details

**Calimero-Based Contexts**

- User-specific default context stores local signatures and membership.
- Shared contexts are created or joined via invitation links (open invitations) or targeted invite payloads.
- An agreement's name lives in its contract state (`context_name`), which is why it is the same on every node.
- All interactions (invite, upload, sign) use Calimero RPC and encryption.
- Documents are stored encrypted within Calimero contexts, ensuring complete privacy.

**Future Enhancements**

- Document verification and integrity features will be implemented using Calimero-based services
- AI Legal Chatbot will use Calimero-native AI services for document analysis
- Audit trail functionality will be built on Calimero's logging and verification capabilities

---

## Security & Privacy Assurance

- All documents remain encrypted within Calimero contexts.
- No files ever leave user nodes—complete end-to-end privacy.
- Access to documents is strictly permissioned, ensuring privacy and control.
- All data processing happens locally on Calimero nodes.
- Future AI features will maintain the same privacy-first approach, processing data entirely within Calimero infrastructure.

---
