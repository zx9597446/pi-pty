export function parseEscapeSequences(input: string): string {
  return input.replace(/\\(x[0-9A-Fa-f]{2}|u[0-9A-Fa-f]{4}|[nrt\\])/g, (match, seq: string) => {
    if (seq.startsWith('x')) {
      return String.fromCharCode(parseInt(seq.slice(1), 16));
    }
    if (seq.startsWith('u')) {
      return String.fromCharCode(parseInt(seq.slice(1), 16));
    }
    switch (seq) {
      case 'n':
        return '\n';
      case 'r':
        return '\r';
      case 't':
        return '\t';
      case '\\':
        return '\\';
      default:
        return match;
    }
  });
}

export const ETX = String.fromCharCode(3);
export const EOT = String.fromCharCode(4);
