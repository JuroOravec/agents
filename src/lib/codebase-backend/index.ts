/**
 * Codebase backend — pluggable read/edit implementation for the Worker and Reviewer agents.
 *
 * @module
 */

export {
  type CodebaseBackend,
  type CodebaseBackendCallbacks,
  createCodebaseBackend,
} from './codebase-backend.js';
export {
  CURSOR_EVENT_PREFIX,
  CURSOR_TOOL_LABELS,
  CursorCodebaseBackend,
  type CursorCodebaseBackendOpts,
  formatCursorEvent,
  makeCursorEventHandler,
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
