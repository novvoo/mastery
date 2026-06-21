// Re-export from src/core/ — activity-summary logic has been moved to runtime layer
export {
  buildActivitySummary,
  getActivityTone,
  getFileStatusLabel,
  getFileTypeIcon,
  formatDuration,
} from '../../../../../src/core/activity-summary.js';
