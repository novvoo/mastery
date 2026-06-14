// Re-export from src/core/ — runtime-details logic has been moved to runtime layer
export {
  isRuntimeDetailMessage,
  isThinkingMessage,
  isStatusUpdateMessage,
  isPrimaryMessage,
  formatRuntimeDetailValue,
  compactToolResult,
  getRuntimeDetailContent,
  buildThinkingSummary,
  getRuntimeDetailPreviewText,
  getStatusUpdateText,
  createConversationGroups,
  createRuntimeDetailId,
  buildRuntimeDetailsExportData,
} from '../../../../src/core/runtime-details.js';
