# Client Connections

[English](../en/CLIENTS.md) | [简体中文](../zh-CN/CLIENTS.md) | [日本語](../ja/CLIENTS.md)

Request path: client → Secure MCP Tunnel → ChatToHarness MCP gateway → built-in tool proxy or authorized third-party MCP services. Open ChatToHarness, save the tunnel configuration and confirm **Tunnel ready** first. Select work directories when using built-in file tools. Keep only one active local stdio runtime for a Tunnel; do not start another runtime from a different tool.

## Shared application tools

Add downstream services in ChatToHarness's **MCP Servers** page, then trust the command/URL and authorize individual tools there. Alternatively, turn on **Allow all tools** at the top of that page to allow every tool from enabled, trusted services, including future additions and changes. The switch is off by default, persists across restarts, and restores individual policies when turned off. It does not change trust, authorized folders or client-side confirmations, and is excluded from imports and exports. Do not configure Unity, browsers or other downstream services separately on a particular Agent. The app maintains the connections; all callers of this Tunnel see the same authorized catalog. Third-party tools use `serverId__toolName`; built-in names are unchanged. See the [MCP Servers guide](GUIDE.md#mcp-servers) for transports, credentials and import/export.

A new connection or a list-changed notification refreshes the gateway registry, but does not guarantee that an existing conversation immediately rediscovers tools. Refresh the client's tool catalog when needed. With **Allow all tools** off, new and changed tools remain disabled until authorized locally. Per-call local approval is separate from the client's own confirmation rules and must complete within the gateway deadline (60 seconds by default, at most 90 seconds). Calls are not replayed on reconnect; after a forwarded call loses its reply, verify the target state before retrying. Messages are limited to 8 MiB.

## ChatGPT

In a supported custom MCP settings screen, add an application, choose Tunnel as the connection type, and associate the same Tunnel ID. The target workspace must be associated with the tunnel, and the operator needs permission to use it. After tool discovery, provide the project path in a new task, start with read-only checks, then test writing and reading in a dedicated temporary directory.

[Official tunnel setup guide](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)

If ChatGPT shows **Allow ChatGPT to use LocalHarness?** for **Start Terminal Process**, this is ChatGPT's own tool confirmation. Choose **Always allow** at the lower left of the prompt to remember approval for that tool in the current conversation. Approval is per tool and per conversation; another tool, a new conversation or a refreshed conversation may prompt again. ChatGPT requests confirmation for write actions by default; a server's read-only hint helps it distinguish read-only tools. ChatToHarness's **Allow all tools** only controls local permissions and cannot dismiss this prompt. [Tool management and confirmations](https://developers.openai.com/api/docs/guides/custom-mcp-server)

Tool enablement, call confirmation and checks for suspicious descriptions are separate concerns. For a suspicious-instructions warning, inspect the cited metadata and actual arguments. Older Harness metadata repeatedly required guidance loading and token passing; this change replaces it with factual interface descriptions while retaining server validation. Arbitrary terminal tools remain write-capable and network-capable even when a particular command is read-only. The server cannot disable ChatGPT safety checks or guarantee that all confirmations disappear.

After updating the running Harness, refresh tools in the plugin details to fetch new descriptions, schemas and server instructions. Editing source alone does not update a running process or the client's tool catalog. Verify a read-only task after refreshing; refreshing the conversation may require tool confirmation again.

## Codex

Official documentation lists Codex as a supported tunnel caller. Use the tunnel connection or plugin flow offered by the current product version, and check the Platform organization association and permissions. Reuse the Tunnel managed by ChatToHarness: no new Tunnel or second runtime is needed.

Configuration can differ between Codex surfaces, accounts, and versions. This guide does not generate unverified local MCP configuration or treat the hosted tunnel address as an ordinary public server URL. Until discovery and actual calls succeed, record **officially supported**, not **verified on this device**.

[Official tunnel guide](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) · [Codex documentation](https://developers.openai.com/codex/)

## Responses API

Use `tunnel_id` in the MCP tool definition. Do not put the hosted tunnel address in `server_url`:

```json
{
  "type": "mcp",
  "server_label": "chat_to_harness",
  "tunnel_id": "Replace with the Tunnel ID saved in the application"
}
```

Place this definition in the Responses request's `tools` array. The caller configures the model, input, and approval handling. The caller must manage its own API credentials; the local Runtime API Key is not a substitute. The application help page displays a definition containing the saved Tunnel ID, with no key.

[Responses API connection example](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels#connect-from-the-responses-api)

## AgentKit

The official release notes list AgentKit as supporting Secure MCP Tunnel. Configure it through the tunnel-selection surface actually available for the account and product, and keep the same Tunnel runtime running. This version provides official references rather than inventing product-specific configuration.

[Official release notes](https://developers.openai.com/api/docs/changelog) · [Tunnel guide](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)

Other vendors' clients are not currently included in this product's compatibility list. Official support, account availability, successful tool discovery, and successful tool calls are separate states. See [verification](VERIFICATION.md) for recorded results.
