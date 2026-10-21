#!/usr/bin/env node
'use strict';
const {Server} = require('@modelcontextprotocol/sdk/server/index.js');
const {StdioServerTransport} = require('@modelcontextprotocol/sdk/server/stdio.js');
const {ListToolsRequestSchema, CallToolRequestSchema} = require('@modelcontextprotocol/sdk/types.js');
const {WindowsComputerUse, definition:baseDefinition} = require('./windows-computer-use.cjs');
const {computerUseHome,localComputerIdentity,registeredComputerUse,deviceBoundArgs}=require('./computer-use-devices.cjs');
const device=localComputerIdentity(computerUseHome());
const definition=registeredComputerUse(baseDefinition,device);
const service = new WindowsComputerUse();
const server = new Server({name: 'ChatToHarness Windows Computer Use', version: require('../package.json').version}, {capabilities: {tools: {}}});
server.setRequestHandler(ListToolsRequestSchema, () => ({tools: [definition]}));
server.setRequestHandler(CallToolRequestSchema, (request, {signal}) => {
  if(request.params.name!==definition.name)return {isError:true,content:[{type:'text',text:'Unknown tool'}]};
  const {error,nativeArgs}=deviceBoundArgs(device,request.params.arguments);
  return error||service.call(nativeArgs,{signal});
});
server.onclose = () => service.stop();
for (const event of ['SIGINT', 'SIGTERM']) process.on(event, () => { service.stop(); process.exit(0); });
process.stdin.on('end', () => { service.stop(); void server.close(); });
server.connect(new StdioServerTransport()).catch(() => { service.stop(); process.exitCode = 1; });
