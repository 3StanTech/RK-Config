/**
 * KB.ini text decoding, shared by browser code and Node.js scripts
 */

/**
 * Decode KB.ini content, handling both UTF-8 and UTF-16 LE encodings
 */
export function decodeKBIni(buffer: ArrayBuffer | Buffer): string {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;

  // Check if it's UTF-16 LE (starts with FF FE BOM or has null bytes in typical ASCII positions)
  if (bytes[0] === 0xFF && bytes[1] === 0xFE) {
    // Has UTF-16 LE BOM
    const decoder = new TextDecoder('utf-16le');
    return decoder.decode(buffer);
  } else if (bytes[1] === 0x00 || bytes[3] === 0x00) {
    // Likely UTF-16 LE without BOM (every other byte is null for ASCII)
    const decoder = new TextDecoder('utf-16le');
    return decoder.decode(buffer);
  } else {
    // Assume UTF-8
    if (buffer instanceof ArrayBuffer) {
      const decoder = new TextDecoder('utf-8');
      return decoder.decode(buffer);
    } else {
      return buffer.toString('utf-8');
    }
  }
}
