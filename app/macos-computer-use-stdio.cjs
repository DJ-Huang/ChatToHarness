#!/usr/bin/env node
'use strict';
const {Server} = require('@modelcontextprotocol/sdk/server/index.js');
const {StdioServerTransport} = require('@modelcontextprotocol/sdk/server/stdio.js');
const {ListToolsRequestSchema, CallToolRequestSchema} = require('@modelcontextprotocol/sdk/types.js');
const {MacComputerUse, definition} = require('./macos-computer-use.cjs');
const service = new MacComputerUse();
const server = new Server({name: 'ChatToHarness macOS Computer Use', version: require('../package.json').version}, {capabilities: {tools: {}}});
server.setRequestHandler(ListToolsRequestSchema, () => ({tools: [definition]}));
server.setRequestHandler(CallToolRequestSchema, (request, {signal}) =>
  request.params.name === definition.name ? service.call(request.params.arguments, {signal}) :
    {isError: true, content: [{type: 'text', text: 'Unknown tool'}]});
server.onclose = () => service.stop();
for (const event of ['SIGINT', 'SIGTERM']) process.on(event, () => { service.stop(); process.exit(0); });
process.stdin.on('end', () => { service.stop(); void server.close(); });
server.connect(new StdioServerTransport()).catch(() => { service.stop(); process.exitCode = 1; });
