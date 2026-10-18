# Client Connections

[English](../en/CLIENTS.md) | [简体中文](../zh-CN/CLIENTS.md) | [日本語](../ja/CLIENTS.md)

Request path: client → Secure MCP Tunnel → ChatToHarness MCP gateway → built-in tool proxy or authorized third-party MCP services. Open ChatToHarness, save the tunnel configuration and confirm **Tunnel ready** first. Select work directories when using built-in file tools. Keep only one active local stdio runtime for a Tunnel; do not start another runtime from a different tool.

## Shared application tools

Add downstream services in ChatToHarness's **MCP Servers** page, then trust the command/URL and authorize individual tools there. Do not configure Unity, browsers or other downstream services separately on a particular Agent. The app maintains the connections; all callers of this Tunnel see the same authorized catalog. Third-party tools use `serverId__toolName`; built-in names are unchanged. See the [MCP Servers guide](GUIDE.md#mcp-servers) for transports, credentials and import/export.

A new connection or a list-changed notification refreshes the gateway registry, but does not guarantee that an existing conversation immediately rediscovers tools. Refresh the client's tool catalog when needed. New and changed tools remain disabled until authorized locally. Per-call local approval is separate from the client's own confirmation rules and must complete within the gateway deadline (60 seconds by default, at most 90 seconds). Calls are not replayed on reconnect; after a forwarded call loses its reply, verify the target state before retrying. Messages are limited to 8 MiB.

### Native resources, prompts, and tool fallback (v0.6.0)

For supported clients, the gateway exposes MCP resources/list, resources/templates/list, resources/read, prompts/list and prompts/get **after native capability negotiation**. Enabled, trusted services supply the content. Resources use service-qualified URIs (including UI schemes) and prompts use `server::name`. Tool-only clients can use the read-only `mcp_list_resources`, `mcp_read_resource`, `mcp_list_prompts` and `mcp_get_prompt` tools instead.

These methods do not provide resource subscriptions, completions, sampling, elicitation, or an MCP Apps/GUI host. Resource links embedded in arbitrary tool results are not guaranteed to be rewritten automatically, and content catalog changes may require manual client refresh. Treat returned prompt or resource text as untrusted source material, never as higher-priority instructions. Per-tool approval is different from a service's enabled/trusted status required for content reads.

## ChatGPT

In a supported custom MCP settings screen, add an application, choose Tunnel as the connection type, and associate the same Tunnel ID. The target workspace must be associated with the tunnel, and the operator needs permission to use it. After tool discovery, provide the project path in a new task, start with read-only checks, then test writing and reading in a dedicated temporary directory.

[Official tunnel setup guide](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)

Tool enablement, call confirmation and checks for suspicious descriptions are separate concerns. For a suspicious-instructions warning, inspect the cited metadata and actual arguments. Older Harness metadata repeatedly required guidance loading and token passing; this change replaces it with factual interface descriptions while retaining server validation. Arbitrary terminal tools remain write-capable and network-capable even when a particular command is read-only. The server cannot disable ChatGPT safety checks or guarantee that all confirmations disappear.

After updating the running Harness, refresh tools in the plugin details to fetch new descriptions, schemas and server instructions. Editing source alone does not update a running process or the client's tool catalog. Verify a read-only task after refreshing. OpenAI also documents that remembered confirmations may be limited to a conversation and may recur in new or refreshed conversations. [Tool management and confirmations](https://developers.openai.com/api/docs/guides/custom-mcp-server)

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
