/**
 * inflate.ts
 * Inflates the zlib compressed body of Civilization V save files
 * The save writer ends its single deflate stream with a sync flush instead
 * of a final block, so the stream carries no adler32 trailer and cannot be
 * inflated by a naive one shot call. The workaround: strip the two byte
 * zlib header, append a final empty stored block, and inflate as raw
 * deflate. This uses the native DecompressionStream API, so it needs a
 * 2022+ browser or Node 22+ and keeps the project free of new dependencies.
 */

// A final empty stored block: bfinal=1, btype=00, padding, LEN=0, NLEN=0xFFFF
const finalEmptyStoredBlock = [0x01, 0x00, 0x00, 0xff, 0xff];

/**
 * Inflate a zlib payload that may end with a sync flush instead of a proper
 * stream termination
 * @param payload The zlib stream bytes, starting at the 0x78 header
 * @returns The complete decompressed data
 */
export async function inflateZlib(payload: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  // Sanity check the zlib header up front: the compression method must be
  // deflate. This keeps garbage inputs from ever reaching the stream API,
  // where they can surface as unhandled stream errors
  if (payload.length < 6 || (payload[0] & 0x0f) !== 8) {
    throw new Error('Not a zlib stream');
  }

  // The normal Civ5 case: the stream is sync flushed, so append a synthetic
  // final block to terminate it cleanly
  try {
    return await rawInflate(appendTermination(payload));
  } catch (e) {
    // Fall through to the alternatives below
  }

  // A stream that already ended with a final block needs no additions
  try {
    return await rawInflate(payload.subarray(2));
  } catch (e) {
    // Fall through
  }

  // A fully well formed zlib stream (header plus adler32 checksum)
  return streamInflate(payload, 'deflate');
}

/**
 * Append the final empty stored block to a zlib payload with its header stripped
 * @param payload The zlib stream bytes
 * @returns The raw deflate bytes with a terminating final block
 */
function appendTermination(payload: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const raw = payload.subarray(2);
  const terminated = new Uint8Array(raw.length + finalEmptyStoredBlock.length);
  terminated.set(raw, 0);
  terminated.set(finalEmptyStoredBlock, raw.length);
  return terminated;
}

/**
 * Inflate raw deflate bytes through the native API
 * @param raw The deflate bytes without zlib header or checksum
 * @returns The decompressed data
 */
async function rawInflate(raw: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return streamInflate(raw, 'deflate-raw');
}

/**
 * Pipe bytes through a DecompressionStream and collect the output
 * @param input The compressed bytes
 * @param format The compression format to decode with
 * @returns The decompressed data, rejects if the stream is corrupt
 */
async function streamInflate(input: Uint8Array<ArrayBuffer>, format: 'deflate-raw' | 'deflate'): Promise<Uint8Array<ArrayBuffer>> {
  const decompressor = new DecompressionStream(format);

  // Drain the readable side while the write side is still feeding data, so
  // large payloads never stall on a full internal queue
  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  let readError: unknown = null;
  const reading = (async () => {
    const reader = decompressor.readable.getReader();
    try {
      for (;;) {
        const result = await reader.read();
        if (result.done) break;
        chunks.push(result.value);
        totalLength += result.value.byteLength;
      }
    } catch (e) {
      readError = e;
    } finally {
      reader.releaseLock();
    }
  })();

  try {
    const writer = decompressor.writable.getWriter();
    await writer.write(input);
    await writer.close();
  } catch (e) {
    // Ignore write side errors: a read side error is the real verdict
  }

  await reading;

  if (readError) {
    throw readError instanceof Error ? readError : new Error(String(readError));
  }

  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}
