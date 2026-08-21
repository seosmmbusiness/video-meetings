/** Bytes of a temp file `file-type` (and the text-content rule) samples to detect its type — matches `file-type`'s own default. */
export const TYPE_SNIFF_SAMPLE_BYTES = 4100;

/** File extensions carrying no byte signature at all, judged instead by the text-content rule (D-2). */
export const TEXT_FILE_EXTENSIONS = new Set(['txt', 'md']);
