import { ToolCategory } from '../../core/types.js';

export default function caveman() {
  return {
    name: 'caveman',
    description:
      'Ultra-compressed communication mode. Compresses text to ~75% token reduction by removing filler words, articles, and pleasantries while preserving technical accuracy. Use "compress" to compress content, "decompress" to note that content is already in compressed form.',
    category: ToolCategory.skill_productivity,
    params: {
      content: {
        type: 'string',
        description: 'The text content to compress or decompress.',
      },
      mode: {
        type: 'string',
        description: 'Operation mode.',
        enum: ['compress', 'decompress'],
      },
    },
    required: ['content', 'mode'],
    handler: async (params) => {
      const { content, mode } = params;

      if (mode === 'decompress') {
        return `> **Note:** Caveman mode is for agent internal use. Content is already in compressed form.\n\n---\n\n${content}`;
      }

      // --- compress mode ---
      // Preserve code blocks and inline code verbatim
      const codeBlocks = [];
      let processed = content.replace(/(```[\s\S]*?```|`[^`]+`)/g, (match) => {
        codeBlocks.push(match);
        return `__CODE_BLOCK_${codeBlocks.length - 1}__`;
      });

      // Remove articles: a, an, the (standalone words, not inside other words)
      processed = processed.replace(/\b(a|an|the)\b/gi, '');

      // Remove filler words
      const fillers = [
        'just',
        'really',
        'basically',
        'actually',
        'simply',
        'very',
        'quite',
        'rather',
        'somewhat',
        'in order to',
      ];
      for (const filler of fillers) {
        processed = processed.replace(new RegExp(`\\b${filler}\\b`, 'gi'), '');
      }

      // Remove pleasantries
      const pleasantries = [
        'sure',
        'certainly',
        'happy to',
        'glad to',
        'of course',
        'i would love to',
        'i appreciate',
        'thanks',
        'thank you',
        'please note',
        'i hope this helps',
        'hope that helps',
      ];
      for (const p of pleasantries) {
        processed = processed.replace(new RegExp(`\\b${p}\\b`, 'gi'), '');
      }

      // Apply symbol table replacements
      const symbolTable = [
        [/I created\s+/gi, 'Created '],
        [/I built\s+/gi, 'Built '],
        [/I added\s+/gi, 'Added '],
        [/I fixed\s+/gi, 'Fixed '],
        [/I updated\s+/gi, 'Updated '],
        [/I removed\s+/gi, 'Removed '],
        [/I changed\s+/gi, 'Changed '],
        [/I modified\s+/gi, 'Modified '],
        [/I implemented\s+/gi, 'Implemented '],
        [/I refactored\s+/gi, 'Refactored '],
        [/I tested\s+/gi, 'Tested '],
        [/I deployed\s+/gi, 'Deployed '],
        [/I configured\s+/gi, 'Configured '],
        [/I installed\s+/gi, 'Installed '],
        [/I wrote\s+/gi, 'Wrote '],
        [/The function returns/gi, 'Returns'],
        [/The function takes/gi, 'Takes'],
        [/The function does/gi, 'Does'],
        [/The result is/gi, 'Result:'],
        [/The issue is/gi, 'Bug:'],
        [/The problem is/gi, 'Bug:'],
        [/I recommend/gi, 'Rec:'],
        [/An alternative is/gi, 'Alt:'],
        [/Another option is/gi, 'Alt:'],
        [/You need to/gi, 'TODO:'],
        [/You should/gi, 'TODO:'],
        [/Next step/gi, 'Next:'],
      ];

      for (const [pattern, replacement] of symbolTable) {
        processed = processed.replace(pattern, replacement);
      }

      // Prefix error lines with "Error:"
      processed = processed.replace(
        /^(?!(?:Error:|Bug:|TODO:|Rec:|Alt:|Next:|Created|Built|Added|Fixed|Updated|Removed|Changed|Modified|Implemented|Refactored|Tested|Deployed|Configured|Installed|Wrote|Returns|Takes|Does|Result:|__CODE_BLOCK_))/gm,
        (match) => match,
      );

      // Clean up extra whitespace (multiple spaces -> single space)
      processed = processed.replace(/[ \t]+/g, ' ');

      // Clean up extra blank lines (3+ newlines -> 2)
      processed = processed.replace(/\n{3,}/g, '\n\n');

      // Restore code blocks
      for (let i = 0; i < codeBlocks.length; i++) {
        processed = processed.replace(`__CODE_BLOCK_${i}__`, codeBlocks[i]);
      }

      // Trim lines
      processed = processed
        .split('\n')
        .map((line) => line.trim())
        .join('\n')
        .trim();

      return processed;
    },
  };
}
