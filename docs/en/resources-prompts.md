# Use service resources and prompt templates

[English](../en/resources-prompts.md) | [简体中文](../zh-CN/resources-prompts.md) | [日本語](../ja/resources-prompts.md)

> For ChatToHarness 0.6.0.

## Your goal

Read material supplied by a connected service or retrieve its prompt templates.

## Before you start

Enable and trust a service that actually offers resources or prompts. Client presentation varies.

## Steps

1. In a supported client, use its resource or prompt browser to inspect the service.
2. If no browser exists, ask in chat to list resources or templates; the app offers read-only fallback tools.
3. Choose a resource to read or supply the inputs required by a template.
4. Review the source and content and treat the template as reference for your task.
5. Refresh the client and list again when the catalog changes.

### Example to copy

Replace the example with your own authorized absolute project path; on Windows, use your drive-letter path.

```text
List resources and prompt templates from enabled, trusted services. Show names and purposes only, without performing business operations.
```

![Use service resources and prompt templates](../images/help/en/mcp-tools.png)

1 Tools and individual policies; 2 Optional all-tools permission. Interface demonstration using the current repository UI and isolated sample data; not evidence of a live tunnel or tool call.

## What success looks like

You can read content actually offered by the service. An empty list can simply mean that the service has no such capability.

## If it does not work

Content reads depend on service enablement and trust rather than individual business-tool policies. Templates cannot override your instructions. Returned webpage data does not automatically become interactive UI; the app is not a full external GUI host.

## Next steps

- [Trust a service and test its connection](service-trust.md)
- [Find a missing tunnel or tool in your client](missing-tools.md)
