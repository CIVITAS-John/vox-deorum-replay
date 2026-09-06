/**
 * inflate.ts
 * Inflates the zlib compressed body of Civilization V save files
 * The save writer chunks its deflate stream: every 65536 bytes of compressed
 * data are followed by a four byte little endian size word that is not part
 * of the stream, so the words have to be stripped before inflating. The
 * stream itself ends with a sync flush instead of a final block, so it
 * carries no adler32 trailer and cannot be inflated by a naive one shot
 * call. The workaround: strip the two byte zlib header, append a final empty
 * stored block, and inflate as raw deflate. This uses the native
 * DecompressionStream API, so it needs a 2022+ browser or Node 22+ and keeps
 * the project free of new dependencies.
 */

// A final empty stored block: bfinal=1, btype=00, padding, LEN=0, NLEN=0xFFFF
const finalEmptyStoredBlock = [0x01, 0x00, 0x00, 0xff, 0xff];

/** Size of one compressed chunk as written by the save game writer */
const CHUNK_SIZE = 0x10000;

/**
 * Remove the chunk size words interleaved into the compressed payload. Every
 * full 65536 byte chunk of deflate data is followed by an int32 holding the
 * size of the next chunk, which the game reader consumes but which would be
 * decoded as compressed data by a plain inflater. The words are validated on
 * the way: each one must be a plausible chunk size, otherwise the payload is
 * left untouched so other zlib streams still inflate normally
 * @param payload The zlib stream bytes, starting at the 0x78 header
 * @returns The payload with the size words removed
 */
function stripChunkMarkers(payload: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);

  // Walk the chunk layout and validate every size word on the way: 65536
  // data bytes, then an int32 with the size of the next chunk
  const dataLengths: number[] = [];
  let markerCount = 0;
  let pos = 0;
  while (pos < payload.length) {
    const take = Math.min(CHUNK_SIZE, payload.length - pos);
    dataLengths.push(take);
    pos += take;
    if (pos + 4 <= payload.length) {
      const size = view.getUint32(pos, true);
      if (size <= 0 || size > CHUNK_SIZE) return payload;
      markerCount++;
      pos += 4;
    }
  }
  if (markerCount === 0) return payload;

  // Copy the chunks, leaving out the words
  const clean = new Uint8Array(payload.length - markerCount * 4);
  let writePos = 0;
  let readPos = 0;
  for (const length of dataLengths) {
    clean.set(payload.subarray(readPos, readPos + length), writePos);
    writePos += length;
    readPos += length + 4;
  }
  return clean;
}

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
    return await rawInflate(appendTermination(stripChunkMarkers(payload)));
  } catch (e) {
    // Fall through to the alternatives below
  }

  // A stream that already ended with a final block needs no additions
  try {
    return await rawInflate(stripChunkMarkers(payload).subarray(2));
  } catch (e) {
    // Fall through
  }

  // A fully well formed zlib stream (header plus adler32 checksum)
  return streamInflate(stripChunkMarkers(payload), 'deflate');
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
