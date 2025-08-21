# Calimero Curb Chat

## Logic

```bash title="Terminal"
cd logic
```

```bash title="Terminal"
chmod +x ./build.sh
```

```bash title="Terminal"
./build.sh
```

## App

```bash title="Terminal"
cd app
```

```bash title="Terminal"
pnpm install
```

```bash title="Terminal"
pnpm run build
```

```bash title="Terminal"
pnpm run dev
```

Open app in browser and connect to running node.

For more information how to build app check our docs:
https://calimero-network.github.io/build/quickstart


## Workflows

The `workflows/` folder contains an example bootstrap workflow that demonstrates the complete setup process with the following steps:

1. Initialize Node 1 and Node 2
2. Install Curb Chat application and create context from Node 1
3. Invite Node 2 to join the context from Node 1
4. Join the context from Node 2
5. Join the chat from Node 2
6. Send a message from Node 1
7. Send a message from Node 2
8. Fetch messages from Node 1

To run this workflow, you need to install [merobox](https://www.piwheels.org/project/merobox/) on your machine and execute:

```bash title="Terminal"
merobox --version
> merobox, version 0.1.13
merobox bootstrap workflows/bootstrap.yml
> ...
> 🎉 Workflow completed successfully!
```
