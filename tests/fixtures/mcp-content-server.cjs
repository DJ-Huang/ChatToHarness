'use strict';
const {Server} = require('@modelcontextprotocol/sdk/server/index.js');
const {StdioServerTransport} = require('@modelcontextprotocol/sdk/server/stdio.js');
const types = require('@modelcontextprotocol/sdk/types.js');
const server = new Server({name: 'content-fixture', version: '1.0.0'}, {capabilities: {resources: {listChanged: true}, prompts: {listChanged: true}, tools: {listChanged: true}}});
server.setRequestHandler(types.ListToolsRequestSchema, () => ({tools: [{name:'link',inputSchema:{type:'object',properties:{}}}]}));
server.setRequestHandler(types.CallToolRequestSchema, () => ({content:[{type:'resource_link',uri:'fixture://note',name:'Synthetic link'}]}));
server.setRequestHandler(types.ListResourcesRequestSchema, () => ({resources: [{uri: 'fixture://note', name: 'Note', mimeType: 'text/plain'}, {uri: 'ui://preview', name: 'Preview', mimeType: 'text/html;profile=mcp-app'}]}));
server.setRequestHandler(types.ListResourceTemplatesRequestSchema, () => ({resourceTemplates: [{uriTemplate: 'fixture://notes/{id}', name: 'Note by ID'}]}));
server.setRequestHandler(types.ReadResourceRequestSchema, request => {
  const uri = request.params.uri;
  if (uri === 'ui://preview') return {contents: [{uri, mimeType: 'text/html;profile=mcp-app', text: '<h1>Synthetic resource preview</h1>'}]};
  if (uri === 'fixture://note' || uri.startsWith('fixture://notes/')) return {contents: [{uri, mimeType: 'text/plain', text: `SYNTHETIC_RESOURCE ${uri}`} ]};
  throw new types.McpError(types.ErrorCode.InvalidParams, 'Unknown synthetic resource');
});
server.setRequestHandler(types.ListPromptsRequestSchema, () => ({prompts: [{name: 'inspect', description: 'Inspect a synthetic subject', arguments: [{name: 'subject', required: true}]}]}));
server.setRequestHandler(types.GetPromptRequestSchema, request => {
  if (request.params.name !== 'inspect') throw new types.McpError(types.ErrorCode.InvalidParams, 'Unknown prompt');
  return {description: 'Synthetic prompt', messages: [{role: 'user', content: {type: 'text', text: `Inspect ${request.params.arguments?.subject || ''}`}}, {role: 'assistant', content: {type: 'resource', resource: {uri: 'fixture://note', mimeType: 'text/plain', text: 'SOURCE_DATA_ONLY'}}}]};
});
server.connect(new StdioServerTransport()).catch(() => process.exit(1));
