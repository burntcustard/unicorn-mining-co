export {};

if (process.platform === 'linux') {
  await import('../../benchmarking/tools/go-transport-check.ts');
}
