import { requireNativeModule } from "expo-modules-core";

export type DecodedAudioChunk = {
  uri: string;
  startMs: number;
  endMs: number;
  sampleRate: 16_000;
  channels: 1;
};

type LocalAudioDecoderModule = {
  decodeToChunks(
    inputUri: string,
    outputDirectoryUri: string,
    chunkSeconds: number,
    overlapSeconds: number,
  ): Promise<DecodedAudioChunk[]>;
};

export default requireNativeModule<LocalAudioDecoderModule>("ClipQuestLocalAudioDecoder");

