type UtauPluginApi = Readonly<{
  voicebank: Readonly<{ name: string }>;
  listFiles(): Promise<string[]>;
  readText(relativePath: string, encoding?: 'utf8' | 'cp932' | 'auto'): Promise<string | null>;
  writeText(relativePath: string, text: string): Promise<boolean>;
}>;

type UtauPlugin = {
  run(command: string, api: UtauPluginApi): Promise<unknown>;
};

declare var utauPlugin: UtauPlugin;
