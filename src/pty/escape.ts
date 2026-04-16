const ESCAPE_MAP: Record<string, string> = {
  'n': '\n',
  'r': '\r',
  't': '\t',
  '\\': '\\'
};

export function parseEscapeSequences(input: string): string {
  return input.replace(/\\(x[0-9A-Fa-f]{2}|u[0-9A-Fa-f]{4}|[nrt\\])/g, (match, seq: string) => {
    if (seq.startsWith('x') || seq.startsWith('u')) {
      return String.fromCharCode(parseInt(seq.slice(1), 16));
    }
    return ESCAPE_MAP[seq] || match;
  });
}

export const ETX = String.fromCharCode(3);
export const EOT = String.fromCharCode(4);
