import { ToolCategory } from '../../core/types.js';
import { listPreviews, startPreview, stopPreview } from '../../core/preview-server.js';

export function createPreviewTools() {
  return [createPreviewStartTool(), createPreviewStopTool(), createPreviewListTool()];
}

function createPreviewStartTool() {
  return {
    name: 'preview_start',
    description:
      'Start a local preview for generated HTML or Node projects. Static HTML is served from the workspace over localhost; Node projects start a package script/dev server and return the preview URL.',
    category: ToolCategory.WEB,
    params: {
      target: {
        type: 'string',
        description:
          'HTML file or project directory relative to the working directory. Defaults to current workspace.',
      },
      kind: {
        type: 'string',
        enum: ['auto', 'static', 'node'],
        description: 'Preview type. auto detects from target/package.json.',
      },
      command: {
        type: 'string',
        description: 'Optional Node command, e.g. npm run dev. Used for kind=node.',
      },
      port: { type: 'number', description: 'Optional local port. Defaults to an available port.' },
    },
    required: [],
    handler: async ({ target, kind, command, port }, ctx = {}) => {
      try {
        const session = await startPreview({
          workingDirectory: ctx.workingDirectory,
          target,
          kind,
          command,
          port,
        });
        return JSON.stringify(session, null, 2);
      } catch (error) {
        return `Error starting preview: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  };
}

function createPreviewStopTool() {
  return {
    name: 'preview_stop',
    description: 'Stop a local preview session created by preview_start.',
    category: ToolCategory.WEB,
    params: {
      session_id: { type: 'string', description: 'Preview session id returned by preview_start.' },
    },
    required: ['session_id'],
    handler: async ({ session_id }) => JSON.stringify(stopPreview(session_id), null, 2),
  };
}

function createPreviewListTool() {
  return {
    name: 'preview_list',
    description: 'List active local preview sessions and URLs.',
    category: ToolCategory.WEB,
    params: {},
    required: [],
    handler: async () => JSON.stringify({ success: true, previews: listPreviews() }, null, 2),
  };
}
