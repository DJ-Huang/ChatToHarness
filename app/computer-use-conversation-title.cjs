'use strict';
// A custom, host-origin MCP extension. Standard ChatGPT MCP metadata exposes
// an anonymized session ID, NOT a visible conversation title.
const META_KEY='com.chattoharness/conversationTitle';
function fromHostMetadata(metadata) {
  if(!metadata||typeof metadata!=='object'||Array.isArray(metadata))return undefined;
  const value=metadata[META_KEY];
  if(typeof value!=='string'||!value.trim()||value.length>80||/[\x00-\x1f\x7f]/.test(value))
    return undefined;
  return value.trim();
}
module.exports={META_KEY,fromHostMetadata};
