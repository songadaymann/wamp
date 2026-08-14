declare module 'jpeg-js/lib/decoder.js' {
  interface DecodeOptions {
    useTArray: true;
    formatAsRGBA?: boolean;
    maxResolutionInMP?: number;
    maxMemoryUsageInMB?: number;
  }

  interface DecodedJpeg {
    width: number;
    height: number;
    data: Uint8Array;
  }

  export default function decodeJpegBytes(
    bytes: Uint8Array,
    options: DecodeOptions,
  ): DecodedJpeg;
}
