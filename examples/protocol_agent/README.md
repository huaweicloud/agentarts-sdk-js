# Authenticated local A2A / AG-UI example

From the repository root:

```sh
pnpm install
pnpm build
export AGENTARTS_PROTOCOL_TOKEN="$(openssl rand -hex 32)"
pnpm --filter agentarts-protocol-example start
```

The example binds to `127.0.0.1:8000`, supports text echo, and requires the configured Bearer token for both protocols and Agent Card discovery. It does not print the token. The static token maps to one demo identity; production applications should use a real credential verifier and server-resolved tenant/user identities.

```sh
curl -N http://127.0.0.1:8000/ag-ui \
  -H "Authorization: Bearer $AGENTARTS_PROTOCOL_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"threadId":"demo","runId":"run-1","messages":[{"id":"m1","role":"user","content":"hello"}],"tools":[],"context":[]}'

curl http://127.0.0.1:8000/a2a \
  -H "Authorization: Bearer $AGENTARTS_PROTOCOL_TOKEN" \
  -H 'A2A-Version: 1.0' -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":"rpc-1","method":"SendMessage","params":{"message":{"messageId":"m1","role":"ROLE_USER","parts":[{"text":"hello","mediaType":"text/plain"}]}}}'
```

For browser use set `AGENTARTS_PROTOCOL_ORIGINS=https://your-ui.example` before starting. For reverse-proxy deployment set `AGENTARTS_PROTOCOL_PUBLIC_URL` to the externally reachable HTTPS `/a2a` URL; route discovery and protocol paths through the proxy without buffering SSE. Cloud gateway support has not been verified.

No `/invocations` entrypoint or `/ws` handler is enabled in this example. Protocol authentication does not retroactively authenticate legacy SDK routes in other applications; protect those separately if you enable them.

The default `start` example deliberately uses the text convenience adapters. For complete protocol features use the persistent example below.

## Persistent approval workflow

```sh
export AGENTARTS_PROTOCOL_TOKEN="$(openssl rand -hex 32)"
# Optional: preserve this key between restarts if encryption is enabled.
export AGENTARTS_PROTOCOL_STORAGE_KEY="$(openssl rand -hex 32)"
pnpm --filter agentarts-protocol-example start:full
```

On Windows PowerShell, generate the same values using Node:

```powershell
$env:AGENTARTS_PROTOCOL_TOKEN = node -p "require('node:crypto').randomBytes(32).toString('hex')"
$env:AGENTARTS_PROTOCOL_STORAGE_KEY = node -p "require('node:crypto').randomBytes(32).toString('hex')"
pnpm --filter agentarts-protocol-example start:full
```

Use Ctrl+C to stop the example and keep the same environment variables when restarting.
In another PowerShell window, set the same token and use `Invoke-RestMethod` with a JSON body from `ConvertTo-Json` for A2A requests. Use `curl.exe -N` with a JSON file and `--data-binary '@request.json'` for AG-UI SSE.

AG-UI listens on 8000; A2A JSON-RPC and REST on 8001. State is saved in `.agentarts-protocol` relative to the example working directory. Keep one process per storage directory. `PORT`, `A2A_PORT`, `AGENTARTS_PROTOCOL_STORAGE_DIR` and `AGENTARTS_PROTOCOL_PUBLIC_ORIGIN` override defaults. The static token maps to one local identity.

First request pauses for approval:

```sh
curl -N http://127.0.0.1:8000/ag-ui \
  -H "Authorization: Bearer $AGENTARTS_PROTOCOL_TOKEN" -H 'Content-Type: application/json' \
  --data '{"threadId":"approval-demo","runId":"pause","messages":[{"id":"u","role":"user","content":"start"}]}'
```

Stop and restart with the same directory, encryption key and token, then resume:

```sh
curl -N http://127.0.0.1:8000/ag-ui \
  -H "Authorization: Bearer $AGENTARTS_PROTOCOL_TOKEN" -H 'Content-Type: application/json' \
  --data '{"threadId":"approval-demo","runId":"resume","messages":[],"resume":[{"interruptId":"approval","status":"resolved","payload":true}]}'

curl http://127.0.0.1:8001/a2a \
  -H "Authorization: Bearer $AGENTARTS_PROTOCOL_TOKEN" -H 'A2A-Version: 1.0' -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":"first","method":"SendMessage","params":{"message":{"messageId":"first","role":"ROLE_USER","parts":[{"text":"start"}]}}}'
```

The A2A response is INPUT_REQUIRED. Send another SendMessage with a fresh messageId, the returned taskId, and `parts: [{"text":"approve"}]`; the same task completes using its saved checkpoint. REST can perform the initial send at `POST http://127.0.0.1:8001/a2a/rest/message:send` with `{"message": ...}`. The full service also exports gRPC service definitions, signing hooks and opt-in push; see the SDK protocol guide for host/TLS and allowlist configuration.

These examples do not execute arbitrary client tools or download attachments. Full capability contracts, resource limits and remaining deployment acceptance are documented in `docs/cn/sdk_user_guide/runtime_protocols.md`.
