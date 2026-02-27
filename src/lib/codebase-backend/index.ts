/**
 * Codebase backend — pluggable read/edit implementation for the Worker and Reviewer agents.
 *
 * @module
 */

export {
  createCodebaseBackend,
  type CodebaseBackend,
  type CodebaseBackendCallbacks,
} from './codebase-backend.js';
export {
  CursorCodebaseBackend,
  CURSOR_EVENT_PREFIX,
  CURSOR_TOOL_LABELS,
  formatCursorEvent,
  makeCursorEventHandler,
  type CursorCodebaseBackendOpts,
} from './cursor-codebase-backend.js';
export {
  NativeCodebaseBackend,
  type NativeCodebaseBackendOpts,
} from './native-codebase-backend.js';
export {
  createListDirTool,
  createReadFileTool,
  createRunShellTool,
  createSearchCodeTool,
  createWriteFileTool,
} from './native-tools.js';
