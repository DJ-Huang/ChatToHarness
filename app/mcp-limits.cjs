'use strict';
// Wire budgets count the serialized JSON message, including Base64 and metadata.
module.exports = {
  MAX_MESSAGE_BYTES: 8 * 1024 * 1024,
  INLINE_IMAGE_BYTES: 1024 * 1024,
  IMAGE_PREVIEW_BYTES: 512 * 1024,
  MAX_ARTIFACT_BYTES: 64 * 1024 * 1024,
  // 5 MiB becomes about 6.67 MiB in Base64. A <=512 KiB native preview
  // and bounded metadata still fit the unchanged 8 MiB wire budget.
  FILE_CHUNK_BYTES: 5 * 1024 * 1024,
  MAX_FILE_CHUNK_BYTES: 5 * 1024 * 1024,
  PREVIEW_CHUNK_BYTES: 32 * 1024,
  MAX_TEXT_CHUNK_BYTES: 512 * 1024
};
